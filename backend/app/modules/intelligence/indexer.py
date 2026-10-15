"""Committed memory → retrievable chunks with embeddings. Returns data; the caller (triage) persists it."""

import uuid
from dataclasses import dataclass

from app.modules.intelligence import llm_client
from app.modules.intelligence.schemas import CaseMemoryRecord, ThreadContext
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
            f"{record.summary}\n\n{record.how_it_went}",
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
