import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

JOB_KINDS = ("SUMMARIZE", "INDEX")
JOB_STATUSES = ("QUEUED", "PROCESSING", "COMPLETED", "FAILED")


class CaseJob(Base):
    """LLM / embedding work for one case, never run inside a request.

    SUMMARIZE drafts a Case Memory Record from the case thread (result = draft + guard warnings, for human review);
    INDEX chunks and embeds a committed record into knowledge_chunks.
    """

    __tablename__ = "case_jobs"
    __table_args__ = (
        CheckConstraint(f"kind IN {JOB_KINDS}", name="kind"),
        CheckConstraint(f"status IN {JOB_STATUSES}", name="status"),
        # At most one live job per case and kind: a double-clicked Resolve can't start two summaries.
        Index(
            "uq_case_jobs_one_active",
            "case_id",
            "kind",
            unique=True,
            postgresql_where=text("status IN ('QUEUED', 'PROCESSING')"),
        ),
        Index("ix_case_jobs_queue", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)  # client-generated: retries are idempotent
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), server_default=text("'QUEUED'"))
    step: Mapped[str | None] = mapped_column(String(64))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    requested_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
