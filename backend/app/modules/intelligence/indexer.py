"""Committed memory → retrievable chunks with embeddings. Returns data; the caller (triage) persists it."""

import re
import uuid
from dataclasses import dataclass

from app.core import documents
from app.modules.intelligence import llm_client
from app.modules.intelligence.schemas import CaseMemoryRecord, IncomingRequest, ThreadContext
from app.modules.intelligence.transcript import build_transcript

INDEX_STEPS = ("Chunking the memory record", "Embedding chunks", "Storing in the vector index")
WINDOW = 6  # messages per discussion chunk
ARTIFACT_CHARS = 1500
MAX_PARTS_PER_FILE = 120  # ~180k characters of a file are indexed; the full text stays on the artifact
MAX_INTAKE_PARTS = 40
HEADING = re.compile(r"^#{1,4}\s+(.+?)\s*#*\s*$", re.M)


@dataclass
class ChunkDraft:
    chunk_type: str
    reference_label: str | None
    content: str
    message_id: uuid.UUID | None = None
    artifact_name: str | None = None
    page: int | None = None
    embedding: list[float] | None = None


def file_parts(name: str, text: str, max_parts: int) -> list[tuple[str, str, int | None]]:
    """(label, text, page) pieces of a file: per page when the text has page markers, else by section heading."""
    pieces: list[tuple[str, str, int | None]] = []
    pages = documents.split_pages(text)
    if pages:
        for number, page in pages:
            for offset in range(0, len(page), ARTIFACT_CHARS):
                pieces.append((f"{name} · p.{number}", page[offset : offset + ARTIFACT_CHARS], number))
    else:
        headings = [(m.start(), m.group(1)) for m in HEADING.finditer(text)]
        for part, offset in enumerate(range(0, len(text), ARTIFACT_CHARS), start=1):
            section = next((title for start, title in reversed(headings) if start <= offset), None) or next(
                (title for start, title in headings if start < offset + 200), None
            )
            where = f"§ {section[:60]}" if section else f"part {part}"
            pieces.append((f"{name} · {where}", text[offset : offset + ARTIFACT_CHARS], None))
    return [(label[:100], body, page) for label, body, page in pieces[:max_parts]]


def build_chunks(
    context: ThreadContext, record: CaseMemoryRecord, artifact_texts: dict[str, str] | None = None
) -> list[ChunkDraft]:
    customer = f" · customer {context.client_name}" if context.client_name else ""
    head = f"{context.case_code} · {context.title} ({context.department}{customer} · severity {context.severity})"
    tags = "; ".join(f"{k}: {v}" for k, v in record.context_tags.items())
    chunks = [
        ChunkDraft(
            "CASE_SUMMARY",
            "Summary",
            f"{head}\nTags: {tags}\nRequest: {context.initial_request_brief}\n\n"
            f"{record.summary}\n\n{record.how_it_went}"
            + (f"\n\nOutcome: {context.outcome}. Final output: {context.final_output}" if context.outcome else ""),
        ),
        ChunkDraft(
            "RESOLUTION_PLAYBOOK",
            "Resolution & pitfalls",
            f"{head}\nResolution steps:\n"
            + "\n".join(f"{i}. {step}" for i, step in enumerate(record.resolution_steps, 1))
            + "\nPitfalls:\n"
            + "\n".join(f"- [{p.severity}] {p.warning}" for p in record.pitfalls),
        ),
    ]

    transcript = build_transcript(context)
    first_line = {m.id: line for line, m in sorted(transcript.lines.items(), reverse=True)}
    last_line = {m.id: line for line, m in sorted(transcript.lines.items())}
    for start in range(0, len(context.messages), WINDOW):
        window = context.messages[start : start + WINDOW]
        label = f"Chat #L{first_line[window[0].id]}–{last_line[window[-1].id]}"
        body = "\n".join(f"{m.author_name}{'' if m.author_active else ' [ALUMNI]'}: {m.content}" for m in window)
        chunks.append(ChunkDraft("CHANNEL_DISCUSSION", label, f"{head}\n{body}", message_id=window[0].id))

    for name, text in (artifact_texts or {}).items():
        for label, body, page in file_parts(name, text, MAX_PARTS_PER_FILE):
            chunks.append(
                ChunkDraft("ARTIFACT_CONTENT", label, f"{head}\n{label}\n{body}", artifact_name=name, page=page)
            )
    return chunks


async def embed_chunks(chunks: list[ChunkDraft]) -> list[ChunkDraft]:
    vectors = await llm_client.embed([c.content for c in chunks])
    for chunk, vector in zip(chunks, vectors, strict=True):
        chunk.embedding = vector
    return chunks


def build_intake_chunks(incoming: IncomingRequest) -> list[ChunkDraft]:
    """An OPEN case's request and files as searchable chunks: lets the agent spot duplicates among active cases."""
    head = f"{incoming.case_code} · {incoming.title} (open · customer {incoming.client_name or 'unknown'})"
    tags = "; ".join(f"{k}: {v}" for k, v in incoming.context_tags.items())
    chunks = [ChunkDraft("CASE_SUMMARY", "Intake brief", f"{head}\nTags: {tags}\n{incoming.brief}")]
    for name, text in incoming.file_texts.items():
        for label, body, page in file_parts(name, text, MAX_INTAKE_PARTS):
            chunks.append(
                ChunkDraft("ARTIFACT_CONTENT", label, f"{head}\n{label}\n{body}", artifact_name=name, page=page)
            )
    return chunks
