import uuid

from fastapi import APIRouter, HTTPException, status

from app.core import realtime
from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.cases import service
from app.modules.cases.schemas import (
    CaseCreateIn,
    CaseUpdateIn,
    ThreadMessageIn,
    ThreadMessageOut,
    ThreadSummaryOut,
    ThreadViewOut,
)

router = APIRouter(prefix="/cases", tags=["cases"])

ERRORS = {
    service.NotFoundError: status.HTTP_404_NOT_FOUND,
    service.ConflictError: status.HTTP_409_CONFLICT,
    service.InvalidError: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _http(error: Exception) -> HTTPException:
    return HTTPException(ERRORS[type(error)], str(error))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_case(data: CaseCreateIn, user: CurrentUser, session: SessionDep) -> ThreadSummaryOut:
    """Opens a new case thread under its department (and every department it involves)."""
    try:
        case = await service.create_case(session, user, data)
    except (service.ConflictError, service.InvalidError) as error:
        raise _http(error) from None
    for department_id in [case.department_id, *case.secondary_department_ids]:
        await realtime.room_changed(department_id, "threads")
    return ThreadSummaryOut(
        id=case.id,
        case_code=case.case_code,
        title=case.title,
        status=case.status,
        client_name=case.client_name,
        severity=case.severity,
        due_date=case.due_date,
        department_id=case.department_id,
        secondary_department_ids=case.secondary_department_ids,
        message_count=0,
        last_message_at=None,
    )


@router.patch("/{case_id}")
async def update_case(case_id: uuid.UUID, data: CaseUpdateIn, user: CurrentUser, session: SessionDep) -> ThreadViewOut:
    """Edits an open case's details. Returns the full thread view so the client reconciles without a refetch."""
    try:
        _, departments = await service.update_case(session, case_id, data)
        view = ThreadViewOut.model_validate(await service.thread_view(session, case_id), from_attributes=True)
    except (service.NotFoundError, service.ConflictError, service.InvalidError) as error:
        raise _http(error) from None
    await realtime.room_changed(realtime.thread_room(case_id), "threads")
    for department_id in departments:
        await realtime.room_changed(department_id, "threads")
    return view


@router.get("/{case_id}/thread")
async def thread_view(case_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> ThreadViewOut:
    try:
        return ThreadViewOut.model_validate(await service.thread_view(session, case_id), from_attributes=True)
    except service.NotFoundError as error:
        raise _http(error) from None


@router.get("/{case_id}/thread/messages")
async def thread_messages_after(
    case_id: uuid.UUID, user: CurrentUser, session: SessionDep, after_seq: int = 0
) -> list[ThreadMessageOut]:
    """Polling fallback: messages newer than the client's last seen seq."""
    try:
        messages = await service.thread_messages_after(session, case_id, after_seq)
    except service.NotFoundError as error:
        raise _http(error) from None
    return [ThreadMessageOut.model_validate(m) for m in messages]


@router.post("/{case_id}/thread/messages")
async def post_thread_message(
    case_id: uuid.UUID, data: ThreadMessageIn, user: CurrentUser, session: SessionDep
) -> ThreadMessageOut:
    try:
        message, case = await service.post_thread_message(
            session, user, case_id, data.id, data.content, data.is_milestone
        )
    except (service.NotFoundError, service.ConflictError) as error:
        raise _http(error) from None
    out = ThreadMessageOut.model_validate(message)
    await realtime.publish(
        realtime.thread_room(case_id), {"type": "message.created", "message": out.model_dump(mode="json")}
    )
    for department_id in [case.department_id, *case.secondary_department_ids]:
        await realtime.room_changed(department_id, "threads")
    return out
