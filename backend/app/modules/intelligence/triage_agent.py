"""Autonomous triage: the model investigates the Memory Bank with tools, then writes a report that code guards.

The model chooses what to look at; code runs every lookup, computes every score, number and ID, and drops anything
in the final report that no tool returned. Read-only: the triage worker persists the result.
"""

import json
import re
import statistics
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.modules.cases import service as cases
from app.modules.intelligence import llm_client
from app.modules.intelligence.prompts import (
    TRIAGE_AGENT_SYSTEM,
    TRIAGE_REPORT_SYSTEM,
    triage_agent_user,
    triage_report_user,
)
from app.modules.intelligence.schemas import (
    DuplicateDraft,
    IncomingRequest,
    MissingInfoDraft,
    PrecedentContext,
    TeamPickDraft,
    TriageReportDraft,
)

TRIAGE_STEPS = (
    "Reading & indexing the request",
    "Investigating the Memory Bank",
    "Writing the triage report",
    "Checking sources and scores",
)
MAX_TOOL_CALLS = 8
DUPLICATE_THRESHOLD = 55  # % similarity for an unrelated-client open case to count as overlapping
CASE_CODE = re.compile(r"CASE-\d{4}-\d{3}")
RISK_ORDER = ("LOW", "MEDIUM", "HIGH", "CRITICAL")
OnTrace = Callable[[dict[str, Any]], Awaitable[None]]


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


CODES = {"type": "array", "items": {"type": "string"}, "description": "Case codes like CASE-2025-014 (max 5)."}
TOOLS = [
    _tool(
        "search_knowledge_vault",
        "Semantic search (pgvector) over resolved cases: summaries, team discussions, playbooks and file contents. "
        "Returns matching cases with similarity % and excerpts. Search each sub-problem separately.",
        {"query": {"type": "string", "description": "What to look for, in plain words."}},
        ["query"],
    ),
    _tool(
        "check_active_duplicates",
        "Find OPEN cases that overlap with this request: same client, or a similar problem already being worked on.",
        {},
        [],
    ),
    _tool(
        "get_case_details",
        "Open one resolved case: how it went, resolution steps, pitfalls, duration, lead (with ALUMNI status), files.",
        {"case_code": {"type": "string"}},
        ["case_code"],
    ),
    _tool(
        "find_people",
        "Who worked on these resolved cases, whether they are still here (ALUMNI = left), and for alumni which "
        "active colleagues worked alongside them.",
        {"case_codes": CODES},
        ["case_codes"],
    ),
    _tool(
        "estimate_effort",
        "How long these resolved cases took, compared with this request's deadline.",
        {"case_codes": CODES},
        ["case_codes"],
    ),
]
LABELS = {
    "search_knowledge_vault": "Searched the Knowledge Vault",
    "check_active_duplicates": "Checked active cases for duplicates",
    "get_case_details": "Opened a past case",
    "find_people": "Looked up who solved it",
    "estimate_effort": "Estimated effort from past cases",
}


@dataclass
class Evidence:
    vault: dict[str, dict] = field(default_factory=dict)
    details: dict[str, dict] = field(default_factory=dict)
    people: dict[str, dict] = field(default_factory=dict)
    duplicates: dict[str, dict] = field(default_factory=dict)
    effort: dict | None = None
    queries: list[str] = field(default_factory=list)
    notes: str = ""
    tool_calls: int = 0
    called: set[str] = field(default_factory=set)
    agent_ran: bool = False

    def known_codes(self) -> set[str]:
        return set(self.vault) | set(self.details)


def _person(user) -> dict:
    return {
        "user_id": str(user.id),
        "name": user.name,
        "job_title": user.job_title,
        "department_id": user.primary_department_id,
        "active": user.is_active,
        "departed_at": user.departed_at.isoformat() if user.departed_at else None,
    }


class Toolbox:
    def __init__(self, session: AsyncSession, case, incoming: IncomingRequest, evidence: Evidence, on_trace: OnTrace):
        self.session = session
        self.case = case
        self.incoming = incoming
        self.evidence = evidence
        self.on_trace = on_trace
        self._request_vector: list[float] | None = None

    async def run(self, name: str, args: dict, *, auto: bool = False) -> dict:
        handler = {
            "search_knowledge_vault": self.search_knowledge_vault,
            "check_active_duplicates": self.check_active_duplicates,
            "get_case_details": self.get_case_details,
            "find_people": self.find_people,
            "estimate_effort": self.estimate_effort,
        }.get(name)
        if handler is None:
            return {"error": f"Unknown tool {name}"}
        try:
            result, detail = await handler(**args)
        except TypeError:
            return {"error": f"Bad arguments for {name}"}
        self.evidence.tool_calls += 1
        self.evidence.called.add(name)
        await self.on_trace({"tool": name, "label": LABELS[name], "detail": detail, "auto": auto})
        return result

    async def _vector(self) -> list[float]:
        if self._request_vector is None:
            [self._request_vector] = await llm_client.embed([self.incoming.query_text()])
        return self._request_vector

    async def search_knowledge_vault(self, query: str = "") -> tuple[dict, str]:
        query = str(query).strip()[:500] or self.incoming.title
        self.evidence.queries.append(query)
        [vector] = await llm_client.embed([query])
        rows = await cases.nearest_chunks(self.session, vector, None, 40, resolved_only=True)
        found: dict[str, dict] = {}
        for chunk, case, distance in rows:
            similarity = round((1 - distance) * 100)
            entry = found.setdefault(
                case.case_code,
                {
                    "case_code": case.case_code,
                    "title": case.title,
                    "client": case.client_name,
                    "similarity": similarity,
                    "lead": case.lead_resolver.name if case.lead_resolver else None,
                    "lead_is_alumni": bool(case.lead_resolver and not case.lead_resolver.is_active),
                    "excerpts": [],
                },
            )
            if len(entry["excerpts"]) < 2:
                entry["excerpts"].append({"where": chunk.reference_label, "text": chunk.content[:280]})
        top = sorted(found.values(), key=lambda e: e["similarity"], reverse=True)[:5]
        for entry in top:
            known = self.evidence.vault.get(entry["case_code"])
            if not known or entry["similarity"] > known["similarity"]:
                self.evidence.vault[entry["case_code"]] = {k: v for k, v in entry.items() if k != "excerpts"}
        detail = f'"{query[:70]}" → ' + (
            ", ".join(f"{e['case_code']} ({e['similarity']}%)" for e in top[:3]) or "no matches"
        )
        return {"results": top}, detail

    async def check_active_duplicates(self) -> tuple[dict, str]:
        near = await cases.nearest_open_cases(self.session, await self._vector(), self.case.id, 5)
        same = await cases.open_cases_for_client(self.session, self.incoming.client_name, self.case.id)
        found: dict[str, dict] = {}
        for case, similarity in near:
            found[case.case_code] = self._duplicate(case, round(similarity * 100), False)
        for case in same:
            found.setdefault(case.case_code, self._duplicate(case, None, True))["same_client"] = True
        overlapping = [d for d in found.values() if d["same_client"] or (d["similarity"] or 0) >= DUPLICATE_THRESHOLD]
        for d in overlapping:
            self.evidence.duplicates[d["case_code"]] = d
        detail = (
            ", ".join(
                f"{d['case_code']} ({'same client' if d['same_client'] else ''}"
                f"{', ' if d['same_client'] and d['similarity'] else ''}"
                f"{str(d['similarity']) + '%' if d['similarity'] else ''})"
                for d in overlapping[:3]
            )
            or "No overlapping active cases"
        )
        return {"overlapping_open_cases": overlapping}, detail

    @staticmethod
    def _duplicate(case, similarity: int | None, same_client: bool) -> dict:
        return {
            "case_code": case.case_code,
            "case_id": str(case.id),
            "title": case.title,
            "client": case.client_name,
            "similarity": similarity,
            "same_client": same_client,
            "owner": case.lead_resolver.name if case.lead_resolver else None,
            "severity": case.severity,
        }

    async def get_case_details(self, case_code: str = "") -> tuple[dict, str]:
        code = str(case_code).strip().upper()
        data = (await cases.resolved_cases_by_code(self.session, [code])).get(code)
        if data is None:
            return {"error": f"{code} is not a resolved case in the Memory Bank"}, f"{code} not found"
        case = data["case"]
        lead = case.lead_resolver
        days = (case.resolved_at - case.created_at).days if case.resolved_at else None
        result = {
            "case_code": code,
            "title": case.title,
            "client": case.client_name,
            "summary": case.summary,
            "how_it_went": case.how_it_went,
            "resolution_steps": case.resolution_steps[:6],
            "pitfalls": [p["warning"] for p in case.pitfalls][:4],
            "duration_days": days,
            "lead": {"name": lead.name, "alumni": not lead.is_active} if lead else None,
            "files": [{"name": a.file_name, "reusable": a.is_reusable} for a in case.artifacts],
            "people": [u.name + ("" if u.is_active else " [ALUMNI]") for u in data["people"]],
        }
        self.evidence.details[code] = result
        self.evidence.vault.setdefault(
            code, {"case_code": code, "title": case.title, "client": case.client_name, "similarity": None}
        )
        lead_note = f" · led by {lead.name}{' (alumni)' if lead and not lead.is_active else ''}" if lead else ""
        return result, f"{code} · {case.title[:60]}{f' · {days} days' if days is not None else ''}{lead_note}"

    async def find_people(self, case_codes: list[str] | None = None) -> tuple[dict, str]:
        codes = [str(c).strip().upper() for c in (case_codes or [])][:5]
        data = await cases.resolved_cases_by_code(self.session, codes)
        people: dict[str, dict] = {}
        for code, item in data.items():
            lead_id = item["case"].lead_resolver_user_id
            for user in item["people"]:
                person = people.setdefault(str(user.id), {**_person(user), "cases": [], "led": []})
                person["cases"].append(code)
                if user.id == lead_id:
                    person["led"].append(code)
        for person in people.values():
            if not person["active"]:
                person["handoff"] = [
                    {"user_id": other["user_id"], "name": other["name"]}
                    for other in people.values()
                    if other["active"] and set(other["cases"]) & set(person["cases"])
                ][:3]
        ranked = sorted(people.values(), key=lambda p: (not p["active"], -len(p["led"]), -len(p["cases"])))
        self.evidence.people.update({p["user_id"]: p for p in ranked})
        detail = (
            ", ".join(
                f"{p['name']} ({'active' if p['active'] else 'alumni'}"
                + (f" → ask {p['handoff'][0]['name']}" if not p["active"] and p.get("handoff") else "")
                + ")"
                for p in ranked[:4]
            )
            or "Nobody found"
        )
        return {"people": ranked}, detail

    async def estimate_effort(self, case_codes: list[str] | None = None) -> tuple[dict, str]:
        codes = [str(c).strip().upper() for c in (case_codes or [])][:5]
        data = await cases.resolved_cases_by_code(self.session, codes)
        durations = {
            code: (item["case"].resolved_at - item["case"].created_at).days
            for code, item in data.items()
            if item["case"].resolved_at
        }
        due: date | None = self.case.due_date
        days_left = (due - datetime.now(UTC).date()).days if due else None
        median = round(statistics.median(durations.values())) if durations else None
        effort = {
            "durations": durations,
            "median_days": median,
            "range_days": [min(durations.values()), max(durations.values())] if durations else None,
            "days_until_deadline": days_left,
            "fits_deadline": None if median is None or days_left is None else days_left >= median,
        }
        self.evidence.effort = effort
        if median is None:
            return effort, "No durations recorded for those cases"
        span = effort["range_days"]
        deadline = f" · {days_left} days to deadline" if days_left is not None else " · no deadline set"
        return effort, f"Similar cases took {span[0]}–{span[1]} days (median {median}){deadline}"


async def investigate(
    session: AsyncSession, case, incoming: IncomingRequest, precedents: list[PrecedentContext], on_trace: OnTrace
) -> Evidence:
    """The tool-calling loop (≤ MAX_TOOL_CALLS), then code fills any section the agent skipped."""
    evidence = Evidence()
    tools = Toolbox(session, case, incoming, evidence, on_trace)
    top_codes = [p.case_code for p in precedents]

    if settings.llm_provider == "fake":
        script = [
            ("search_knowledge_vault", {"query": incoming.title}),
            ("search_knowledge_vault", {"query": incoming.brief[:300]}),
            ("check_active_duplicates", {}),
            ("get_case_details", {"case_code": top_codes[0]}),
            ("find_people", {"case_codes": top_codes}),
            ("estimate_effort", {"case_codes": top_codes}),
        ]
        for name, args in script:
            await tools.run(name, args)
        evidence.agent_ran = True
        evidence.notes = "Scripted investigation (fake provider)."
    else:
        messages: list[dict] = [
            {"role": "system", "content": TRIAGE_AGENT_SYSTEM},
            {"role": "user", "content": triage_agent_user(_request_block(incoming, precedents))},
        ]
        try:
            for _ in range(MAX_TOOL_CALLS + 2):
                reply = await llm_client.complete_with_tools(messages, TOOLS)
                calls = reply.get("tool_calls") or []
                if not calls:
                    evidence.notes = (reply.get("content") or "")[:2000]
                    break
                messages.append({"role": "assistant", "content": reply.get("content") or "", "tool_calls": calls})
                for call in calls:
                    name = call.get("function", {}).get("name", "")
                    try:
                        args = json.loads(call.get("function", {}).get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    if evidence.tool_calls >= MAX_TOOL_CALLS:
                        result: dict = {"error": "Tool budget used up. Stop calling tools and summarise."}
                    else:
                        result = await tools.run(name, args if isinstance(args, dict) else {})
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call.get("id", ""),
                            "name": name,
                            "content": json.dumps(result, default=str)[:6000],
                        }
                    )
            evidence.agent_ran = True
        except llm_client.LLMError as error:
            await on_trace(
                {
                    "tool": "fallback",
                    "label": "Agent unavailable, continuing with the standard checks",
                    "detail": str(error)[:160],
                    "auto": True,
                }
            )

    # Every report has duplicates, people and effort, whatever the agent chose to look at.
    if "search_knowledge_vault" not in evidence.called:
        await tools.run("search_knowledge_vault", {"query": incoming.query_text()[:500]}, auto=True)
    if "check_active_duplicates" not in evidence.called:
        await tools.run("check_active_duplicates", {}, auto=True)
    if not evidence.people:
        await tools.run("find_people", {"case_codes": top_codes}, auto=True)
    if evidence.effort is None:
        await tools.run("estimate_effort", {"case_codes": top_codes}, auto=True)
    return evidence


def _request_block(incoming: IncomingRequest, precedents: list[PrecedentContext]) -> str:
    lines = [
        f"Case: {incoming.case_code} · {incoming.title}",
        f"Customer: {incoming.client_name or 'not recorded'} · Fund: {incoming.fund_name or 'not recorded'}",
        f"Source: {incoming.source_type or 'not recorded'}",
        *(f"{k}: {v}" for k, v in incoming.context_tags.items()),
        f"Request:\n{incoming.brief}",
        *(f'<file name="{name}">\n{text[:2500]}\n</file>' for name, text in incoming.file_texts.items()),
        "Top precedents by retrieval (scores computed by code): "
        + ", ".join(f"{p.case_code} {p.similarity}%" for p in precedents),
    ]
    return "\n".join(lines)


def _evidence_block(evidence: Evidence, precedents: list[PrecedentContext]) -> str:
    def dump(value) -> str:
        return json.dumps(value, default=str, ensure_ascii=False)

    ranked = [{"case_code": p.case_code, "similarity": p.similarity, "title": p.title} for p in precedents]
    return "\n".join(
        [
            f"<precedents>{dump(ranked)}</precedents>",
            f"<vault>{dump(list(evidence.vault.values()))}</vault>",
            f"<cases>{dump(list(evidence.details.values()))}</cases>",
            f"<people>{dump(list(evidence.people.values()))}</people>",
            f"<duplicates>{dump(list(evidence.duplicates.values()))}</duplicates>",
            f"<effort>{dump(evidence.effort)}</effort>",
            f"<agent_notes>{evidence.notes}</agent_notes>",
        ]
    )


async def write_report(
    incoming: IncomingRequest, precedents: list[PrecedentContext], evidence: Evidence, severity: str
) -> tuple[dict, list[str]]:
    try:
        draft = await llm_client.complete_json(
            TRIAGE_REPORT_SYSTEM,
            triage_report_user(_request_block(incoming, precedents), _evidence_block(evidence, precedents)),
            TriageReportDraft,
            fake=lambda: _fake_report(evidence, precedents, severity),
            model=settings.agent_model or None,
        )
        fallback = False
    except llm_client.LLMError:
        draft, fallback = _fake_report(evidence, precedents, severity), True
    report, warnings = guard_triage(draft, evidence, precedents)
    report["fallback"] = fallback
    return report, warnings


def guard_triage(
    draft: TriageReportDraft, evidence: Evidence, precedents: list[PrecedentContext]
) -> tuple[dict, list[str]]:
    """Only people, cases and numbers that tools returned survive; effort and the deadline floor come from code."""
    warnings: list[str] = []
    known = evidence.known_codes() | {p.case_code for p in precedents}

    team, seen = [], set()
    for pick in draft.team:
        person = evidence.people.get(pick.user_id)
        if person is None:
            warnings.append(f"Dropped a team suggestion for unknown user {pick.user_id[:12]}.")
            continue
        if pick.user_id in seen:
            continue
        seen.add(pick.user_id)
        team.append({**person, "reason": pick.reason})
    if not team:
        team = [{**p, "reason": f"Worked on {', '.join(p['cases'])}."} for p in evidence.people.values()][:3]

    duplicates = []
    for item in draft.duplicates:
        found = evidence.duplicates.get(item.case_code.upper())
        if found is None:
            warnings.append(f"Dropped duplicate {item.case_code}: no tool returned it.")
            continue
        duplicates.append({**found, "reason": item.reason})

    missing = []
    for item in draft.missing_info:
        source = item.source_case_code.upper() if item.source_case_code else None
        if source and source not in known:
            warnings.append(f"Removed source {source} from a question: not in the evidence.")
            source = None
        missing.append({"question": item.question, "why": item.why, "source_case_code": source})

    for code in set(CASE_CODE.findall(draft.summary)) - known:
        warnings.append(f"The summary mentions {code}, which no tool returned.")

    level, reasons = draft.risk_level, list(draft.risk_reasons)
    effort = evidence.effort or {}
    if effort.get("fits_deadline") is False:
        reasons.insert(
            0,
            f"Deadline in {effort['days_until_deadline']} days; similar cases took a median of "
            f"{effort['median_days']} days.",
        )
        if RISK_ORDER.index(level) < RISK_ORDER.index("HIGH"):
            level = "HIGH"
    return {
        "summary": draft.summary,
        "risk": {"level": level, "reasons": reasons[:5]},
        "effort": evidence.effort,
        "missing_info": missing,
        "team": team,
        "duplicates": duplicates,
        "investigation": {
            "tool_calls": evidence.tool_calls,
            "queries": evidence.queries,
            "cases_opened": list(evidence.details),
            "agent": evidence.agent_ran,
            "model": llm_client.agent_label(),
        },
        "guard_warnings": warnings,
    }, warnings


def _fake_report(evidence: Evidence, precedents: list[PrecedentContext], severity: str) -> TriageReportDraft:
    top = precedents[0] if precedents else None
    summary = (
        f"Closest precedent is [{top.case_code}] {top.title} ({top.similarity}% match). Start from its resolution "
        "steps and reusable files, then handle what is new in this request."
        if top
        else "No close precedent in the Memory Bank; treat this as net-new work."
    )
    people = list(evidence.people.values())
    return TriageReportDraft(
        summary=summary,
        risk_level="HIGH" if severity in ("CRITICAL", "HIGH") else "MEDIUM",
        risk_reasons=[f"Severity {severity}."],
        missing_info=[
            MissingInfoDraft(
                question=f"Can you confirm: {warning[:200]}", why=warning[:300], source_case_code=top.case_code
            )
            for warning in (top.pitfalls[:2] if top else [])
        ],
        team=[TeamPickDraft(user_id=p["user_id"], reason=f"Worked on {', '.join(p['cases'])}.") for p in people[:3]],
        duplicates=[
            DuplicateDraft(case_code=d["case_code"], reason="Same client or a similar open problem.")
            for d in evidence.duplicates.values()
        ][:3],
    )


def new_trace_event(event: dict) -> dict:
    return {"id": str(uuid.uuid4())[:8], **event, "at": datetime.now(UTC).isoformat()}
