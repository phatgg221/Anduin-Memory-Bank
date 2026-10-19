"""Memory Copilot: the model investigates the Memory Bank with tools, then writes an answer whose citations code checks.

The model chooses what to look up; code runs every lookup and keeps only the cases and files that a tool or the
case's matched precedents returned.
"""

import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import COPILOT_AGENT_SYSTEM, COPILOT_SYSTEM, copilot_agent_user, copilot_user
from app.modules.intelligence.schemas import CopilotAnswerDraft, IncomingRequest
from app.modules.intelligence.triage_agent import LABELS, TOOLS, Evidence, OnTrace, Toolbox, _tool, tool_loop

COPILOT_STEPS = ("Reading the case", "Investigating the Memory Bank", "Writing the answer")
OnStep = Callable[[str], Awaitable[None]]
CASE_CODE = re.compile(r"CASE-\d{4}-\d{3}")
MAX_TOOL_CALLS = 6
CASE_FILE_HITS = 6

COPILOT_TOOLS = [
    *TOOLS,
    _tool(
        "search_case_files",
        "Semantic search over THIS case's own intake brief and uploaded files. Returns matching excerpts with "
        "file name and page.",
        {"query": {"type": "string", "description": "What to look for, in plain words."}},
        ["query"],
    ),
]


@dataclass
class CopilotContext:
    case: object
    incoming: IncomingRequest
    case_block: str
    precedents: list[dict]  # from cases.precedents_for: code, title, summary, pitfalls, lead, files
    history: list[tuple[str, str]] = field(default_factory=list)  # (role, content), oldest first
    channel: str = ""  # the case channel as a numbered transcript: what the team has said so far


class CopilotToolbox(Toolbox):
    labels = {**LABELS, "search_case_files": "Searched this case's files"}

    async def search_case_files(self, query: str = "") -> tuple[dict, str]:
        query = str(query).strip()[:500] or self.incoming.title
        [vector] = await llm_client.embed([query])
        rows = await cases.nearest_chunks(self.session, vector, None, CASE_FILE_HITS, case_id=self.case.id)
        hits = [
            {"where": chunk.reference_label or chunk.chunk_type, "page": chunk.page_number, "text": chunk.content[:600]}
            for chunk, _, _ in rows
        ]
        detail = f'"{query[:70]}" → ' + (", ".join(h["where"] for h in hits[:3]) or "nothing indexed for this case")
        return {"excerpts": hits}, detail


async def answer(
    session: AsyncSession, context: CopilotContext, question: str, on_step: OnStep, on_trace: OnTrace
) -> dict:
    await on_step(COPILOT_STEPS[1])
    evidence = Evidence()
    tools = CopilotToolbox(session, context.case, context.incoming, evidence, on_trace)
    if settings.llm_provider == "fake":
        await tools.run("search_knowledge_vault", {"query": f"{question}\n{context.case_block[:1500]}"})
    else:
        await tool_loop(
            COPILOT_AGENT_SYSTEM,
            copilot_agent_user(context.case_block, _precedent_codes(context), _history(context), question),
            COPILOT_TOOLS,
            tools,
            MAX_TOOL_CALLS,
        )
    if evidence.tool_calls == 0:
        await tools.run("search_knowledge_vault", {"query": question}, auto=True)

    known = await _resolved(session, evidence)
    allowed_cases = {p["case_code"]: str(p["case_id"]) for p in context.precedents if p["case_id"]}
    allowed_cases |= {code: str(data["case"].id) for code, data in known.items()}
    allowed_cases |= {code: d["case_id"] for code, d in evidence.duplicates.items()}
    files = {a.file_name: str(a.id) for p in context.precedents for a in p["artifacts"]}
    files |= {a.file_name: str(a.id) for data in known.values() for a in data["case"].artifacts}

    await on_step(COPILOT_STEPS[2])
    draft = await llm_client.complete_json(
        COPILOT_SYSTEM,
        copilot_user(
            context.case_block,
            _precedent_block(context),
            _findings_block(tools, evidence),
            _history(context),
            question,
            context.channel[-12000:],
        ),
        CopilotAnswerDraft,
        fake=lambda: _fake_answer(context, evidence),
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
        "investigation": {
            "tool_calls": evidence.tool_calls,
            "repeats_skipped": evidence.repeats,
            "agent": evidence.agent_ran,
            "model": llm_client.agent_label(),
        },
    }


async def _resolved(session: AsyncSession, evidence: Evidence) -> dict[str, dict]:
    codes = sorted(set(evidence.vault) | set(evidence.details))
    return await cases.resolved_cases_by_code(session, codes) if codes else {}


def _history(context: CopilotContext) -> str:
    return "\n".join(f"{role}: {content}" for role, content in context.history[-6:])


def _precedent_codes(context: CopilotContext) -> str:
    return ", ".join(f"{p['case_code']} {p['similarity_score']}% · {p['title']}" for p in context.precedents)


def _precedent_block(context: CopilotContext) -> str:
    return "\n\n".join(
        f'<precedent case_code="{p["case_code"]}" similarity="{p["similarity_score"]}%">\n'
        f"{p['title']}\nLead: {p['lead_name'] or 'unknown'}{' [ALUMNI]' if p['lead_is_alumni'] else ''}\n"
        f"How it went: {p['how_it_went'] or p['how_past_case_went']}\n"
        f"Pitfalls: {'; '.join(p['pitfall_warnings'])}\n"
        f"Files: {', '.join(a.file_name for a in p['artifacts'])}\n</precedent>"
        for p in context.precedents
    )


def _findings_block(tools: Toolbox, evidence: Evidence) -> str:
    lines = [
        f'<tool name="{r["tool"]}" args={json.dumps(r["args"], default=str)}>\n'
        f"{json.dumps(r['result'], default=str, ensure_ascii=False)[:3000]}\n</tool>"
        for r in tools.results
    ]
    if evidence.notes:
        lines.append(f"<agent_notes>{evidence.notes}</agent_notes>")
    return "\n".join(lines)[:16000]


def _fake_answer(context: CopilotContext, evidence: Evidence) -> CopilotAnswerDraft:
    if context.precedents:
        top = context.precedents[0]
        text = (
            f"Closest precedent: [{top['case_code']}] {top['title']} ({top['similarity_score']}% match). "
            f"{top['how_past_case_went']}"
        )
        if top["pitfall_warnings"]:
            text += f" Watch out: {top['pitfall_warnings'][0]}"
        return CopilotAnswerDraft(answer=text[:4000], cited_case_codes=[top["case_code"]])
    if evidence.vault:
        hit = next(iter(evidence.vault.values()))
        return CopilotAnswerDraft(
            answer=f"The closest memory is [{hit['case_code']}] {hit['title']}.", cited_case_codes=[hit["case_code"]]
        )
    return CopilotAnswerDraft(answer="I couldn't find anything in the Memory Bank about this yet.")
