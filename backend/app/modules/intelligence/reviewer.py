"""Solution review: a picked stretch of the case channel → claims → evidence per claim → guarded verdicts.

The model only ever sees evidence as E-tags and messages as M-numbers; code turns them into cases, files and pages.
"""

import re
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import injection
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import REVIEW_CLAIMS_SYSTEM, REVIEW_SYSTEM, review_claims_user, review_user
from app.modules.intelligence.schemas import (
    ReviewClaimDraft,
    ReviewClaimsDraft,
    ReviewDraft,
    ReviewFindingDraft,
)

REVIEW_STEPS = (
    "Reading the selected messages",
    "Pulling out the proposed solution",
    "Checking it against the Memory Bank",
    "Writing the review",
)
OnStep = Callable[[str], Awaitable[None]]
CASE_CODE = re.compile(r"CASE-\d{4}-\d{3}")
TAG = re.compile(r"E(\d+)$")
PAST_PER_CLAIM = 4
OWN_PER_CLAIM = 2
MAX_EVIDENCE = 24
EXCERPT_CHARS = 700
LABELS = {
    "SUPPORTED": "matches past work",
    "CONFLICTS": "conflicts",
    "NO_PRECEDENT": "no precedent",
    "MISSING": "missing",
}
MARKS = {"SUPPORTED": "✓", "CONFLICTS": "✗", "NO_PRECEDENT": "?", "MISSING": "+"}


@dataclass
class ReviewMessage:
    id: uuid.UUID
    author: str
    at: str
    content: str
    file_name: str | None = None
    sent_at: str = ""


@dataclass
class ReviewContext:
    case_id: uuid.UUID
    case_code: str
    case_block: str
    messages: list[ReviewMessage]
    focus: str | None = None
    marker: str = field(default_factory=injection.nonce)


@dataclass
class Evidence:
    tag: str
    citation: dict
    text: str
    distance: float


def excerpt_block(context: ReviewContext) -> str:
    lines = [
        f"M{i} · {m.author} · {m.at}: {m.content}" + (f" [file: {m.file_name}]" if m.file_name else "")
        for i, m in enumerate(context.messages, start=1)
    ]
    return injection.fence("case channel excerpt", "\n".join(lines), context.marker)


def _body(content: str) -> str:
    """A chunk without its two header lines (case line, label line), for a short quote."""
    lines = content.split("\n")
    return " ".join(" ".join(lines[2:] if len(lines) > 2 else lines).split())


def _citation(chunk, case, this_case: uuid.UUID) -> dict:
    label = chunk.reference_label or chunk.chunk_type.replace("_", " ").title()
    file_name = label.split(" · ", 1)[0] if chunk.artifact_id else None
    return {
        "case_id": str(case.id),
        "case_code": case.case_code,
        "case_title": case.title,
        "this_case": case.id == this_case,
        "label": label,
        "artifact_id": str(chunk.artifact_id) if chunk.artifact_id else None,
        "file_name": file_name,
        "page": chunk.page_number,
        "message_id": str(chunk.message_id) if chunk.message_id else None,
        "quote": _body(chunk.content)[:240],
    }


async def gather_evidence(
    session: AsyncSession, context: ReviewContext, claims: list[ReviewClaimDraft]
) -> list[Evidence]:
    """Nearest memory per claim (resolved cases) plus this case's own files, deduplicated and tagged E1, E2, ..."""
    whole = " ".join(m.content for m in context.messages)[:2000]
    queries = [c.text for c in claims] + [f"{context.focus or ''} {whole}".strip()]
    vectors = await llm_client.embed(queries)
    found: dict[uuid.UUID, tuple] = {}
    for vector in vectors:
        past = await cases.nearest_chunks(session, vector, None, PAST_PER_CLAIM, resolved_only=True)
        own = await cases.nearest_chunks(session, vector, None, OWN_PER_CLAIM, case_id=context.case_id)
        for chunk, case, distance in [*past, *[hit for hit in own if hit[0].artifact_id]]:
            if chunk.id not in found or distance < found[chunk.id][2]:
                found[chunk.id] = (chunk, case, distance)
    ranked = sorted(found.values(), key=lambda hit: hit[2])[:MAX_EVIDENCE]
    return [
        Evidence(f"E{i}", _citation(chunk, case, context.case_id), _body(chunk.content)[:EXCERPT_CHARS], distance)
        for i, (chunk, case, distance) in enumerate(ranked, start=1)
    ]


def evidence_block(evidence: list[Evidence], marker: str) -> str:
    blocks = []
    for item in evidence:
        c = item.citation
        where = "THIS CASE's file" if c["this_case"] else f"past case [{c['case_code']}] {c['case_title']}"
        blocks.append(f"[{item.tag}] {where} · {c['label']}\n{item.text}")
    return injection.fence("memory and files", "\n\n".join(blocks) or "(nothing relevant found)", marker)


def guard_review(
    draft: ReviewDraft, evidence: list[Evidence], messages: list[ReviewMessage]
) -> tuple[list[dict], list[str]]:
    """Only evidence tags and message numbers that exist survive; a verdict needing a source and having none is
    downgraded (or dropped, for MISSING). Codes mentioned in comments must be in the cited evidence."""
    by_tag = {e.tag: e for e in evidence}
    known_codes = {e.citation["case_code"] for e in evidence}
    findings, warnings = [], []
    for item in draft.findings:
        tags = [t.strip().upper().strip("[]") for t in item.evidence]
        citations, seen = [], set()
        for tag in tags:
            if tag in by_tag and (key := (by_tag[tag].citation["case_id"], by_tag[tag].citation["label"])) not in seen:
                seen.add(key)
                citations.append(by_tag[tag].citation)
        if dropped := [t for t in tags if t not in by_tag]:
            warnings.append(f"Removed unknown source(s) {', '.join(dropped)} from “{item.claim[:60]}”.")
        message_ids = [str(messages[n - 1].id) for n in dict.fromkeys(item.messages) if 1 <= n <= len(messages)]
        verdict = item.verdict
        if verdict != "NO_PRECEDENT" and not citations:
            if verdict == "MISSING":
                warnings.append(f"Dropped “{item.claim[:60]}”: no source backs it.")
                continue
            warnings.append(f"“{item.claim[:60]}” had no checked source, so it's marked as no precedent.")
            verdict = "NO_PRECEDENT"
        for code in sorted(set(CASE_CODE.findall(item.comment)) - known_codes):
            warnings.append(f"The comment on “{item.claim[:60]}” mentions {code}, which isn't in the evidence.")
        findings.append(
            {
                "claim": item.claim,
                "verdict": verdict,
                "comment": item.comment,
                "message_ids": message_ids,
                "citations": citations,
            }
        )
    return findings, warnings


def _fake_claims(context: ReviewContext) -> ReviewClaimsDraft:
    picked = [(i, m) for i, m in enumerate(context.messages, start=1) if len(m.content) >= 20][:6]
    return ReviewClaimsDraft(claims=[ReviewClaimDraft(text=m.content[:400], messages=[i]) for i, m in picked])


def _fake_review(claims: list[ReviewClaimDraft], evidence: list[Evidence]) -> ReviewDraft:
    past = [e for e in evidence if not e.citation["this_case"]]
    findings = [
        ReviewFindingDraft(
            claim=claim.text,
            verdict="SUPPORTED" if past else "NO_PRECEDENT",
            comment=(
                f"Closest past work: [{past[0].citation['case_code']}] {past[0].citation['label']}."
                if past
                else "Nothing in the Memory Bank covers this yet; verify it before it goes to the client."
            ),
            evidence=[past[0].tag] if past else [],
            messages=claim.messages,
        )
        for claim in claims
    ]
    return ReviewDraft(overall="Checked against the closest past cases in the Memory Bank.", findings=findings)


def review_text(payload: dict) -> str:
    """The review as plain text: what the channel transcript, search and notifications see."""
    counts = payload["counts"]
    tally = " · ".join(f"{counts[v]} {LABELS[v]}" for v in LABELS if counts.get(v))
    lines = [f"Review of {payload['range']['count']} messages: {tally or 'nothing to check'}.", payload["overall"]]
    for finding in payload["findings"]:
        sources = "; ".join(
            f"[{c['case_code']}] {c['label']}" if not c["this_case"] else c["label"] for c in finding["citations"]
        )
        lines.append(
            f"{MARKS[finding['verdict']]} {finding['claim']} — {finding['comment']}"
            + (f" ({sources})" if sources else "")
        )
    return "\n".join(lines)[:8000]


async def review(session: AsyncSession, context: ReviewContext, on_step: OnStep) -> dict:
    excerpt = excerpt_block(context)
    await on_step(REVIEW_STEPS[1])
    claims = (
        await llm_client.complete_json(
            REVIEW_CLAIMS_SYSTEM,
            review_claims_user(context.case_block, excerpt, context.focus),
            ReviewClaimsDraft,
            fake=lambda: _fake_claims(context),
        )
    ).claims
    await on_step(REVIEW_STEPS[2])
    evidence = await gather_evidence(session, context, claims) if claims or context.focus else []
    await on_step(REVIEW_STEPS[3])
    claim_lines = "\n".join(
        f"- {c.text} (M{', M'.join(map(str, c.messages))})" if c.messages else f"- {c.text}" for c in claims
    )
    draft = await llm_client.complete_json(
        REVIEW_SYSTEM,
        review_user(
            context.case_block,
            excerpt,
            claim_lines or "(none found)",
            evidence_block(evidence, context.marker),
            context.focus,
        ),
        ReviewDraft,
        fake=lambda: _fake_review(claims, evidence),
    )
    findings, warnings = guard_review(draft, evidence, context.messages)
    first, last = context.messages[0], context.messages[-1]
    payload = {
        "kind": "review",
        "range": {
            "from_message_id": str(first.id),
            "to_message_id": str(last.id),
            "message_ids": [str(m.id) for m in context.messages],
            "count": len(context.messages),
            "from_at": first.sent_at or first.at,
            "to_at": last.sent_at or last.at,
        },
        "focus": context.focus,
        "overall": draft.overall,
        "findings": findings,
        "counts": dict(Counter(f["verdict"] for f in findings)),
        "sources_checked": len(evidence),
        "guard_warnings": warnings,
    }
    return payload
