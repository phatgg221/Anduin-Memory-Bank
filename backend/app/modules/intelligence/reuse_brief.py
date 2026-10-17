"""Reuse brief: a file pulled from a past case → what it is, why it fits this case, what to change, what to watch.

Evidence is the file's own pages closest to this case and this case's files closest to the file; code maps E-tags
to cases, files and pages.
"""

import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import injection
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import REUSE_SYSTEM, reuse_user
from app.modules.intelligence.reviewer import Evidence, _body, _citation, evidence_block
from app.modules.intelligence.schemas import ReuseBriefDraft, ReuseChangeDraft, ReuseWarningDraft

REUSE_STEPS = ("Opening the file and its case", "Comparing it with this case", "Writing the reuse brief")
OnStep = Callable[[str], Awaitable[None]]
CASE_CODE = re.compile(r"CASE-\d{4}-\d{3}")
FILE_PAGES = 4
OWN_FILES = 3
VERDICTS = {"READY": "Ready to use", "ADAPT": "Adapt first", "CAUTION": "Use with caution"}


@dataclass
class ReuseContext:
    case_id: uuid.UUID
    case_block: str
    file_id: uuid.UUID
    file_name: str
    file_type: str
    file_text: str
    source: (
        dict  # case_id, case_code, case_title, lead_name, lead_alumni, block (summary, how it went, pitfalls, delta)
    )
    marker: str = field(default_factory=injection.nonce)


async def gather_evidence(session: AsyncSession, context: ReuseContext) -> list[Evidence]:
    vectors = await llm_client.embed([context.case_block[:2000], f"{context.file_name}\n{context.file_text[:1500]}"])
    pages = await cases.nearest_chunks(session, vectors[0], None, FILE_PAGES, artifact_id=context.file_id)
    own = await cases.nearest_chunks(session, vectors[1], None, OWN_FILES, case_id=context.case_id)
    hits = [*pages, *[hit for hit in own if hit[0].artifact_id]]
    evidence = [
        Evidence(f"E{i}", _citation(chunk, case, context.case_id), _body(chunk.content)[:900], distance)
        for i, (chunk, case, distance) in enumerate(hits, start=1)
    ]
    if not pages and context.file_text:
        evidence.insert(
            0,
            Evidence(
                "E0",
                {
                    "case_id": context.source["case_id"],
                    "case_code": context.source["case_code"],
                    "case_title": context.source["case_title"],
                    "this_case": False,
                    "label": context.file_name,
                    "artifact_id": str(context.file_id),
                    "file_name": context.file_name,
                    "page": None,
                    "message_id": None,
                    "quote": " ".join(context.file_text.split())[:240],
                },
                context.file_text[:1500],
                0.0,
            ),
        )
    return evidence


def _sources(tags: list[str], by_tag: dict[str, Evidence], warnings: list[str], what: str) -> list[dict]:
    citations, seen = [], set()
    for tag in (t.strip().upper().strip("[]") for t in tags):
        if tag not in by_tag:
            warnings.append(f"Removed unknown source {tag} from “{what[:60]}”.")
            continue
        key = (by_tag[tag].citation["case_id"], by_tag[tag].citation["label"])
        if key not in seen:
            seen.add(key)
            citations.append(by_tag[tag].citation)
    return citations


def guard_brief(draft: ReuseBriefDraft, evidence: list[Evidence], source_code: str) -> tuple[dict, list[str]]:
    by_tag = {e.tag: e for e in evidence}
    known = {source_code} | {e.citation["case_code"] for e in evidence}
    warnings: list[str] = []
    changes = [
        {"change": c.change, "why": c.why, "citations": _sources(c.evidence, by_tag, warnings, c.change)}
        for c in draft.changes
    ]
    watch_outs = [
        {"warning": w.warning, "citations": _sources(w.evidence, by_tag, warnings, w.warning)} for w in draft.watch_outs
    ]
    text = " ".join([draft.what_it_is, draft.fit, *(c.change + c.why for c in draft.changes)])
    text += " ".join(w.warning for w in draft.watch_outs)
    for code in sorted(set(CASE_CODE.findall(text)) - known):
        warnings.append(f"The brief mentions {code}, which isn't the source case or in the evidence.")
    verdict = draft.verdict
    if verdict == "READY" and changes:
        verdict = "ADAPT"
    brief = {"verdict": verdict, "what_it_is": draft.what_it_is, "fit": draft.fit, "changes": changes}
    return {**brief, "watch_outs": watch_outs}, warnings


def _fake_brief(context: ReuseContext, evidence: list[Evidence]) -> ReuseBriefDraft:
    code = context.source["case_code"]
    tag = [evidence[0].tag] if evidence else []
    pitfall = context.source.get("first_pitfall")
    return ReuseBriefDraft(
        verdict="ADAPT",
        what_it_is=f"{context.file_name} is the {context.file_type.replace('_', ' ').lower()} from [{code}].",
        fit=f"[{code}] solved a similar problem, so this file is a tested starting point for this case.",
        changes=[
            ReuseChangeDraft(
                change="Check every value against this case's request.", why="The two cases differ.", evidence=tag
            )
        ],
        watch_outs=[ReuseWarningDraft(warning=pitfall, evidence=[])] if pitfall else [],
    )


def brief_text(payload: dict) -> str:
    file = payload["file"]
    lines = [
        f"Reuse brief · {file['file_name']} from [{file['case_code']}]: {VERDICTS[payload['verdict']]}.",
        payload["what_it_is"],
        payload["fit"],
        *(f"Change: {c['change']} ({c['why']})" for c in payload["changes"]),
        *(f"Watch out: {w['warning']}" for w in payload["watch_outs"]),
    ]
    return "\n".join(lines)[:8000]


async def brief(session: AsyncSession, context: ReuseContext, on_step: OnStep) -> dict:
    await on_step(REUSE_STEPS[1])
    evidence = await gather_evidence(session, context)
    await on_step(REUSE_STEPS[2])
    source_block = injection.fence(f"file {context.file_name}", context.file_text[:3000], context.marker)
    draft = await llm_client.complete_json(
        REUSE_SYSTEM,
        reuse_user(
            context.case_block,
            f"{context.source['block']}\n\nFile: {context.file_name} ({context.file_type})\n{source_block}",
            evidence_block(evidence, context.marker),
        ),
        ReuseBriefDraft,
        fake=lambda: _fake_brief(context, evidence),
    )
    body, warnings = guard_brief(draft, evidence, context.source["case_code"])
    return {
        "kind": "reuse",
        "file": {
            "artifact_id": str(context.file_id),
            "file_name": context.file_name,
            "file_type": context.file_type,
            "case_id": context.source["case_id"],
            "case_code": context.source["case_code"],
            "case_title": context.source["case_title"],
            "lead_name": context.source["lead_name"],
            "lead_alumni": context.source["lead_alumni"],
        },
        **body,
        "sources_checked": len(evidence),
        "guard_warnings": warnings,
    }
