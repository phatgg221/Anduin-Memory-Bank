"""Every LLM and embedding call goes through here. Providers: `openrouter`, `gemini`, `fake` (settings).

Contract: `complete_json` always returns an instance of the requested Pydantic model (validated, one repair attempt
on a schema error), or raises LLMError. Transient provider failures (429, 5xx, timeouts) back off 1 s → 2 s → 4 s.
"""

import asyncio
import base64
import hashlib
import json
import logging
import math
import re
from collections.abc import Callable

import httpx2
from pydantic import BaseModel, ValidationError

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

BACKOFF_SECONDS = (1, 2, 4)
EMBED_BATCH = 64  # texts per embeddings request: big files make hundreds of chunks
FENCE = re.compile(r"^```(?:json)?\s*|\s*```$")


class LLMError(Exception):
    """The provider failed for good, or never returned valid JSON for the contract."""


def provider_label() -> str:
    """Recorded on every job result, so a draft says which model wrote it."""
    if settings.llm_provider == "fake":
        return "fake (deterministic, no model)"
    return f"{settings.llm_provider}:{settings.llm_model or '(LLM_MODEL not set)'}"


def agent_label() -> str:
    if settings.llm_provider == "fake":
        return "fake (scripted tool calls)"
    return f"{settings.llm_provider}:{settings.agent_model or settings.llm_model}"


def embedding_label() -> str:
    if settings.embedding_provider == "fake":
        return "fake (hash embeddings)"
    return f"{settings.embedding_provider}:{settings.embedding_model}@{settings.embedding_dim}"


async def complete_json[T: BaseModel](
    system: str,
    user: str,
    schema: type[T],
    *,
    fake: Callable[[], T],
    temperature: float = 0.1,
    model: str | None = None,
) -> T:
    """System + user prompt → validated `schema` instance. `fake` builds the fake provider's deterministic answer."""
    if settings.llm_provider == "fake":
        return fake()
    raw = await _complete(system, user, schema, temperature, model)
    try:
        return schema.model_validate_json(_strip_fences(raw))
    except ValidationError as error:
        # One repair attempt: show the model its own output and the validation errors.
        logger.warning("LLM output failed %s validation, retrying once: %s", schema.__name__, error.error_count())
        repair = (
            f"{user}\n\nYour previous answer did not match the JSON schema.\n"
            f"<previous_answer>\n{raw}\n</previous_answer>\n"
            f"<validation_errors>\n{error}\n</validation_errors>\nReturn only corrected JSON."
        )
        raw = await _complete(system, repair, schema, temperature, model)
        try:
            return schema.model_validate_json(_strip_fences(raw))
        except ValidationError as again:
            raise LLMError(
                f"The model never returned valid {schema.__name__} JSON: {again.error_count()} errors"
            ) from again


async def embed(texts: list[str]) -> list[list[float]]:
    """One vector per text, all of settings.embedding_dim dimensions (one model and dimension for the whole corpus)."""
    if not texts:
        return []
    if settings.embedding_provider == "fake":
        return [_fake_embedding(t) for t in texts]
    if settings.embedding_provider == "openrouter":
        vectors = []
        for start in range(0, len(texts), EMBED_BATCH):
            vectors.extend(await _openrouter_embeddings(texts[start : start + EMBED_BATCH]))
    else:
        vectors = [await _gemini_embedding(t) for t in texts]
    for vector in vectors:
        if len(vector) != settings.embedding_dim:
            raise LLMError(f"Embedding has {len(vector)} dimensions, expected {settings.embedding_dim}")
    return vectors


# --- providers ---------------------------------------------------------------------------------------------------


async def complete_with_tools(messages: list[dict], tools: list[dict], *, temperature: float = 0.1) -> dict:
    """One turn of an OpenAI-style tool-calling conversation → the assistant message (`content`, `tool_calls`).

    The caller runs the tools and appends `{"role": "tool", ...}` results. OpenRouter only (Gemini, Claude, GPT).
    """
    if settings.llm_provider != "openrouter":
        raise LLMError("Tool calling needs LLM_PROVIDER=openrouter")
    body = {
        "model": settings.agent_model or settings.llm_model,
        "temperature": temperature,
        "messages": messages,
        "tools": tools,
        "tool_choice": "auto",
    }
    data = await _post(f"{settings.openrouter_base_url}/chat/completions", headers=_openrouter_headers(), body=body)
    try:
        return data["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected OpenRouter response: {json.dumps(data)[:300]}") from exc


def ocr_label() -> str:
    return f"{settings.llm_provider}:{settings.ocr_model or settings.agent_model or settings.llm_model}"


async def transcribe(system: str, prompt: str, data: bytes, mime: str, file_name: str) -> str:
    """A scanned PDF or a photo → plain text from a vision model (native PDF/image input via OpenRouter)."""
    if settings.llm_provider != "openrouter":
        raise LLMError("OCR needs LLM_PROVIDER=openrouter")
    encoded = base64.b64encode(data).decode()
    if mime == "application/pdf":
        part = {"type": "file", "file": {"filename": file_name, "file_data": f"data:{mime};base64,{encoded}"}}
    else:
        part = {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{encoded}"}}
    body = {
        "model": settings.ocr_model or settings.agent_model or settings.llm_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": [{"type": "text", "text": prompt}, part]},
        ],
        "plugins": [{"id": "file-parser", "pdf": {"engine": "native"}}],
    }
    data_out = await _post(
        f"{settings.openrouter_base_url}/chat/completions",
        headers=_openrouter_headers(),
        body=body,
        request_seconds=max(settings.llm_timeout_seconds, 180),
    )
    try:
        return data_out["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected OpenRouter response: {json.dumps(data_out)[:300]}") from exc


async def _complete(
    system: str, user: str, schema: type[BaseModel], temperature: float, model: str | None = None
) -> str:
    if settings.llm_provider == "openrouter":
        return await _openrouter_chat(system, user, schema, temperature, model)
    if settings.llm_provider == "gemini":
        return await _gemini_generate(system, user, schema, temperature)
    raise LLMError(f"Unknown LLM provider {settings.llm_provider!r}")


async def _post(url: str, *, headers: dict[str, str], body: dict, request_seconds: float | None = None) -> dict:
    """POST with backoff on 429 / 5xx / network errors; any other 4xx fails immediately (retrying won't help)."""
    last: Exception | None = None
    for attempt, delay in enumerate((*BACKOFF_SECONDS, None)):
        try:
            async with httpx2.AsyncClient(timeout=request_seconds or settings.llm_timeout_seconds) as client:
                response = await client.post(url, headers=headers, json=body)
            if response.status_code == 429 or response.status_code >= 500:
                last = LLMError(f"Provider returned {response.status_code}")
            elif response.status_code >= 400:
                raise LLMError(f"Provider rejected the request ({response.status_code}): {response.text[:300]}")
            else:
                return response.json()
        except httpx2.HTTPError as exc:
            last = exc
        if delay is None:
            break
        logger.warning("LLM call failed (attempt %s), retrying in %ss: %s", attempt + 1, delay, last)
        await asyncio.sleep(delay)
    raise LLMError(f"Provider unavailable after retries: {last}")


def _openrouter_headers() -> dict[str, str]:
    if not settings.openrouter_api_key:
        raise LLMError("OPENROUTER_API_KEY is not set")
    return {
        "Authorization": f"Bearer {settings.openrouter_api_key}",
        "X-Title": "Dejavu by Corvane",
        "HTTP-Referer": "http://localhost:3000",
    }


async def _openrouter_chat(
    system: str, user: str, schema: type[BaseModel], temperature: float, model: str | None = None
) -> str:
    """OpenAI-compatible chat completions. Asks for the JSON schema; falls back to JSON mode if the model can't."""
    if not (model or settings.llm_model):
        raise LLMError("Set LLM_MODEL to an OpenRouter model id (as listed on openrouter.ai/models)")
    body = {
        "model": model or settings.llm_model,
        "temperature": temperature,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema.__name__, "strict": False, "schema": schema.model_json_schema()},
        },
    }
    url = f"{settings.openrouter_base_url}/chat/completions"
    try:
        data = await _post(url, headers=_openrouter_headers(), body=body)
    except LLMError as error:
        if "rejected" not in str(error):
            raise
        body["response_format"] = {"type": "json_object"}
        data = await _post(url, headers=_openrouter_headers(), body=body)
    try:
        return data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected OpenRouter response: {json.dumps(data)[:300]}") from exc


async def _openrouter_embeddings(texts: list[str]) -> list[list[float]]:
    body = {"model": settings.embedding_model, "input": texts, "dimensions": settings.embedding_dim}
    data = await _post(f"{settings.openrouter_base_url}/embeddings", headers=_openrouter_headers(), body=body)
    return [item["embedding"] for item in sorted(data["data"], key=lambda item: item["index"])]


def _gemini_headers() -> dict[str, str]:
    if not settings.gemini_api_key:
        raise LLMError("GEMINI_API_KEY is not set")
    return {"x-goog-api-key": settings.gemini_api_key}  # header, never the URL


async def _gemini_generate(system: str, user: str, schema: type[BaseModel], temperature: float) -> str:
    model = settings.llm_model or "gemini-2.5-flash"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    data = await _post(url, headers=_gemini_headers(), body=body)
    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMError(f"Unexpected Gemini response: {json.dumps(data)[:300]}") from exc


async def _gemini_embedding(text: str) -> list[float]:
    model = settings.embedding_model
    body = {"content": {"parts": [{"text": text}]}, "outputDimensionality": settings.embedding_dim}
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent"
    data = await _post(url, headers=_gemini_headers(), body=body)
    return data["embedding"]["values"]


def _strip_fences(raw: str) -> str:
    return FENCE.sub("", raw.strip())


def _fake_embedding(text: str) -> list[float]:
    """Deterministic bag-of-words hashing: similar wording lands nearby. Fine for tests, meaningless for rankings."""
    vector = [0.0] * settings.embedding_dim
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        digest = hashlib.sha256(token.encode()).digest()
        index = int.from_bytes(digest[:4], "big") % settings.embedding_dim
        vector[index] += 1.0 if digest[4] % 2 else -1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]
