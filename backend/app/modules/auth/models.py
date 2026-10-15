import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.modules.org.models import Department


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Stored lowercased (normalised in schemas.py), so the unique constraint is effectively case-insensitive.
    email: Mapped[str] = mapped_column(String(320), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))  # Argon2id, or UNUSABLE_PASSWORD
    # False = left the company (ALUMNI): can't sign in, but their case history stays attributed to them.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"), index=True)
    primary_department_id: Mapped[str | None] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL"), index=True
    )
    role: Mapped[str] = mapped_column(String(50), server_default=text("'MEMBER'"))
    job_title: Mapped[str | None] = mapped_column(String(120))
    avatar_initials: Mapped[str] = mapped_column(String(4))
    tenure_note: Mapped[str | None] = mapped_column(String(200))
    departed_at: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    primary_department: Mapped[Department | None] = relationship(lazy="raise")


class RefreshToken(Base):
    """One row per issued refresh token, keyed by its JWT `jti`.

    Every refresh rotates the token: the old row is revoked and points at its replacement. All rows created from
    one login share a `family_id` (one session), so logout or detected reuse revokes the whole chain at once.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)  # = JWT jti
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    replaced_by_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
