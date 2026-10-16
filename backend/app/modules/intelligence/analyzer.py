"""Incoming request → ranked top-3 precedents → structured delta per precedent, guarded."""

import re
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import injection
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import ANALYZE_SYSTEM, analyze_user
from app.modules.intelligence.schemas import (
    CaseComparisonReport,
    DeltaItemDraft,
    IncomingRequest,
    PrecedentComparisonDraft,
    PrecedentContext,
)

ANALYZE_STEPS = (
    "Reading the incoming request",
    "Searching the Memory Bank",
    "Comparing with the top precedents",
    "Checking sources and scores",
)
OnStep = Callable[[str], Awaitable[None]]
TOP_K = 3
CHUNK_POOL = 60
TAG_BOOST = 3  # points per precedent tag value found in the request
DEPARTMENT_BOOST = 2
MAX_BOOST = 10
WORD = re.compile(r"[a-z0-9%$.]+")


class NoPrecedentsError(Exception):
    pass


async def rank_precedents(
    session: AsyncSession, incoming: IncomingRequest, departments: list[str], exclude_case_id
) -> list[PrecedentContext]:
    """Hybrid ranking: best chunk cosine similarity per resolved case + a capped metadata boost. Code sets scores."""
    [vector] = await llm_client.embed([incoming.query_text()])
    rows = await cases.nearest_chunks(session, vector, None, CHUNK_POOL, resolved_only=True)
    best: dict = {}
    for _chunk, case, distance in rows:
        if case.id == exclude_case_id:
            continue
        similarity = 1 - distance
        if case.id not in best or similarity > best[case.id][1]:
            best[case.id] = (case, similarity)

    haystack = " ".join([incoming.query_text().lower(), *(v.lower() for v in incoming.context_tags.values())])
    ranked = []
    for case, similarity in best.values():
        tag_hits = sum(1 for value in case.context_tags.values() if value and value.lower() in haystack)
        shared = {case.department_id, *case.secondary_department_ids} & set(departments)
        boost = min(MAX_BOOST, tag_hits * TAG_BOOST + (DEPARTMENT_BOOST if shared else 0))
        score = min(99, round(similarity * 100) + boost)
        ranked.append((score, similarity, boost, case))
    ranked.sort(key=lambda r: r[0], reverse=True)

    details = await cases.precedent_details(session, [case.id for *_, case in ranked[:TOP_K]])
    out = []
    for score, similarity, boost, case in ranked[:TOP_K]:
        detail = details[case.id]
        out.append(
            PrecedentContext(
                case_id=case.id,
                case_code=case.case_code,
                title=case.title,
                client_name=case.client_name,
                summary=case.summary or "",
                how_it_went=case.how_it_went or "",
                resolution_steps=case.resolution_steps,
                pitfalls=[p["warning"] for p in case.pitfalls],
                artifacts={a.file_name: a.id for a in detail["artifacts"]},
                reusable_artifacts=[a.file_name for a in detail["artifacts"] if a.is_reusable],
                similarity=score,
                vector_similarity=round(similarity, 4),
                boost=boost,
            )
        )
    return out


async def compare(
    incoming: IncomingRequest, precedents: list[PrecedentContext], *, model: str | None = None
) -> tuple[list[dict], list[str]]:
    if not precedents:
        raise NoPrecedentsError("The Memory Bank has no indexed cases to compare against yet.")
    marker = injection.nonce()
    incoming_block = "\n".join(
        [
            f"Case: {incoming.case_code} · {incoming.title}",
            f"Customer: {incoming.client_name or 'not recorded'} · Fund: {incoming.fund_name or 'not recorded'}",
            f"Source: {incoming.source_type or 'not recorded'}",
            *(f"{k}: {v}" for k, v in incoming.context_tags.items()),
            injection.fence("client request", incoming.brief, marker),
            *(injection.fence(f"file {name}", text[:3000], marker) for name, text in incoming.file_texts.items()),
        ]
    )
    precedent_blocks = "\n\n".join(
        f'<precedent case_code="{p.case_code}" retrieval_rank="{i}">\n'
        f"Title: {p.title}\nCustomer: {p.client_name}\nSummary: {p.summary}\nHow it went: {p.how_it_went}\n"
        f"Resolution steps:\n"
        + "\n".join(f"- {s}" for s in p.resolution_steps)
        + "\nPitfalls:\n"
        + "\n".join(f"- {w}" for w in p.pitfalls)
        + "\n"
        + "\n".join(f'<artifact name="{name}" reusable="{name in p.reusable_artifacts}"/>' for name in p.artifacts)
        + "\n</precedent>"
        for i, p in enumerate(precedents, 1)
    )
    report = await llm_client.complete_json(
        ANALYZE_SYSTEM,
        analyze_user(incoming_block, precedent_blocks),
        CaseComparisonReport,
        fake=lambda: _fake_report(precedents),
        model=model,
    )
    return guard_report(report, precedents)


def guard_report(report: CaseComparisonReport, precedents: list[PrecedentContext]) -> tuple[list[dict], list[str]]:
    """Retrieval decides which cases and scores; the model only fills text. Unverifiable files are dropped."""
    warnings: list[str] = []
    drafts = {c.case_code: c for c in report.comparisons}
    for code in set(drafts) - {p.case_code for p in precedents}:
        warnings.append(f"Dropped a comparison for {code}: it wasn't one of the retrieved precedents.")
    results = []
    for index, precedent in enumerate(precedents):
        draft = drafts.get(precedent.case_code)
        if draft is None:
            warnings.append(f"No comparison was written for {precedent.case_code}; showing its summary only.")
            draft = PrecedentComparisonDraft(case_code=precedent.case_code, how_past_case_went=precedent.summary or "—")
        items = []
        for item in draft.delta_items:
            source = item.source_artifact
            if item.status == "NET_NEW":
                source = None
            elif source and source not in precedent.artifacts:
                warnings.append(f"{precedent.case_code}: '{source}' isn't one of its files; source removed.")
                source = None
            if item.status == "NET_NEW" and index > 0:
                warnings.append(f"Moved a NET_NEW item from {precedent.case_code} under the top match.")
            items.append(
                {
                    "category": item.category,
                    "pastApproach": item.past_approach if item.status != "NET_NEW" else "No precedent in this case",
                    "currentRequirement": item.current_requirement,
                    "status": item.status,
                    "actionRecommendation": item.action_recommendation,
                    "sourceArtifact": source,
                    "sourceArtifactId": str(precedent.artifacts[source]) if source else None,
                    "_net_new": item.status == "NET_NEW",
                }
            )
        results.append(
            {
                "caseCode": precedent.case_code,
                "caseId": str(precedent.case_id),
                "similarityScore": precedent.similarity,
                "scoreBreakdown": {
                    "vector": round(precedent.vector_similarity * 100, 1),
                    "metadataBoost": precedent.boost,
                },
                "howPastCaseWent": draft.how_past_case_went,
                "pitfallWarnings": draft.pitfall_warnings,
                "deltaItems": items,
            }
        )
    # NET_NEW belongs to the request, not a precedent: keep them all under the top match.
    net_new = [i for r in results[1:] for i in r["deltaItems"] if i["_net_new"]]
    for r in results[1:]:
        r["deltaItems"] = [i for i in r["deltaItems"] if not i["_net_new"]]
    if results:
        results[0]["deltaItems"].extend(net_new)
    for r in results:
        for i in r["deltaItems"]:
            i.pop("_net_new")
    if not any(r["deltaItems"] for r in results):
        raise ValueError("The comparison produced no delta items")
    return results, warnings


def _fake_report(precedents: list[PrecedentContext]) -> CaseComparisonReport:
    comparisons = []
    for precedent in precedents:
        items = [
            DeltaItemDraft(
                category=name.rsplit(".", 1)[0].replace("_", " ")[:120],
                past_approach=f"Built and used in {precedent.case_code}.",
                current_requirement="Similar need in the incoming request.",
                status="REUSABLE",
                action_recommendation=f"Review {name} and reuse it, adjusting parameters to this request.",
                source_artifact=name,
            )
            for name in precedent.reusable_artifacts[:3]
        ]
        comparisons.append(
            PrecedentComparisonDraft(
                case_code=precedent.case_code,
                how_past_case_went=(precedent.summary or precedent.how_it_went or precedent.title)[:800],
                pitfall_warnings=precedent.pitfalls[:2],
                delta_items=items,
            )
        )
    return CaseComparisonReport(comparisons=comparisons)
