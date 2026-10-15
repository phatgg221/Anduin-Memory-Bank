"""Repairs and warns rather than failing: the LLM never decides IDs, code derives them from validated references."""

import re

from app.modules.intelligence.schemas import CaseMemoryDraft, CaseMemoryRecord, GuardedPitfall, ThreadContext
from app.modules.intelligence.transcript import Transcript

CHAT_REFERENCE = re.compile(r"^Chat #L(\d+)$")
MAX_TAGS = 6


def guard_memory(
    draft: CaseMemoryDraft, context: ThreadContext, transcript: Transcript
) -> tuple[CaseMemoryRecord, list[str]]:
    warnings: list[str] = []
    pitfalls: list[GuardedPitfall] = []
    for index, pitfall in enumerate(draft.pitfalls, start=1):
        reference = (pitfall.reference or "").strip() or None
        author_id = message_id = None
        if reference and (match := CHAT_REFERENCE.match(reference)):
            message = transcript.lines.get(int(match.group(1)))
            if message is None:
                warnings.append(
                    f"Pitfall {index}: {reference} is not a message line in the transcript; reference removed."
                )
                reference = None
            else:
                author_id = str(message.author_id) if message.author_id else None
                message_id = str(message.id)
        elif reference and not any(reference.startswith(name) for name in context.artifacts):
            warnings.append(f"Pitfall {index}: reference {reference!r} matches no message line or attachment; removed.")
            reference = None
        if reference is None:
            warnings.append(f"Pitfall {index} has no source; check it before committing.")
        pitfalls.append(
            GuardedPitfall(
                warning=pitfall.warning,
                severity=pitfall.severity,
                reference=reference,
                authorId=author_id,
                messageId=message_id,
            )
        )

    tags = {k.strip()[:40]: v.strip()[:80] for k, v in draft.context_tags.items() if k.strip() and v.strip()}
    if len(tags) > MAX_TAGS:
        warnings.append(f"Kept the first {MAX_TAGS} of {len(tags)} context tags.")
        tags = dict(list(tags.items())[:MAX_TAGS])

    record = CaseMemoryRecord(
        summary=draft.summary,
        how_it_went=draft.how_it_went,
        resolution_steps=draft.resolution_steps,
        pitfalls=pitfalls,
        context_tags=tags or context.context_tags,
    )
    return record, warnings
