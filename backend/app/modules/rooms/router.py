import uuid

from fastapi import APIRouter, HTTPException, Response, status

from app.core import realtime
from app.core.db import SessionDep
from app.core.security import create_room_ticket
from app.modules.auth.deps import CurrentUser
from app.modules.cases import service as cases
from app.modules.rooms import service
from app.modules.rooms.schemas import (
    AccessDecisionIn,
    AccessRequestOut,
    MessageIn,
    MessageOut,
    PersonOut,
    PinIn,
    ReadIn,
    RoomSummaryOut,
    RoomViewOut,
    TicketIn,
    TicketOut,
)

router = APIRouter(prefix="/rooms", tags=["rooms"])

ERRORS = {
    service.ForbiddenError: status.HTTP_403_FORBIDDEN,
    service.NotFoundError: status.HTTP_404_NOT_FOUND,
    service.ConflictError: status.HTTP_409_CONFLICT,
    service.InvalidError: status.HTTP_422_UNPROCESSABLE_CONTENT,
}


def _http(error: Exception) -> HTTPException:
    return HTTPException(ERRORS[type(error)], str(error))


@router.get("")
async def list_rooms(user: CurrentUser, session: SessionDep) -> list[RoomSummaryOut]:
    return [RoomSummaryOut.model_validate(r) for r in await service.list_rooms(session, user)]


@router.get("/people")
async def list_people(user: CurrentUser, session: SessionDep) -> list[PersonOut]:
    return [PersonOut.model_validate(p) for p in await service.list_people(session)]


@router.post("/tickets")
async def room_ticket(data: TicketIn, user: CurrentUser, session: SessionDep) -> TicketOut:
    """A one-minute pass into one realtime room, for its members only (case channels and department channels)."""
    try:
        if data.room.startswith("case-"):
            await cases.require_member(session, uuid.UUID(data.room.removeprefix("case-")), user)
        else:
            await service._department(session, data.room)
            await service.require_member(session, user, data.room)
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown room") from None
    except (cases.ForbiddenError, service.ForbiddenError) as error:
        raise HTTPException(status.HTTP_403_FORBIDDEN, str(error)) from None
    except service.NotFoundError as error:
        raise _http(error) from None
    return TicketOut(ticket=create_room_ticket(user.id, data.room))


@router.get("/{department_id}")
async def room_view(department_id: str, user: CurrentUser, session: SessionDep) -> RoomViewOut:
    try:
        return RoomViewOut.model_validate(await service.room_view(session, user, department_id), from_attributes=True)
    except service.NotFoundError as error:
        raise _http(error) from None


@router.get("/{department_id}/messages")
async def messages_after(
    department_id: str, user: CurrentUser, session: SessionDep, after_seq: int = 0
) -> list[MessageOut]:
    """Polling endpoint: messages newer than the client's last seen seq."""
    try:
        messages = await service.messages_after(session, department_id, after_seq, user)
    except (service.NotFoundError, service.ForbiddenError) as error:
        raise _http(error) from None
    return [MessageOut.model_validate(m) for m in messages]


@router.post("/{department_id}/messages")
async def post_message(department_id: str, data: MessageIn, user: CurrentUser, session: SessionDep) -> MessageOut:
    try:
        message = await service.post_message(session, user, department_id, data.id, data.content, data.is_milestone)
    except (service.NotFoundError, service.ConflictError, service.ForbiddenError) as error:
        raise _http(error) from None
    out = MessageOut.model_validate(message)
    await realtime.publish(department_id, {"type": "message.created", "message": out.model_dump(mode="json")})
    return out


@router.put("/{department_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_member(department_id: str, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.add_member(session, department_id, user_id, actor=user)
    except (service.NotFoundError, service.InvalidError, service.ForbiddenError) as error:
        raise _http(error) from None
    await realtime.room_changed(department_id, "members")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{department_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(department_id: str, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.remove_member(session, department_id, user_id, actor=user)
    except (service.NotFoundError, service.ConflictError, service.ForbiddenError) as error:
        raise _http(error) from None
    await realtime.room_changed(department_id, "members")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{department_id}/pinned-case", status_code=status.HTTP_204_NO_CONTENT)
async def set_pinned_case(department_id: str, data: PinIn, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.set_pinned_case(session, department_id, data.case_id)
    except service.NotFoundError as error:
        raise _http(error) from None
    await realtime.room_changed(department_id, "pinned_case")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{department_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(department_id: str, data: ReadIn, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.mark_read(session, user, department_id, data.seq)
    except (service.NotFoundError, service.ForbiddenError) as error:
        raise _http(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{department_id}/access-requests", status_code=status.HTTP_201_CREATED)
async def request_access(department_id: str, user: CurrentUser, session: SessionDep) -> AccessRequestOut:
    """A non-member asks to join the channel. Idempotent: asking again returns the pending request."""
    try:
        request = await service.request_access(session, user, department_id)
        out = AccessRequestOut.model_validate(
            {"id": request.id, "user": user, "status": request.status, "created_at": request.created_at}
        )
    except (service.NotFoundError, service.ConflictError) as error:
        raise _http(error) from None
    await realtime.room_changed(department_id, "members")
    return out


@router.put("/{department_id}/access-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
async def decide_access(
    department_id: str, request_id: uuid.UUID, data: AccessDecisionIn, user: CurrentUser, session: SessionDep
) -> Response:
    """A member approves (the requester joins) or dismisses a request. Explicit state: safe to retry."""
    try:
        await service.decide_access(session, user, department_id, request_id, data.approve)
    except (service.NotFoundError, service.ForbiddenError) as error:
        raise _http(error) from None
    await realtime.room_changed(department_id, "members")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
