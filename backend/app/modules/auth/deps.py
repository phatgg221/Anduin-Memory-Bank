import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.db import SessionDep
from app.core.security import TokenError, decode_token
from app.modules.auth.models import User

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)], session: SessionDep
) -> User:
    if credentials is None:
        raise _unauthorized("Not authenticated")
    try:
        user_id = uuid.UUID(decode_token(credentials.credentials, "access")["sub"])
    except (TokenError, ValueError) as exc:
        raise _unauthorized("Invalid or expired access token") from exc
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("Account unavailable")
    return user


# Protect a route: `async def handler(user: CurrentUser, ...)`.
CurrentUser = Annotated[User, Depends(get_current_user)]
