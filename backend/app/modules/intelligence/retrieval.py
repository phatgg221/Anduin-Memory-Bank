"""Semantic search over the Memory Bank: embed the query, rank chunks by cosine distance, group by case."""

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.cases import service as cases
from app.modules.intelligence import llm_client

SNIPPET_CHARS = 400


async def search(session: AsyncSession, query: str, department_id: str | None, limit: int) -> dict:
    [vector] = await llm_client.embed([query])
    rows = await cases.nearest_chunks(session, vector, department_id, limit)
    hits = []
    by_case: dict[str, dict] = {}
    for chunk, case, distance in rows:
        similarity = round((1 - distance) * 100, 1)
        hits.append(
            {
                "case_id": case.id,
                "case_code": case.case_code,
                "chunk_type": chunk.chunk_type,
                "reference_label": chunk.reference_label,
                "snippet": chunk.content[:SNIPPET_CHARS],
                "similarity": similarity,
            }
        )
        best = by_case.get(case.case_code)
        if best is None:
            lead = case.lead_resolver
            by_case[case.case_code] = {
                "case_id": case.id,
                "case_code": case.case_code,
                "title": case.title,
                "status": case.status,
                "department_id": case.department_id,
                "best_similarity": similarity,
                "matching_chunks": 1,
                "lead_name": lead.name if lead else None,
                "lead_is_alumni": bool(lead and not lead.is_active),
            }
        else:
            best["matching_chunks"] += 1
    return {
        "query": query,
        "embedding_model": llm_client.embedding_label(),
        "cases": list(by_case.values()),
        "hits": hits,
    }
