"""Case thread → guarded Case Memory Record (for human review). Steps are reported through `on_step`."""

import re
from collections.abc import Awaitable, Callable

from app.modules.intelligence import llm_client
from app.modules.intelligence.guard import guard_memory
from app.modules.intelligence.prompts import SUMMARIZE_SYSTEM, summarize_user
from app.modules.intelligence.schemas import CaseMemoryDraft, CaseMemoryRecord, PitfallDraft, ThreadContext
from app.modules.intelligence.transcript import Transcript, build_transcript

SUMMARIZE_STEPS = ("Reading the case thread", "Drafting the memory record", "Checking citations")
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
            f"Department: {context.department}",
            f"Incoming request: {context.initial_request_brief}",
            *(f"{k}: {v}" for k, v in context.context_tags.items()),
        ]
    )
    mentions = "\n".join(f"- {m.author_name}: {m.content}" for m in context.room_mentions)

    await on_step(SUMMARIZE_STEPS[1])
    draft = await llm_client.complete_json(
        SUMMARIZE_SYSTEM,
        summarize_user(case_block, transcript.text, mentions, "\n".join(f"- {a}" for a in context.artifacts)),
        CaseMemoryDraft,
        fake=lambda: _fake_draft(context, transcript),
    )

    await on_step(SUMMARIZE_STEPS[2])
    return guard_memory(draft, context, transcript)


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
        how_it_went=f"{narrative} The thread closed after {len(messages)} messages.",
        resolution_steps=steps,
        pitfalls=pitfalls,
        context_tags=context.context_tags or {"Department": context.department},
    )
