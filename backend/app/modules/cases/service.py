import asyncio
import io
import re
import uuid
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, delete, func, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core import documents
from app.core.config import settings
from app.core.storage import internal
from app.core.text import slugify
from app.modules.auth.models import User
from app.modules.cases.models import (
    CaseArtifact,
    CaseMember,
    CaseRecord,
    ChannelMessage,
    CopilotMessage,
    KnowledgeChunk,
)
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


async def precedent_details(session: AsyncSession, case_ids: list) -> dict:
    """Precedent cases with lead and files (uploaders included), batch-loaded: two or three queries for any count."""
    if not case_ids:
        return {}
    query = (
        select(CaseRecord)
        .where(CaseRecord.id.in_(case_ids))
        .options(
            selectinload(CaseRecord.lead_resolver),
            selectinload(CaseRecord.artifacts).selectinload(CaseArtifact.uploaded_by),
        )
        .execution_options(populate_existing=True)
    )
    return {
        c.id: {"case": c, "artifacts": sorted(c.artifacts, key=lambda a: (not a.is_reusable, a.file_name))}
        for c in await session.scalars(query)
    }


async def precedents_for(session: AsyncSession, case: CaseRecord) -> list[dict]:
    """The case's stored top matches (comparison_results), enriched with each precedent's record, lead and files."""
    matches = case.comparison_results or []
    codes = [m["caseCode"] for m in matches]
    ids = list(await session.scalars(select(CaseRecord.id).where(CaseRecord.case_code.in_(codes)))) if codes else []
    details = {d["case"].case_code: d for d in (await precedent_details(session, ids)).values()}
    precedents = []
    for match in matches:
        detail = details.get(match["caseCode"])
        past = detail["case"] if detail else None
        lead = past.lead_resolver if past else None
        precedents.append(
            {
                "case_id": past.id if past else None,
                "case_code": match["caseCode"],
                "title": past.title if past else match["caseCode"],
                "client_name": past.client_name if past else None,
                "department_id": past.department_id if past else None,
                "secondary_department_ids": past.secondary_department_ids if past else [],
                "similarity_score": match["similarityScore"],
                "score_breakdown": match.get("scoreBreakdown"),
                "how_past_case_went": match["howPastCaseWent"],
                "pitfall_warnings": match.get("pitfallWarnings", []),
                "summary": past.summary if past else None,
                "how_it_went": past.how_it_went if past else None,
                "duration_days": past.duration_days if past else None,
                "resolved_at": past.resolved_at if past else None,
                "lead": lead,
                "lead_name": lead.name if lead else None,
                "lead_is_alumni": bool(lead and not lead.is_active),
                "delta_items": [
                    {
                        "category": item["category"],
                        "past_approach": item["pastApproach"],
                        "current_requirement": item["currentRequirement"],
                        "status": item["status"],
                        "action_recommendation": item["actionRecommendation"],
                        "source_artifact": item.get("sourceArtifact"),
                        "source_artifact_id": item.get("sourceArtifactId"),
                    }
                    for item in match.get("deltaItems", [])
                ],
                "artifacts": detail["artifacts"] if detail else [],
            }
        )
    return precedents


async def thread_summaries(session: AsyncSession, department_id: str | None) -> list[dict]:
    """Open case threads (a department's, or all), newest activity first (two queries)."""
    query = select(CaseRecord).where(CaseRecord.status == "OPEN")
    if department_id:
        query = query.where(in_department(department_id))
    cases = list(await session.scalars(query))
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
            "fund_name": c.fund_name,
            "source_type": c.source_type,
            "severity": c.severity,
            "due_date": c.due_date,
            "department_id": c.department_id,
            "secondary_department_ids": c.secondary_department_ids,
            "top_match_code": (c.comparison_results or [{}])[0].get("caseCode"),
            "top_match_score": (c.comparison_results or [{}])[0].get("similarityScore"),
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


def _join(case_id: uuid.UUID, user_id: uuid.UUID, role: str = "MEMBER"):
    return insert(CaseMember).values(case_id=case_id, user_id=user_id, role=role).on_conflict_do_nothing()


# Owner as LEAD; creator and everyone who posted as MEMBER. Safe to re-run (backfill, seed).
SYNC_MEMBERS = text(
    """
    INSERT INTO case_members (case_id, user_id, role, joined_at)
    SELECT id, lead_resolver_user_id, 'LEAD', created_at FROM case_records WHERE lead_resolver_user_id IS NOT NULL
    UNION ALL
    SELECT id, created_by_user_id, 'MEMBER', created_at FROM case_records WHERE created_by_user_id IS NOT NULL
    UNION ALL
    SELECT case_id, user_id, 'MEMBER', min(created_at) FROM channel_messages WHERE user_id IS NOT NULL
    GROUP BY case_id, user_id
    ON CONFLICT DO NOTHING
    """
)


async def sync_members(session: AsyncSession) -> None:
    await session.execute(SYNC_MEMBERS)


async def case_members(session: AsyncSession, case_id: uuid.UUID) -> list[CaseMember]:
    query = (
        select(CaseMember)
        .where(CaseMember.case_id == case_id)
        .options(selectinload(CaseMember.user))
        .order_by(CaseMember.role, CaseMember.joined_at)
    )
    return list(await session.scalars(query))


async def add_member(session: AsyncSession, case_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Idempotent. Alumni can't be added; they're cited, not invited."""
    case = await _case(session, case_id)
    if case.status != "OPEN":
        raise ConflictError("This case is committed to memory; its members are read-only")
    member = await session.get(User, user_id)
    if member is None:
        raise NotFoundError("Unknown colleague")
    if not member.is_active:
        raise InvalidError("Alumni can't be added to a case")
    await session.execute(_join(case_id, user_id))
    await session.commit()


async def remove_member(session: AsyncSession, case_id: uuid.UUID, user_id: uuid.UUID) -> None:
    """Idempotent. The owner stays; change the owner in the case details first."""
    case = await _case(session, case_id)
    if case.status != "OPEN":
        raise ConflictError("This case is committed to memory; its members are read-only")
    if case.lead_resolver_user_id == user_id:
        raise ConflictError("The case owner can't be removed")
    await session.execute(delete(CaseMember).where(CaseMember.case_id == case_id, CaseMember.user_id == user_id))
    await session.commit()


async def thread_view(session: AsyncSession, case_id: uuid.UUID) -> dict:
    case = await _case(session, case_id)
    latest = list(await session.scalars(_messages_query(case_id).order_by(ChannelMessage.seq.desc()).limit(PAGE)))
    messages = list(reversed(latest))
    participants = {m.author.id: m.author for m in messages if m.author}
    return {
        **{key: getattr(case, key) for key in ("id", "case_code", "channel_slug", "title", "status", "department_id")},
        "client_name": case.client_name,
        "fund_name": case.fund_name,
        "source_type": case.source_type,
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
        "triage_report": case.triage_report,
        "participants": list(participants.values()),
        "members": await case_members(session, case_id),
        "messages": messages,
    }


async def thread_messages_after(session: AsyncSession, case_id: uuid.UUID, after_seq: int) -> list[ChannelMessage]:
    await _case(session, case_id)
    query = _messages_query(case_id).where(ChannelMessage.seq > after_seq).order_by(ChannelMessage.seq).limit(PAGE)
    return list(await session.scalars(query))


async def post_thread_message(
    session: AsyncSession,
    user: User,
    case_id: uuid.UUID,
    message_id: uuid.UUID,
    content: str,
    is_milestone: bool,
    attached_artifact_id: uuid.UUID | None = None,
    mentioned_user_ids: list[uuid.UUID] | None = None,
) -> tuple[ChannelMessage, CaseRecord, bool]:
    """Idempotent on the client-generated id. Resolved cases are read-only memory.

    Mentioned colleagues join the case; alumni and unknown ids are dropped. Returns whether anyone joined.
    """
    case = await _case(session, case_id)
    existing = await session.get(ChannelMessage, message_id)
    joined = False
    if existing is not None:
        if existing.case_id != case_id or existing.user_id != user.id:
            raise ConflictError("Message id already used")
    else:
        if case.status != "OPEN":
            raise ConflictError("This case is resolved; its thread is read-only")
        if attached_artifact_id and await session.get(CaseArtifact, attached_artifact_id) is None:
            raise NotFoundError("Unknown file")
        wanted = list(dict.fromkeys(mentioned_user_ids or []))
        mentioned = (
            list(await session.scalars(select(User.id).where(User.id.in_(wanted), User.is_active))) if wanted else []
        )
        before = set(await session.scalars(select(CaseMember.user_id).where(CaseMember.case_id == case_id)))
        session.add(
            ChannelMessage(
                id=message_id,
                case_id=case_id,
                user_id=user.id,
                content=content,
                is_resolution_milestone=is_milestone,
                attached_artifact_id=attached_artifact_id,
                mentioned_user_ids=[str(m) for m in mentioned],
            )
        )
        await session.flush()
        for member_id in [user.id, *mentioned]:
            await session.execute(_join(case_id, member_id))
        await session.commit()
        joined = bool({user.id, *mentioned} - before)
    message = await session.scalar(_messages_query(case_id).where(ChannelMessage.id == message_id))
    return message, case, joined


async def post_agent_message(session: AsyncSession, case_id: uuid.UUID, message_id: uuid.UUID, content: str):
    """The copilot's reply in the case channel. Idempotent: the id is the job's, so a retried job posts once."""
    if await session.get(ChannelMessage, message_id) is None:
        session.add(ChannelMessage(id=message_id, case_id=case_id, user_id=None, content=content, is_agent=True))
        await session.commit()
    return await session.scalar(_messages_query(case_id).where(ChannelMessage.id == message_id))


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
    member_ids = list(dict.fromkeys(m for m in data.member_ids if m not in (lead_id, user.id)))
    if member_ids:
        active = set(await session.scalars(select(User.id).where(User.id.in_(member_ids), User.is_active)))
        if len(active) != len(member_ids):
            raise InvalidError("Case members must be active colleagues")

    for _ in range(3):  # two people creating a case at the same moment can race for the same code
        code = await _next_case_code(session, datetime.now(UTC).year)
        case = CaseRecord(
            id=data.id,
            case_code=code,
            channel_slug=f"case-{slugify(data.title, 50)}-{code[-3:]}",
            title=data.title,
            client_name=data.client_name,
            fund_name=data.fund_name or None,
            source_type=data.source_type,
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
            await session.flush()
            await session.execute(_join(case.id, lead_id, "LEAD"))
            if lead_id != user.id:
                await session.execute(_join(case.id, user.id))
            for member_id in member_ids:
                await session.execute(_join(case.id, member_id))
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
    for key in (
        "client_name",
        "fund_name",
        "source_type",
        "title",
        "initial_request_brief",
        "severity",
        "context_tags",
    ):
        if key in fields and getattr(data, key) is not None:
            setattr(case, key, getattr(data, key))
    if "due_date" in fields:
        case.due_date = data.due_date  # null clears the deadline
    if "lead_user_id" in fields and data.lead_user_id is not None:
        case.lead_resolver_user_id = await _valid_lead(session, data.lead_user_id)
        await session.execute(
            update(CaseMember).where(CaseMember.case_id == case.id, CaseMember.role == "LEAD").values(role="MEMBER")
        )
        await session.execute(
            insert(CaseMember)
            .values(case_id=case.id, user_id=case.lead_resolver_user_id, role="LEAD")
            .on_conflict_do_update(index_elements=["case_id", "user_id"], set_={"role": "LEAD"})
        )
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
    session: AsyncSession, vector: list[float], department_id: str | None, limit: int, *, resolved_only: bool = False
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
    if resolved_only:
        query = query.where(CaseRecord.status == "RESOLVED")
    return [(chunk, case, float(dist)) for chunk, case, dist in await session.execute(query)]


# --- files ----------------------------------------------------------------------------------------------------------

MAX_UPLOAD_BYTES = 15 * 1024 * 1024
FILE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


async def upload_file(
    session: AsyncSession, user: User, case_id: uuid.UUID, file_name: str, data: bytes, file_type: str
) -> CaseArtifact:
    """Stores a file on an open case (MinIO + case_artifacts). Re-uploading the same name replaces it."""
    case = await _case(session, case_id)
    if case.status != "OPEN":
        raise ConflictError("This case is committed to memory; its files are read-only")
    name = FILE_NAME.sub("_", file_name).strip("._")[:200]
    if not name or documents.suffix(name) not in documents.CONTENT_TYPES:
        raise InvalidError("Upload a PDF, CSV, Markdown, text, JSON, email, DOCX or XLSX file")
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise InvalidError("Files must be between 1 byte and 15 MB")
    content_type = documents.CONTENT_TYPES[documents.suffix(name)]
    key = f"cases/{case.channel_slug}/artifacts/{name}"
    await asyncio.to_thread(
        internal.put_object, settings.minio_bucket, key, io.BytesIO(data), len(data), content_type=content_type
    )
    artifact = await session.scalar(
        select(CaseArtifact).where(CaseArtifact.case_id == case_id, CaseArtifact.file_name == name)
    )
    if artifact is None:
        artifact = CaseArtifact(case_id=case_id, file_name=name)
        session.add(artifact)
    artifact.file_type = file_type
    artifact.content_type = content_type
    artifact.size_bytes = len(data)
    artifact.is_reusable = False
    artifact.description = f"Uploaded by {user.name}"
    artifact.minio_object_key = key
    artifact.preview_text = await asyncio.to_thread(documents.extract_text, name, data)
    artifact.uploaded_by_user_id = user.id
    await session.commit()
    return artifact


async def set_comparison_results(session: AsyncSession, case_id: uuid.UUID, results: list[dict]) -> None:
    case = await session.get_one(CaseRecord, case_id)
    case.comparison_results = results
    await session.commit()


async def case_files_text(session: AsyncSession, case_id: uuid.UUID) -> dict[str, str]:
    files = await session.scalars(select(CaseArtifact).where(CaseArtifact.case_id == case_id))
    return {f.file_name: f.preview_text for f in files if f.preview_text}


# --- copilot ----------------------------------------------------------------------------------------------------


async def copilot_messages(session: AsyncSession, case_id: uuid.UUID) -> list[CopilotMessage]:
    return list(
        await session.scalars(
            select(CopilotMessage).where(CopilotMessage.case_id == case_id).order_by(CopilotMessage.seq)
        )
    )


async def add_copilot_message(
    session: AsyncSession,
    case_id: uuid.UUID,
    role: str,
    content: str,
    *,
    message_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    cited_case_ids: list[str] | None = None,
    cited_artifact_ids: list[str] | None = None,
) -> CopilotMessage:
    message = CopilotMessage(
        id=message_id or uuid.uuid4(),
        case_id=case_id,
        user_id=user_id,
        role=role,
        content=content,
        cited_case_ids=cited_case_ids or [],
        cited_artifact_ids=cited_artifact_ids or [],
    )
    session.add(message)
    await session.commit()
    return message


# --- triage agent (read-only lookups; triage persists the results) ----------------------------------------------


async def set_triage_report(session: AsyncSession, case_id: uuid.UUID, report: dict) -> None:
    case = await session.get_one(CaseRecord, case_id)
    case.triage_report = report
    await session.commit()


async def resolved_cases_by_code(session: AsyncSession, codes: list[str]) -> dict[str, dict]:
    """Resolved cases with lead, files and everyone who worked on them (members + message authors). Three queries."""
    if not codes:
        return {}
    cases = list(
        await session.scalars(
            select(CaseRecord)
            .where(CaseRecord.case_code.in_(codes), CaseRecord.status == "RESOLVED")
            .options(selectinload(CaseRecord.lead_resolver), selectinload(CaseRecord.artifacts))
        )
    )
    ids = [c.id for c in cases]
    members = await session.scalars(
        select(CaseMember).where(CaseMember.case_id.in_(ids)).options(selectinload(CaseMember.user))
    )
    authors = await session.execute(
        select(ChannelMessage.case_id, User)
        .join(User, User.id == ChannelMessage.user_id)
        .where(ChannelMessage.case_id.in_(ids))
        .distinct()
    )
    people: dict[uuid.UUID, dict[uuid.UUID, User]] = {i: {} for i in ids}
    for member in members:
        people[member.case_id][member.user.id] = member.user
    for case_id, user in authors:
        people[case_id][user.id] = user
    for case in cases:
        if case.lead_resolver:
            people[case.id][case.lead_resolver.id] = case.lead_resolver
    return {c.case_code: {"case": c, "people": list(people[c.id].values())} for c in cases}


async def nearest_open_cases(
    session: AsyncSession, vector: list[float], exclude_case_id: uuid.UUID, limit: int = 5
) -> list[tuple[CaseRecord, float]]:
    """Other OPEN cases closest to the vector (best chunk per case), from their intake chunks in pgvector."""
    distance = KnowledgeChunk.embedding.cosine_distance(vector).label("distance")
    rows = await session.execute(
        select(CaseRecord, distance)
        .join(KnowledgeChunk, KnowledgeChunk.case_id == CaseRecord.id)
        .where(CaseRecord.status == "OPEN", CaseRecord.id != exclude_case_id)
        .options(selectinload(CaseRecord.lead_resolver))
        .order_by(distance)
        .limit(limit * 6)
    )
    best: dict[uuid.UUID, tuple[CaseRecord, float]] = {}
    for case, dist in rows:
        if case.id not in best:
            best[case.id] = (case, 1 - float(dist))
    return list(best.values())[:limit]


async def open_cases_for_client(
    session: AsyncSession, client_name: str | None, exclude_case_id: uuid.UUID
) -> list[CaseRecord]:
    if not client_name:
        return []
    return list(
        await session.scalars(
            select(CaseRecord)
            .where(
                CaseRecord.status == "OPEN",
                CaseRecord.id != exclude_case_id,
                func.lower(CaseRecord.client_name) == client_name.strip().lower(),
            )
            .options(selectinload(CaseRecord.lead_resolver))
        )
    )


async def open_cases_without_chunks(session: AsyncSession, limit: int = 20) -> list[CaseRecord]:
    """Open cases whose intake isn't in the vector index yet (e.g. seeded channels), with their files."""
    return list(
        await session.scalars(
            select(CaseRecord)
            .where(
                CaseRecord.status == "OPEN",
                ~select(KnowledgeChunk.id).where(KnowledgeChunk.case_id == CaseRecord.id).exists(),
            )
            .options(selectinload(CaseRecord.artifacts))
            .limit(limit)
        )
    )


async def artifact_ids_by_name(session: AsyncSession, case_ids: list[uuid.UUID]) -> dict[tuple, uuid.UUID]:
    rows = await session.execute(
        select(CaseArtifact.case_id, CaseArtifact.file_name, CaseArtifact.id).where(CaseArtifact.case_id.in_(case_ids))
    )
    return {(case_id, name): artifact_id for case_id, name, artifact_id in rows}
