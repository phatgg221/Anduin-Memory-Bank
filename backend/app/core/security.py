import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

import jwt
from pwdlib import PasswordHash

from app.core.config import settings

ALGORITHM = "HS256"
TokenType = Literal["access", "refresh"]

_hasher = PasswordHash.recommended()  # Argon2id
# Verified against when the email doesn't exist, so a failed login costs the same either way (no user enumeration
# through response timing).
_DUMMY_HASH = _hasher.hash("dejavu-timing-equaliser")
# Stored for accounts that must never sign in with a password (seeded colleagues). Not a valid Argon2 hash.
UNUSABLE_PASSWORD = "!"


class TokenError(Exception):
    pass


def hash_password(password: str) -> str:
    """CPU-bound (~tens of ms): call via asyncio.to_thread."""
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """CPU-bound (~tens of ms): call via asyncio.to_thread. Pass None for an unknown user."""
    if password_hash is None or password_hash == UNUSABLE_PASSWORD:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    return _hasher.verify(password, password_hash)


def create_token(
    user_id: uuid.UUID, token_type: TokenType, ttl: timedelta, jti: uuid.UUID | None = None
) -> tuple[str, datetime]:
    now = datetime.now(UTC)
    expires_at = now + ttl
    payload = {
        "sub": str(user_id),
        "type": token_type,
        "jti": str(jti or uuid.uuid4()),
        "iat": now,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM), expires_at


def decode_token(token: str, expected_type: TokenType) -> dict[str, Any]:
    try:
        claims = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[ALGORITHM],
            options={"require": ["sub", "type", "jti", "iat", "exp"]},
        )
    except jwt.InvalidTokenError as exc:
        raise TokenError(str(exc)) from exc
    if claims["type"] != expected_type:
        # Stops a refresh token being used as an access token (and vice versa).
        raise TokenError(f"expected a {expected_type} token")
    return claims
