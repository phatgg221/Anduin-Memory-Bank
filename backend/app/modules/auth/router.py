from typing import Annotated

from fastapi import APIRouter, Cookie, HTTPException, Response, status
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.db import SessionDep
from app.modules.auth import service
from app.modules.auth.deps import CurrentUser
from app.modules.auth.schemas import AuthOut, LoginIn, RegisterIn, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "dejavu_refresh"
REFRESH_COOKIE_PATH = "/"

RefreshCookie = Annotated[str | None, Cookie(alias=REFRESH_COOKIE)]


def _cookie_options() -> dict:
    return {
        "path": REFRESH_COOKIE_PATH,
        "httponly": True,
        "secure": settings.refresh_cookie_secure,
        "samesite": "lax",
    }


def _issue_response(response: Response, issued: service.IssuedSession) -> AuthOut:
    response.set_cookie(
        REFRESH_COOKIE,
        issued.refresh_token,
        max_age=settings.refresh_token_ttl_days * 24 * 3600,
        **_cookie_options(),
    )
    return AuthOut(
        access_token=issued.access_token,
        expires_in=settings.access_token_ttl_minutes * 60,
        user=UserOut.model_validate(issued.user),
    )


def _rejected(detail: str) -> JSONResponse:
    """401 that also clears the refresh cookie, so the browser stops replaying a dead token."""
    response = JSONResponse({"detail": detail}, status_code=status.HTTP_401_UNAUTHORIZED)
    response.delete_cookie(REFRESH_COOKIE, **_cookie_options())
    return response


@router.post("/register", status_code=status.HTTP_201_CREATED, response_model=AuthOut)
async def register(data: RegisterIn, response: Response, session: SessionDep) -> AuthOut:
    try:
        issued = await service.register(session, data)
    except service.EmailTakenError:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists") from None
    return _issue_response(response, issued)


@router.post("/login", response_model=AuthOut)
async def login(data: LoginIn, response: Response, session: SessionDep) -> AuthOut:
    try:
        issued = await service.login(session, data)
    except service.AuthError:
        # Same message for unknown email and wrong password (no account enumeration).
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password") from None
    return _issue_response(response, issued)


@router.post("/refresh", response_model=AuthOut)
async def refresh(
    response: Response, session: SessionDep, refresh_token: RefreshCookie = None
) -> AuthOut | JSONResponse:
    try:
        issued = await service.refresh(session, refresh_token)
    except service.RefreshRaceError:
        # Not an error for the user: the browser already holds the newer cookie. Clients retry once.
        raise HTTPException(status.HTTP_409_CONFLICT, "refresh_token_rotated") from None
    except service.AuthError:
        return _rejected("Session expired. Please sign in again.")
    return _issue_response(response, issued)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(session: SessionDep, refresh_token: RefreshCookie = None) -> Response:
    await service.logout(session, refresh_token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    response.delete_cookie(REFRESH_COOKIE, **_cookie_options())
    return response


@router.get("/me")
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
