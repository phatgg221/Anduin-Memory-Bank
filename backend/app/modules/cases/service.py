import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.text import slugify
from app.modules.auth.models import User
from app.modules.cases.models import CaseRecord, ChannelMessage, KnowledgeChunk
from app.modules.org.models import Department

PAGE = 100
CODE = re.compile(r"^CASE-(\d{4})-(\d{3})$")


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class InvalidError(Exception):
    pass


def in_department(department_id: str | ColumnElement[str]) -> ColumnElement[bool]:
    """A case belongs to its owning department and to every department it involves."""
    return or_(
        CaseRecord.department_id == department_id,
        CaseRecord.secondary_department_ids.contains(func.jsonb_build_array(department_id)),
    )


async def precedents_for(session: AsyncSession, case: CaseRecord) -> list[dict]:
    """The case's stored top matches, enriched with each precedent's title and lead (one query)."""
    matches = case.comparison_results or []
    codes = [m["caseCode"] for m in matches]
    query = select(CaseRecord).where(CaseRecord.case_code.in_(codes)).options(selectinload(CaseRecord.lead_resolver))
    past = {c.case_code: c for c in await session.scalars(query)} if codes else {}
    precedents = []
    for match in matches:
        precedent = past.get(match["caseCode"])
        lead = precedent.lead_resolver if precedent else None
        precedents.append(
            {
                "case_code": match["caseCode"],
                "title": precedent.title if precedent else match["caseCode"],
                "similarity_score": match["similarityScore"],
                "how_past_case_went": match["howPastCaseWent"],
                "lead_name": lead.name if lead else None,
                "lead_is_alumni": bool(lead and not lead.is_active),
            }
        )
    return precedents


async def thread_summaries(session: AsyncSession, department_id: str) -> list[dict]:
    """Open case threads a department is involved in, newest activity first (two queries)."""
    cases = list(
        await session.scalars(select(CaseRecord).where(CaseRecord.status == "OPEN", in_department(department_id)))
    )
    stats = {}
    if cases:
        rows = await session.execute(
            select(ChannelMessage.case_id, func.count(), func.max(ChannelMessage.created_at))
            .where(ChannelMessage.case_id.in_([c.id for c in cases]))
            .group_by(ChannelMessage.case_id)
        )
        stats = {case_id: (count, last) for case_id, count, last in rows}
    summaries = [
        {
            "id": c.id,
            "case_code": c.case_code,
            "title": c.title,
            "status": c.status,
            "client_name": c.client_name,
            "severity": c.severity,
            "due_date": c.due_date,
            "department_id": c.department_id,
            "secondary_department_ids": c.secondary_department_ids,
            "message_count": stats.get(c.id, (0, None))[0],
            "last_message_at": stats.get(c.id, (0, None))[1],
        }
        for c in cases
    ]
    return sorted(summaries, key=lambda s: s["last_message_at"] or datetime.min.replace(tzinfo=UTC), reverse=True)


def _messages_query(case_id: uuid.UUID):
    return (
        select(ChannelMessage)
        .where(ChannelMessage.case_id == case_id)
        .options(selectinload(ChannelMessage.author), selectinload(ChannelMessage.attached_artifact))
    )


async def _case(session: AsyncSession, case_id: uuid.UUID) -> CaseRecord:
    options = [
        selectinload(CaseRecord.created_by),
        selectinload(CaseRecord.lead_resolver),
        selectinload(CaseRecord.artifacts),
    ]
    case = await session.get(CaseRecord, case_id, options=options, populate_existing=True)
    if case is None:
        raise NotFoundError("Unknown case")
    return case


async def thread_view(session: AsyncSession, case_id: uuid.UUID) -> dict:
    case = await _case(session, case_id)
    latest = list(await session.scalars(_messages_query(case_id).order_by(ChannelMessage.seq.desc()).limit(PAGE)))
    messages = list(reversed(latest))
    participants = {m.author.id: m.author for m in messages if m.author}
    return {
        **{key: getattr(case, key) for key in ("id", "case_code", "title", "status", "department_id")},
        "client_name": case.client_name,
        "severity": case.severity,
        "due_date": case.due_date,
        "lead": case.lead_resolver,
        "artifacts": case.artifacts,
        "secondary_department_ids": case.secondary_department_ids,
        "initial_request_brief": case.initial_request_brief,
        "context_tags": case.context_tags,
        "created_by": case.created_by,
        "created_at": case.created_at,
        "summary": case.summary,
        "resolved_at": case.resolved_at,
        "precedents": await precedents_for(session, case),
        "participants": list(participants.values()),
        "messages": messages,
    }


async def thread_messages_after(session: AsyncSession, case_id: uuid.UUID, after_seq: int) -> list[ChannelMessage]:
    await _case(session, case_id)
    query = _messages_query(case_id).where(ChannelMessage.seq > after_seq).order_by(ChannelMessage.seq).limit(PAGE)
    return list(await session.scalars(query))


async def post_thread_message(
    session: AsyncSession, user: User, case_id: uuid.UUID, message_id: uuid.UUID, content: str, is_milestone: bool
) -> tuple[ChannelMessage, CaseRecord]:
    """Idempotent on the client-generated id. Resolved cases are read-only memory."""
    case = await _case(session, case_id)
    existing = await session.get(ChannelMessage, message_id)
    if existing is not None:
        if existing.case_id != case_id or existing.user_id != user.id:
            raise ConflictError("Message id already used")
    else:
        if case.status != "OPEN":
            raise ConflictError("This case is resolved; its thread is read-only")
        session.add(
            ChannelMessage(
                id=message_id, case_id=case_id, user_id=user.id, content=content, is_resolution_milestone=is_milestone
            )
        )
        await session.commit()
    message = await session.scalar(_messages_query(case_id).where(ChannelMessage.id == message_id))
    return message, case


async def _next_case_code(session: AsyncSession, year: int) -> str:
    codes = await session.scalars(select(CaseRecord.case_code).where(CaseRecord.case_code.like(f"CASE-{year}-%")))
    numbers = [int(m.group(2)) for code in codes if (m := CODE.match(code))]
    return f"CASE-{year}-{max(numbers, default=0) + 1:03d}"


async def create_case(session: AsyncSession, user: User, data) -> CaseRecord:
    """Opens a new case thread. Idempotent on the client-generated id; the server assigns the case code."""
    existing = await session.get(CaseRecord, data.id)
    if existing is not None:
        if existing.created_by_user_id != user.id:
            raise ConflictError("Case id already used")
        return existing

    secondary = await _valid_departments(session, data.department_id, data.secondary_department_ids)
    lead_id = await _valid_lead(session, data.lead_user_id) or user.id

    for _ in range(3):  # two people creating a case at the same moment can race for the same code
        code = await _next_case_code(session, datetime.now(UTC).year)
        case = CaseRecord(
            id=data.id,
            case_code=code,
            channel_slug=f"case-{slugify(data.title, 50)}-{code[-3:]}",
            title=data.title,
            client_name=data.client_name,
            severity=data.severity,
            due_date=data.due_date,
            lead_resolver_user_id=lead_id,
            context_tags=data.context_tags,
            department_id=data.department_id,
            secondary_department_ids=secondary,
            status="OPEN",
            created_by_user_id=user.id,
            initial_request_brief=data.initial_request_brief,
        )
        session.add(case)
        try:
            await session.commit()
            return case
        except IntegrityError:
            await session.rollback()
            if await session.get(CaseRecord, data.id) is not None:
                return await session.get_one(CaseRecord, data.id)
    raise ConflictError("Couldn't allocate a case code; try again")


async def _valid_departments(session: AsyncSession, owner: str, secondary: list[str]) -> list[str]:
    involved = [owner, *secondary]
    known = set(await session.scalars(select(Department.id).where(Department.id.in_(involved))))
    if set(involved) - known:
        raise InvalidError("Unknown department")
    return [d for d in dict.fromkeys(secondary) if d != owner]


async def _valid_lead(session: AsyncSession, lead_id: uuid.UUID | None) -> uuid.UUID | None:
    if lead_id is None:
        return None
    lead = await session.get(User, lead_id)
    if lead is None or not lead.is_active:
        raise InvalidError("The owner must be an active colleague")
    return lead.id


async def update_case(session: AsyncSession, case_id: uuid.UUID, data) -> tuple[CaseRecord, list[str]]:
    """Patches an OPEN case's details. Returns the case and every department that was or is involved."""
    case = await _case(session, case_id)
    if case.status != "OPEN":
        raise ConflictError("This case is committed to memory; its details are read-only")
    before = [case.department_id, *case.secondary_department_ids]
    fields = data.model_fields_set
    for key in ("client_name", "title", "initial_request_brief", "severity", "context_tags"):
        if key in fields and getattr(data, key) is not None:
            setattr(case, key, getattr(data, key))
    if "due_date" in fields:
        case.due_date = data.due_date  # null clears the deadline
    if "lead_user_id" in fields and data.lead_user_id is not None:
        case.lead_resolver_user_id = await _valid_lead(session, data.lead_user_id)
    if "secondary_department_ids" in fields and data.secondary_department_ids is not None:
        case.secondary_department_ids = await _valid_departments(
            session, case.department_id, data.secondary_department_ids
        )
    await session.commit()
    return case, list(dict.fromkeys([*before, *case.secondary_department_ids]))


# --- memory (used by the triage worker; this module owns the tables it writes) ---------------------------------


async def load_for_memory(session: AsyncSession, case_id: uuid.UUID) -> tuple[CaseRecord, list[ChannelMessage]]:
    """The case with its artifacts, and every thread message with author and attachment, in order."""
    # populate_existing: apply the eager load even if this case is already in the session's identity map.
    case = await session.get(CaseRecord, case_id, options=[selectinload(CaseRecord.artifacts)], populate_existing=True)
    if case is None:
        raise NotFoundError("Unknown case")
    messages = list(await session.scalars(_messages_query(case_id).order_by(ChannelMessage.seq)))
    return case, messages


async def commit_memory(session: AsyncSession, case_id: uuid.UUID, record: dict, resolver_id: uuid.UUID) -> CaseRecord:
    """OPEN → RESOLVED with the reviewed memory record. The thread becomes read-only."""
    case = await session.get(CaseRecord, case_id, with_for_update=True)
    if case is None:
        raise NotFoundError("Unknown case")
    if case.status != "OPEN":
        raise ConflictError("This case is already resolved")
    now = datetime.now(UTC)
    case.summary = record["summary"]
    case.how_it_went = record["how_it_went"]
    case.resolution_steps = record["resolution_steps"]
    case.pitfalls = record["pitfalls"]
    case.context_tags = record["context_tags"] or case.context_tags
    case.lead_resolver_user_id = case.lead_resolver_user_id or resolver_id
    case.status = "RESOLVED"
    case.resolved_at = now
    case.duration_days = (now - case.created_at).days
    await session.commit()
    return case


async def replace_chunks(session: AsyncSession, case: CaseRecord, chunks: list[dict]) -> int:
    """Idempotent re-index: drop the case's chunks, insert the new ones."""
    await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.case_id == case.id))
    session.add_all(KnowledgeChunk(case_id=case.id, department_id=case.department_id, **chunk) for chunk in chunks)
    await session.commit()
    return len(chunks)


async def nearest_chunks(
    session: AsyncSession, vector: list[float], department_id: str | None, limit: int
) -> list[tuple[KnowledgeChunk, CaseRecord, float]]:
    """Cosine-nearest chunks (HNSW index) with their case, in one query. Returns (chunk, case, distance)."""
    distance = KnowledgeChunk.embedding.cosine_distance(vector).label("distance")
    query = (
        select(KnowledgeChunk, CaseRecord, distance)
        .join(CaseRecord, CaseRecord.id == KnowledgeChunk.case_id)
        .options(selectinload(CaseRecord.lead_resolver))
        .order_by(distance)
        .limit(limit)
    )
    if department_id:
        query = query.where(in_department(department_id))
    return [(chunk, case, float(dist)) for chunk, case, dist in await session.execute(query)]
