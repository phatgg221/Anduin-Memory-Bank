"""Memory Copilot: one question about a case → a grounded answer whose citations are checked by code."""

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import COPILOT_SYSTEM, copilot_user
from app.modules.intelligence.schemas import CopilotAnswerDraft

COPILOT_STEPS = ("Reading the case", "Searching the Memory Bank", "Writing the answer")
OnStep = Callable[[str], Awaitable[None]]
CASE_CODE = re.compile(r"CASE-\d{4}-\d{3}")
MEMORY_HITS = 8


@dataclass
class CopilotContext:
    case_block: str
    precedents: list[dict]  # from cases.precedents_for: code, title, summary, pitfalls, lead, files
    history: list[tuple[str, str]] = field(default_factory=list)  # (role, content), oldest first
    channel: str = ""  # the case channel as a numbered transcript: what the team has said so far


async def answer(session: AsyncSession, context: CopilotContext, question: str, on_step: OnStep) -> dict:
    await on_step(COPILOT_STEPS[1])
    [vector] = await llm_client.embed([f"{question}\n{context.case_block[:2000]}"])
    hits = await cases.nearest_chunks(session, vector, None, MEMORY_HITS, resolved_only=True)

    allowed_cases = {p["case_code"]: str(p["case_id"]) for p in context.precedents if p["case_id"]}
    allowed_cases |= {case.case_code: str(case.id) for _, case, _ in hits}
    files = {a.file_name: str(a.id) for p in context.precedents for a in p["artifacts"]}

    precedent_block = "\n\n".join(
        f'<precedent case_code="{p["case_code"]}" similarity="{p["similarity_score"]}%">\n'
        f"{p['title']}\nLead: {p['lead_name'] or 'unknown'}{' [ALUMNI]' if p['lead_is_alumni'] else ''}\n"
        f"How it went: {p['how_it_went'] or p['how_past_case_went']}\n"
        f"Pitfalls: {'; '.join(p['pitfall_warnings'])}\n"
        f"Files: {', '.join(a.file_name for a in p['artifacts'])}\n</precedent>"
        for p in context.precedents
    )
    memory_block = "\n".join(
        f"[{case.case_code} · {chunk.reference_label or chunk.chunk_type}] {chunk.content[:900]}"
        for chunk, case, _ in hits
    )
    history = "\n".join(f"{role}: {content}" for role, content in context.history[-6:])

    await on_step(COPILOT_STEPS[2])
    draft = await llm_client.complete_json(
        COPILOT_SYSTEM,
        copilot_user(context.case_block, precedent_block, memory_block, history, question, context.channel[-12000:]),
        CopilotAnswerDraft,
        fake=lambda: _fake_answer(context, question, hits),
    )

    mentioned = set(CASE_CODE.findall(draft.answer)) | set(draft.cited_case_codes)
    warnings = sorted(code for code in mentioned if code not in allowed_cases)
    cited_cases = [allowed_cases[code] for code in sorted(mentioned) if code in allowed_cases]
    cited_files = [file_id for name, file_id in files.items() if name in draft.answer]
    return {
        "answer": draft.answer,
        "cited_case_ids": cited_cases,
        "cited_artifact_ids": cited_files,
        "uncited_case_codes": warnings,
    }


def _fake_answer(context: CopilotContext, question: str, hits) -> CopilotAnswerDraft:
    if context.precedents:
        top = context.precedents[0]
        text = (
            f"Closest precedent: [{top['case_code']}] {top['title']} ({top['similarity_score']}% match). "
            f"{top['how_past_case_went']}"
        )
        if top["pitfall_warnings"]:
            text += f" Watch out: {top['pitfall_warnings'][0]}"
        return CopilotAnswerDraft(answer=text[:4000], cited_case_codes=[top["case_code"]])
    if hits:
        _, case, _ = hits[0]
        return CopilotAnswerDraft(
            answer=f"The closest memory is [{case.case_code}] {case.title}.", cited_case_codes=[case.case_code]
        )
    return CopilotAnswerDraft(answer="I couldn't find anything in the Memory Bank about this yet.")
