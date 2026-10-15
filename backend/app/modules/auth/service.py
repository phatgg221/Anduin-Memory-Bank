import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import TokenError, create_token, decode_token, hash_password, verify_password
from app.modules.auth.models import RefreshToken, User
from app.modules.auth.schemas import LoginIn, RegisterIn
from app.modules.org.models import Department

logger = logging.getLogger("uvicorn.error")


class AuthError(Exception):
    """Credentials or token rejected → 401."""


class EmailTakenError(Exception):
    """Registration with an existing email → 409."""


class UnknownDepartmentError(Exception):
    pass


class RefreshRaceError(Exception):
    """A just-rotated refresh token was replayed inside the grace window (e.g. two tabs refreshing at once) → 409.

    The browser already holds the replacement cookie, so the client should simply retry once.
    """


@dataclass
class IssuedSession:
    user: User
    access_token: str
    refresh_token: str
    refresh_token_id: uuid.UUID
    refresh_expires_at: datetime


def initials(name: str) -> str:
    return "".join(word[0] for word in name.split()[:2]).upper()


async def register(session: AsyncSession, data: RegisterIn) -> IssuedSession:
    password_hash = await asyncio.to_thread(hash_password, data.password)
    user = User(email=data.email, name=data.name, password_hash=password_hash, avatar_initials=initials(data.name))
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise EmailTakenError from exc
    issued = _issue(session, user, family_id=uuid.uuid4())
    await session.commit()
    return issued


async def login(session: AsyncSession, data: LoginIn) -> IssuedSession:
    user = await session.scalar(select(User).where(User.email == data.email))
    valid = await asyncio.to_thread(verify_password, data.password, user.password_hash if user else None)
    if user is None or not valid or not user.is_active:
        raise AuthError("Invalid email or password")
    issued = _issue(session, user, family_id=uuid.uuid4())
    await session.commit()
    return issued


async def refresh(session: AsyncSession, raw_token: str | None) -> IssuedSession:
    stored = await _load_refresh_token(session, raw_token, lock=True)
    now = datetime.now(UTC)

    if stored.revoked_at is not None:
        grace = timedelta(seconds=settings.refresh_reuse_grace_seconds)
        if stored.replaced_by_id is not None and now - stored.revoked_at < grace:
            raise RefreshRaceError
        # A revoked token came back: assume it was stolen and end the whole session.
        logger.warning("Refresh token reuse detected (user %s); revoking session %s", stored.user_id, stored.family_id)
        await _revoke_family(session, stored.family_id, now)
        await session.commit()
        raise AuthError("Refresh token reuse detected")

    if stored.expires_at <= now:
        raise AuthError("Refresh token expired")

    user = await session.get(User, stored.user_id)
    if user is None or not user.is_active:
        await _revoke_family(session, stored.family_id, now)
        await session.commit()
        raise AuthError("Account unavailable")

    issued = _issue(session, user, family_id=stored.family_id)
    stored.revoked_at = now
    stored.replaced_by_id = issued.refresh_token_id
    await session.commit()
    return issued


async def logout(session: AsyncSession, raw_token: str | None) -> None:
    """Revoke the session the refresh token belongs to. Idempotent; silently ignores missing or bad tokens."""
    try:
        stored = await _load_refresh_token(session, raw_token, lock=False)
    except AuthError:
        return
    await _revoke_family(session, stored.family_id, datetime.now(UTC))
    await session.commit()


async def set_active_department(session: AsyncSession, user: User, department_id: str | None) -> User:
    """Idempotent: setting the same value twice is a no-op."""
    if department_id is not None and await session.get(Department, department_id) is None:
        raise UnknownDepartmentError
    user.active_department_id = department_id
    await session.commit()
    return user


def _issue(session: AsyncSession, user: User, family_id: uuid.UUID) -> IssuedSession:
    refresh_id = uuid.uuid4()
    refresh_token, refresh_expires_at = create_token(
        user.id, "refresh", timedelta(days=settings.refresh_token_ttl_days), jti=refresh_id
    )
    session.add(RefreshToken(id=refresh_id, user_id=user.id, family_id=family_id, expires_at=refresh_expires_at))
    access_token, _ = create_token(user.id, "access", timedelta(minutes=settings.access_token_ttl_minutes))
    return IssuedSession(
        user=user,
        access_token=access_token,
        refresh_token=refresh_token,
        refresh_token_id=refresh_id,
        refresh_expires_at=refresh_expires_at,
    )


async def _load_refresh_token(session: AsyncSession, raw_token: str | None, *, lock: bool) -> RefreshToken:
    if not raw_token:
        raise AuthError("Missing refresh token")
    try:
        token_id = uuid.UUID(decode_token(raw_token, "refresh")["jti"])
    except (TokenError, ValueError) as exc:
        raise AuthError("Invalid refresh token") from exc
    query = select(RefreshToken).where(RefreshToken.id == token_id)
    # Row lock: two concurrent refreshes of the same token serialise, so only one can rotate it.
    stored = await session.scalar(query.with_for_update() if lock else query)
    if stored is None:
        raise AuthError("Unknown refresh token")
    return stored


async def _revoke_family(session: AsyncSession, family_id: uuid.UUID, now: datetime) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )
