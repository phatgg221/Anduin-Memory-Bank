import re
import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.models import User
from app.modules.cases.models import CaseRecord
from app.modules.org.models import Department
from app.modules.rooms.models import Room, RoomMember, RoomMessage, RoomRead

CASE_TAG = re.compile(r"#(CASE-\d{4}-\d{3})\b")
PAGE = 100


class NotFoundError(Exception):
    pass


class ConflictError(Exception):
    pass


class InvalidError(Exception):
    pass


async def _department(session: AsyncSession, department_id: str) -> Department:
    department = await session.get(Department, department_id)
    if department is None:
        raise NotFoundError("Unknown department")
    return department


async def _ensure_room(session: AsyncSession, department: Department) -> Room:
    """Rooms are created on first use; the department lead is always a member."""
    await session.execute(insert(Room).values(department_id=department.id).on_conflict_do_nothing())
    if department.lead_user_id is not None:
        await session.execute(
            insert(RoomMember)
            .values(department_id=department.id, user_id=department.lead_user_id, role="LEAD")
            .on_conflict_do_update(index_elements=["department_id", "user_id"], set_={"role": "LEAD"})
        )
    return await session.get_one(Room, department.id)


def _messages_query(department_id: str):
    return (
        select(RoomMessage)
        .where(RoomMessage.department_id == department_id)
        .options(selectinload(RoomMessage.author), selectinload(RoomMessage.attached_artifact))
    )


async def list_people(session: AsyncSession) -> list[User]:
    """Everyone who can be added to a room (alumni can't sign in, so they're never added)."""
    return list(await session.scalars(select(User).where(User.is_active).order_by(User.name)))


async def list_rooms(session: AsyncSession, user: User) -> list[dict]:
    departments = list(await session.scalars(select(Department).order_by(Department.name)))
    lead_ids = [d.lead_user_id for d in departments if d.lead_user_id]
    leads = {u.id: u for u in await session.scalars(select(User).where(User.id.in_(lead_ids)))} if lead_ids else {}

    member_counts = dict(
        (await session.execute(select(RoomMember.department_id, func.count()).group_by(RoomMember.department_id))).all()
    )
    mine = set(await session.scalars(select(RoomMember.department_id).where(RoomMember.user_id == user.id)))
    last_at = dict(
        (
            await session.execute(
                select(RoomMessage.department_id, func.max(RoomMessage.created_at)).group_by(RoomMessage.department_id)
            )
        ).all()
    )
    read = select(RoomRead.department_id, RoomRead.last_read_seq).where(RoomRead.user_id == user.id).subquery()
    unread = dict(
        (
            await session.execute(
                select(RoomMessage.department_id, func.count())
                .outerjoin(read, read.c.department_id == RoomMessage.department_id)
                .where(
                    RoomMessage.seq > func.coalesce(read.c.last_read_seq, 0),
                    RoomMessage.user_id.is_distinct_from(user.id),
                )
                .group_by(RoomMessage.department_id)
            )
        ).all()
    )
    return [
        {
            "department_id": d.id,
            "name": d.name,
            "code": d.code,
            "lead": leads.get(d.lead_user_id),
            "member_count": member_counts.get(d.id, 0),
            "unread_count": unread.get(d.id, 0),
            "last_message_at": last_at.get(d.id),
            "is_member": d.id in mine,
        }
        for d in departments
    ]


def _in_department(department_id: str):
    return or_(
        CaseRecord.department_id == department_id,
        CaseRecord.secondary_department_ids.contains(func.jsonb_build_array(department_id)),
    )


async def _pinned_case(session: AsyncSession, case: CaseRecord | None) -> dict | None:
    if case is None:
        return None
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
    return {
        "id": case.id,
        "case_code": case.case_code,
        "title": case.title,
        "status": case.status,
        "initial_request_brief": case.initial_request_brief,
        "precedents": precedents,
    }


async def room_view(session: AsyncSession, user: User, department_id: str) -> dict:
    department = await _department(session, department_id)
    room = await _ensure_room(session, department)
    await session.commit()

    members = list(
        await session.scalars(
            select(RoomMember)
            .where(RoomMember.department_id == department_id)
            .options(selectinload(RoomMember.user))
            .order_by(RoomMember.role, RoomMember.joined_at)
        )
    )
    latest = list(await session.scalars(_messages_query(department_id).order_by(RoomMessage.seq.desc()).limit(PAGE)))
    pinned = await session.get(CaseRecord, room.pinned_case_id) if room.pinned_case_id else None
    case_options = await session.scalars(
        select(CaseRecord)
        .where(CaseRecord.status == "OPEN", _in_department(department_id))
        .order_by(CaseRecord.case_code)
    )
    last_read = await session.scalar(
        select(RoomRead.last_read_seq).where(RoomRead.department_id == department_id, RoomRead.user_id == user.id)
    )
    return {
        "department_id": department.id,
        "name": department.name,
        "code": department.code,
        "lead_user_id": department.lead_user_id,
        "is_member": any(m.user_id == user.id for m in members),
        "members": members,
        "pinned_case": await _pinned_case(session, pinned),
        "case_options": [
            {"id": c.id, "case_code": c.case_code, "title": c.title, "status": c.status} for c in case_options
        ],
        "messages": list(reversed(latest)),
        "last_read_seq": last_read or 0,
    }


async def messages_after(session: AsyncSession, department_id: str, after_seq: int) -> list[RoomMessage]:
    await _department(session, department_id)
    query = _messages_query(department_id).where(RoomMessage.seq > after_seq).order_by(RoomMessage.seq).limit(PAGE)
    return list(await session.scalars(query))


async def _join(session: AsyncSession, department_id: str, user_id: uuid.UUID) -> None:
    await session.execute(
        insert(RoomMember).values(department_id=department_id, user_id=user_id, role="MEMBER").on_conflict_do_nothing()
    )


async def post_message(
    session: AsyncSession, user: User, department_id: str, message_id: uuid.UUID, content: str, is_milestone: bool
) -> RoomMessage:
    """Idempotent on the client-generated id. Posting joins the room (every room is open to everyone)."""
    department = await _department(session, department_id)
    existing = await session.get(RoomMessage, message_id)
    if existing is not None:
        if existing.department_id != department_id or existing.user_id != user.id:
            raise ConflictError("Message id already used")
    else:
        await _ensure_room(session, department)
        tags = list(dict.fromkeys(CASE_TAG.findall(content)))
        known = (
            set(await session.scalars(select(CaseRecord.case_code).where(CaseRecord.case_code.in_(tags))))
            if tags
            else set()
        )
        session.add(
            RoomMessage(
                id=message_id,
                department_id=department_id,
                user_id=user.id,
                content=content,
                tagged_case_codes=[t for t in tags if t in known],
                is_milestone=is_milestone,
            )
        )
        await _join(session, department_id, user.id)
        await session.commit()
    message = await session.scalar(_messages_query(department_id).where(RoomMessage.id == message_id))
    await mark_read(session, user, department_id, message.seq)
    return message


async def add_member(session: AsyncSession, department_id: str, user_id: uuid.UUID) -> None:
    department = await _department(session, department_id)
    member = await session.get(User, user_id)
    if member is None:
        raise NotFoundError("Unknown user")
    if not member.is_active:
        raise InvalidError("Alumni can't join a room")
    await _ensure_room(session, department)
    await _join(session, department_id, user_id)
    await session.commit()


async def remove_member(session: AsyncSession, department_id: str, user_id: uuid.UUID) -> None:
    department = await _department(session, department_id)
    if department.lead_user_id == user_id:
        raise ConflictError("The department lead always stays in the room")
    member = await session.get(RoomMember, (department_id, user_id))
    if member is not None:
        await session.delete(member)
        await session.commit()


async def set_pinned_case(session: AsyncSession, department_id: str, case_id: uuid.UUID | None) -> None:
    department = await _department(session, department_id)
    if case_id is not None and await session.get(CaseRecord, case_id) is None:
        raise NotFoundError("Unknown case")
    room = await _ensure_room(session, department)
    room.pinned_case_id = case_id
    await session.commit()


async def mark_read(session: AsyncSession, user: User, department_id: str, seq: int) -> None:
    """Only ever moves forward, so out-of-order calls are harmless."""
    await _ensure_room(session, await _department(session, department_id))
    stmt = insert(RoomRead).values(department_id=department_id, user_id=user.id, last_read_seq=seq)
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=["department_id", "user_id"],
            set_={"last_read_seq": func.greatest(RoomRead.last_read_seq, stmt.excluded.last_read_seq)},
        )
    )
    await session.commit()
