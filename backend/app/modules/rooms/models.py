import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.modules.auth.models import User
from app.modules.cases.models import ACCESS_STATUSES, CaseArtifact, CaseRecord

MEMBER_ROLES = ("LEAD", "MEMBER")


class Room(Base):
    """A department's war room. One per department, keyed by it."""

    __tablename__ = "rooms"

    department_id: Mapped[str] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), primary_key=True)
    pinned_case_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("case_records.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    pinned_case: Mapped[CaseRecord | None] = relationship(lazy="raise")


class RoomMember(Base):
    __tablename__ = "room_members"
    __table_args__ = (CheckConstraint(f"role IN {MEMBER_ROLES}", name="role"),)

    department_id: Mapped[str] = mapped_column(ForeignKey("rooms.department_id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(lazy="raise")


class RoomMessage(Base):
    __tablename__ = "room_messages"

    # Client-generated, so a retried send is a no-op instead of a duplicate.
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    # Global insertion order: the polling cursor (`?after_seq=`) and the read marker.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    department_id: Mapped[str] = mapped_column(ForeignKey("rooms.department_id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    content: Mapped[str] = mapped_column(Text)
    # Case codes mentioned as #CASE-YYYY-NNN, validated by code on write.
    tagged_case_codes: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    attached_artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("case_artifacts.id", ondelete="SET NULL"))
    is_milestone: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    author: Mapped[User | None] = relationship(lazy="raise")
    attached_artifact: Mapped[CaseArtifact | None] = relationship(lazy="raise")


class RoomRead(Base):
    """How far each user has read in each room; unread = messages by others with a higher seq."""

    __tablename__ = "room_reads"

    department_id: Mapped[str] = mapped_column(ForeignKey("rooms.department_id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    last_read_seq: Mapped[int] = mapped_column(BigInteger)


class RoomAccessRequest(Base):
    """A non-member asking to join a department channel; any member approves (adds them) or dismisses it."""

    __tablename__ = "room_access_requests"
    __table_args__ = (
        CheckConstraint(f"status IN {ACCESS_STATUSES}", name="status"),
        Index(
            "uq_room_access_requests_pending",
            "department_id",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'PENDING'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    department_id: Mapped[str] = mapped_column(ForeignKey("rooms.department_id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(12), server_default=text("'PENDING'"))
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(foreign_keys=[user_id], lazy="raise")
