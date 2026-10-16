"""Committed memory → retrievable chunks with embeddings. Returns data; the caller (triage) persists it."""

import uuid
from dataclasses import dataclass

from app.modules.intelligence import llm_client
from app.modules.intelligence.schemas import CaseMemoryRecord, IncomingRequest, ThreadContext
from app.modules.intelligence.transcript import build_transcript

INDEX_STEPS = ("Chunking the memory record", "Embedding chunks", "Storing in the vector index")
WINDOW = 6  # messages per discussion chunk
ARTIFACT_CHARS = 1500


@dataclass
class ChunkDraft:
    chunk_type: str
    reference_label: str | None
    content: str
    message_id: uuid.UUID | None = None
    artifact_name: str | None = None
    embedding: list[float] | None = None


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
        for part, offset in enumerate(range(0, len(text), ARTIFACT_CHARS), start=1):
            chunks.append(
                ChunkDraft(
                    "ARTIFACT_CONTENT",
                    f"{name} · part {part}"[:100],
                    f"{head}\n{name}\n{text[offset : offset + ARTIFACT_CHARS]}",
                    artifact_name=name,
                )
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
        for part, offset in enumerate(range(0, min(len(text), ARTIFACT_CHARS * 6), ARTIFACT_CHARS), start=1):
            chunks.append(
                ChunkDraft(
                    "ARTIFACT_CONTENT",
                    f"{name} · part {part}"[:100],
                    f"{head}\n{name}\n{text[offset : offset + ARTIFACT_CHARS]}",
                    artifact_name=name,
                )
            )
    return chunks
