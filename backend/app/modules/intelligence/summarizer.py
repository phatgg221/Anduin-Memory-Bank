"""Case thread → guarded Case Memory Record (for human review). Steps are reported through `on_step`."""

import asyncio
import re
from collections.abc import Awaitable, Callable

from app.modules.intelligence import llm_client
from app.modules.intelligence.guard import guard_memory
from app.modules.intelligence.prompts import SEGMENT_SYSTEM, SUMMARIZE_SYSTEM, summarize_user
from app.modules.intelligence.schemas import (
    CaseMemoryDraft,
    CaseMemoryRecord,
    PitfallDraft,
    SegmentNotes,
    ThreadContext,
)
from app.modules.intelligence.transcript import Transcript, build_transcript

SUMMARIZE_STEPS = ("Reading the case thread", "Drafting the memory record", "Checking citations")
LONG_THREAD_CHARS = 60_000  # above this the thread is condensed segment by segment before drafting
SEGMENT_CHARS = 40_000
PARALLEL_SEGMENTS = 4
HEADER = re.compile(r"^L\d+\s*\| \[\d{4}-\d{2}-\d{2} ")
OnStep = Callable[[str], Awaitable[None]]


class EmptyThreadError(Exception):
    pass


async def summarize_thread(context: ThreadContext, on_step: OnStep) -> tuple[CaseMemoryRecord, list[str]]:
    await on_step(SUMMARIZE_STEPS[0])
    if not context.messages:
        raise EmptyThreadError("The thread has no messages yet, so there's nothing to summarize.")
    transcript = build_transcript(context)
    case_block = "\n".join(
        [
            f"Case: {context.case_code} · {context.title}",
            f"Customer: {context.client_name or 'not recorded'}",
            f"Severity: {context.severity}" + (f" · deadline {context.due_date}" if context.due_date else ""),
            f"Department: {context.department}",
            f"Incoming request: {context.initial_request_brief}",
            *(f"{k}: {v}" for k, v in context.context_tags.items()),
        ]
    )
    mentions = "\n".join(f"- {m.author_name}: {m.content}" for m in context.room_mentions)

    body = transcript.text
    if len(body) > LONG_THREAD_CHARS:
        body = await condense(body)

    await on_step(SUMMARIZE_STEPS[1])
    draft = await llm_client.complete_json(
        SUMMARIZE_SYSTEM,
        summarize_user(
            case_block,
            body,
            mentions,
            "\n".join(f"- {a}" for a in context.artifacts),
            outcome_block(context),
        ),
        CaseMemoryDraft,
        fake=lambda: _fake_draft(context, transcript),
    )

    await on_step(SUMMARIZE_STEPS[2])
    return guard_memory(draft, context, transcript)


def segments(numbered: str, limit: int = SEGMENT_CHARS) -> list[str]:
    """Splits a numbered transcript into parts of at most ~limit characters, only between messages."""
    parts, current, size = [], [], 0
    for line in numbered.splitlines():
        if HEADER.match(line) and current and size + len(line) > limit:
            parts.append("\n".join(current))
            current, size = [], 0
        current.append(line)
        size += len(line) + 1
    if current:
        parts.append("\n".join(current))
    return parts


async def condense(numbered: str) -> str:
    """Long thread → line-referenced notes per segment (in parallel), so the final draft fits in one prompt."""
    gate = asyncio.Semaphore(PARALLEL_SEGMENTS)

    async def one(part: str) -> SegmentNotes:
        async with gate:
            return await llm_client.complete_json(SEGMENT_SYSTEM, part, SegmentNotes, fake=lambda: SegmentNotes())

    parts = segments(numbered)
    results = await asyncio.gather(*(one(part) for part in parts))
    lines = [
        f"# Condensed from a long thread in {len(parts)} parts. Line numbers refer to the original transcript;",
        "# cite them as Chat #L<n>.",
    ]
    for index, notes in enumerate(results, 1):
        lines.append(f"## Part {index}")
        lines += [
            f"- [{n.kind}] {n.point}" + (f" ({n.who})" if n.who else "") + (f" [L{n.line}]" if n.line else "")
            for n in notes.notes
        ]
    return "\n".join(lines)


def outcome_block(context: ThreadContext) -> str:
    if not context.outcome and not context.final_output:
        return ""
    lines = [f"Outcome: {context.outcome or 'not given'}", f"Final output: {context.final_output or 'not given'}"]
    if context.deliverables:
        lines.append("Final deliverables: " + ", ".join(context.deliverables))
    for name, (file_type, text) in context.deliverable_texts.items():
        kind = "Client approval" if file_type == "CLIENT_APPROVAL" else "Delivered file"
        lines.append(f'<file name="{name}" kind="{kind}">\n{text[:2500]}\n</file>')
    return "\n".join(lines)


# --- fake provider: deterministic, built only from the thread ---------------------------------------------------

SENTENCE = re.compile(r"(?<=[.!?])\s+")
WARNING_WORDS = re.compile(
    r"\b(careful|risk|must|never|don't|do not|blocker|fail|failing|slip|late|missing|stale)\b", re.I
)
STRONG_WORDS = re.compile(r"\b(never|must|blocker|fail|failing)\b", re.I)


def _first_sentence(text: str, limit: int = 240) -> str:
    sentence = SENTENCE.split(text.strip().replace("\n", " "))[0]
    return sentence if len(sentence) <= limit else sentence[: limit - 1].rstrip() + "…"


def _fake_draft(context: ThreadContext, transcript: Transcript) -> CaseMemoryDraft:
    messages = context.messages
    people = sorted({m.author_name for m in messages})
    first_line = {m.id: line for line, m in sorted(transcript.lines.items(), reverse=True)}

    milestones = [m for m in messages if m.is_milestone] or messages[-2:]
    steps = [_first_sentence(m.content, 200) for m in milestones][:6]

    pitfalls = [
        PitfallDraft(
            warning=_first_sentence(m.content, 400),
            severity="HIGH" if STRONG_WORDS.search(m.content) else "MEDIUM",
            reference=f"Chat #L{first_line[m.id]}",
        )
        for m in messages
        if WARNING_WORDS.search(m.content) and len(_first_sentence(m.content)) >= 10
    ][:4]

    narrative = " ".join(f"{m.author_name}: {_first_sentence(m.content, 180)}" for m in messages[:5])
    return CaseMemoryDraft(
        summary=(
            f"{context.title}. {_first_sentence(context.initial_request_brief, 300)} "
            f"Worked through in the case thread by {', '.join(people)}."
        ),
        how_it_went=(
            f"{narrative} The thread closed after {len(messages)} messages."
            + (f" Outcome: {context.outcome.lower()}. Delivered: {context.final_output}" if context.outcome else "")
        )[:2000],
        resolution_steps=steps,
        pitfalls=pitfalls,
        context_tags=context.context_tags or {"Department": context.department},
    )
