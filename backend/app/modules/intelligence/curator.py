"""Memory curator: before a case is committed, suggest reusable files and flag conflicts with older memory.

Suggestions only: the reviewer decides. File names and case codes the model returns are checked against what it was
shown; anything else is dropped.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import injection
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import CURATOR_SYSTEM, curator_user
from app.modules.intelligence.schemas import (
    CaseMemoryRecord,
    ContradictionDraft,
    CuratorDraft,
    ReusableFileDraft,
    ThreadContext,
)

CURATE_STEP = "Curating files & checking older cases"
OLDER_HITS = 10
REUSABLE_NAMES = ("schema", "mapping", "policy", "runbook", "guide", "template", "matrix", "playbook", "checklist")


async def curate(
    session: AsyncSession,
    case_id,
    context: ThreadContext,
    record: CaseMemoryRecord,
    files: dict[str, tuple[str, str]],
) -> tuple[dict, list[str]]:
    """`files` maps file name → (artifact id, text preview). Returns (suggestions, warnings)."""
    record_text = "\n".join(
        [
            f"Summary: {record.summary}",
            f"How it went: {record.how_it_went}",
            "Resolution steps:",
            *(f"- {step}" for step in record.resolution_steps),
            "Pitfalls:",
            *(f"- {p.warning}" for p in record.pitfalls),
        ]
    )
    [vector] = await llm_client.embed([record_text[:6000]])
    hits = [
        (chunk, case)
        for chunk, case, _ in await cases.nearest_chunks(session, vector, None, OLDER_HITS + 6, resolved_only=True)
        if case.id != case_id
    ][:OLDER_HITS]
    older = {case.case_code: case for _, case in hits}
    older_text = "\n".join(
        f"[{case.case_code} · {chunk.reference_label or chunk.chunk_type}] {chunk.content[:700]}"
        for chunk, case in hits
    )
    marker = injection.nonce()
    files_text = "\n".join(
        injection.fence(
            f"file {name}{' (final deliverable)' if name in context.deliverables else ''}", preview[:600], marker
        )
        for name, (_, preview) in files.items()
    )
    draft = await llm_client.complete_json(
        CURATOR_SYSTEM,
        curator_user(record_text, files_text, older_text),
        CuratorDraft,
        fake=lambda: _fake(files, context),
    )

    warnings: list[str] = []
    reusable, seen = [], set()
    for item in draft.reusable_files:
        if item.file_name not in files:
            warnings.append(f"Curator suggested '{item.file_name}', which isn't one of this case's files.")
            continue
        if item.file_name in seen:
            continue
        seen.add(item.file_name)
        reusable.append({"artifact_id": files[item.file_name][0], "file_name": item.file_name, "reason": item.reason})
    for name in context.deliverables:  # the team's own deliverables are offered; client sign-offs aren't knowledge
        if name in files and name not in seen and name not in context.approvals:
            reusable.append(
                {"artifact_id": files[name][0], "file_name": name, "reason": "Marked as a final deliverable."}
            )

    contradictions = []
    for item in draft.contradictions:
        case = older.get(item.case_code.upper())
        if case is None:
            warnings.append(f"Dropped a conflict with {item.case_code}: it wasn't in the related memory shown.")
            continue
        contradictions.append({**item.model_dump(), "case_code": case.case_code, "case_id": str(case.id)})
    return {"reusable_files": reusable, "contradictions": contradictions, "checked_cases": sorted(older)}, warnings


def _fake(files: dict[str, tuple[str, str]], context: ThreadContext) -> CuratorDraft:
    names = [
        n
        for n in files
        if n not in context.approvals
        and (n in context.deliverables or any(word in n.lower() for word in REUSABLE_NAMES))
    ]
    return CuratorDraft(
        reusable_files=[
            ReusableFileDraft(file_name=n, reason="A template future teams can start from.") for n in names
        ],
        contradictions=list[ContradictionDraft](),
    )
