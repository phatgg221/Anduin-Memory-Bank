import uuid

from fastapi import APIRouter, HTTPException, Response, status

from app.core.db import SessionDep
from app.modules.auth.deps import CurrentUser
from app.modules.rooms import service
from app.modules.rooms.schemas import MessageIn, MessageOut, PersonOut, PinIn, ReadIn, RoomSummaryOut, RoomViewOut

router = APIRouter(prefix="/rooms", tags=["rooms"])

ERRORS = {
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
        messages = await service.messages_after(session, department_id, after_seq)
    except service.NotFoundError as error:
        raise _http(error) from None
    return [MessageOut.model_validate(m) for m in messages]


@router.post("/{department_id}/messages")
async def post_message(department_id: str, data: MessageIn, user: CurrentUser, session: SessionDep) -> MessageOut:
    try:
        message = await service.post_message(session, user, department_id, data.id, data.content, data.is_milestone)
    except (service.NotFoundError, service.ConflictError) as error:
        raise _http(error) from None
    return MessageOut.model_validate(message)


@router.put("/{department_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_member(department_id: str, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.add_member(session, department_id, user_id)
    except (service.NotFoundError, service.InvalidError) as error:
        raise _http(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{department_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(department_id: str, user_id: uuid.UUID, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.remove_member(session, department_id, user_id)
    except (service.NotFoundError, service.ConflictError) as error:
        raise _http(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{department_id}/pinned-case", status_code=status.HTTP_204_NO_CONTENT)
async def set_pinned_case(department_id: str, data: PinIn, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.set_pinned_case(session, department_id, data.case_id)
    except service.NotFoundError as error:
        raise _http(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{department_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def mark_read(department_id: str, data: ReadIn, user: CurrentUser, session: SessionDep) -> Response:
    try:
        await service.mark_read(session, user, department_id, data.seq)
    except service.NotFoundError as error:
        raise _http(error) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
