import uuid
from datetime import date, datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.config import settings
from app.core.db import Base
from app.modules.auth.models import User
from app.modules.org.models import Department

CASE_STATUSES = ("OPEN", "RESOLVED")
CASE_SEVERITIES = ("CRITICAL", "HIGH", "MEDIUM", "LOW")
SOURCE_TYPES = ("CLIENT_EMAIL", "CS_ESCALATION", "LEGAL_REDLINE", "SECURITY_RFP")
COPILOT_ROLES = ("user", "assistant")
CASE_MEMBER_ROLES = ("LEAD", "MEMBER")
CHUNK_TYPES = ("CASE_SUMMARY", "CHANNEL_DISCUSSION", "ARTIFACT_CONTENT", "RESOLUTION_PLAYBOOK")


class CaseRecord(Base):
    """One case for its whole life: an OPEN team channel, then (after Resolve & Commit) a RESOLVED memory record.

    Analysis and summarisation progress lives in `case_jobs`, not in `status`.
    """

    __tablename__ = "case_records"
    __table_args__ = (
        CheckConstraint(f"status IN {CASE_STATUSES}", name="status"),
        CheckConstraint("(status = 'RESOLVED') = (resolved_at IS NOT NULL)", name="resolved_at_matches_status"),
        CheckConstraint(f"severity IN {CASE_SEVERITIES}", name="severity"),
        CheckConstraint(f"source_type IS NULL OR source_type IN {SOURCE_TYPES}", name="source_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    case_code: Mapped[str] = mapped_column(String(32), unique=True)  # "CASE-2025-014"
    channel_slug: Mapped[str] = mapped_column(String(100), unique=True)  # "case-sequoia-cayman-iv"
    title: Mapped[str] = mapped_column(String(255))
    department_id: Mapped[str] = mapped_column(ForeignKey("departments.id", ondelete="RESTRICT"), index=True)
    secondary_department_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    status: Mapped[str] = mapped_column(String(16), server_default=text("'OPEN'"), index=True)
    # Intake: who the case is for, how urgent it is, and by when.
    client_name: Mapped[str | None] = mapped_column(String(200))
    severity: Mapped[str] = mapped_column(String(16), server_default=text("'MEDIUM'"))
    due_date: Mapped[date | None] = mapped_column(Date)
    # The parent project / fund the request belongs to, and how it arrived.
    fund_name: Mapped[str | None] = mapped_column(String(200))
    source_type: Mapped[str | None] = mapped_column(String(32))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    lead_resolver_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), index=True
    )
    initial_request_brief: Mapped[str] = mapped_column(Text)
    context_tags: Mapped[dict[str, str]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    # Precedent banner: top-3 matches with similarity, how they went, and delta items. Written by the ANALYZE job.
    comparison_results: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB)
    # The triage agent's report (summary, risk & effort, duplicates, missing info, team), guarded by code.
    triage_report: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    # Memory record, written on resolve (SUMMARIZE job, or the seed).
    summary: Mapped[str | None] = mapped_column(Text)
    how_it_went: Mapped[str | None] = mapped_column(Text)
    resolution_steps: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    # [{warning, severity, reference, authorId, messageId}]
    pitfalls: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    duration_days: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    department: Mapped[Department] = relationship(lazy="raise")
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id], lazy="raise")
    lead_resolver: Mapped[User | None] = relationship(foreign_keys=[lead_resolver_user_id], lazy="raise")
    channel_messages: Mapped[list["ChannelMessage"]] = relationship(
        back_populates="case", order_by="ChannelMessage.seq", lazy="raise", passive_deletes=True
    )
    artifacts: Mapped[list["CaseArtifact"]] = relationship(
        back_populates="case", order_by="CaseArtifact.file_name", lazy="raise", passive_deletes=True
    )


class CaseArtifact(Base):
    """A file in MinIO at `minio_object_key`, attached to a case."""

    __tablename__ = "case_artifacts"
    __table_args__ = (UniqueConstraint("case_id", "file_name"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), index=True)
    uploaded_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    file_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(50))  # SOP_PDF | LEGAL_REDLINE | RFP_MATRIX_CSV | JSON_SCHEMA | …
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    is_reusable: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    description: Mapped[str] = mapped_column(String(500), server_default=text("''"))
    minio_object_key: Mapped[str] = mapped_column(String(512), unique=True)
    preview_text: Mapped[str | None] = mapped_column(Text)  # extracted text: search, chunking, previews
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[CaseRecord] = relationship(back_populates="artifacts", lazy="raise")
    uploaded_by: Mapped[User | None] = relationship(lazy="raise")


class ChannelMessage(Base):
    """Human-to-human discussion in the case channel."""

    __tablename__ = "channel_messages"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Global insertion order: a stable chronological sort even when timestamps tie.
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    content: Mapped[str] = mapped_column(Text)
    attached_artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("case_artifacts.id", ondelete="SET NULL"))
    is_resolution_milestone: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # Posted by the Dejavu copilot (no human author); its id is the COPILOT job's id.
    is_agent: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    mentioned_user_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[CaseRecord] = relationship(back_populates="channel_messages", lazy="raise")
    author: Mapped[User | None] = relationship(lazy="raise")
    attached_artifact: Mapped[CaseArtifact | None] = relationship(lazy="raise")


class CaseMember(Base):
    """Who is in a case channel: the owner (LEAD), the creator, everyone who posted, and anyone added."""

    __tablename__ = "case_members"
    __table_args__ = (CheckConstraint(f"role IN {CASE_MEMBER_ROLES}", name="role"),)

    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, index=True)
    role: Mapped[str] = mapped_column(String(16))
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(lazy="raise")


class CopilotMessage(Base):
    """User ↔ Dejavu agent chat in a case's right pane."""

    __tablename__ = "copilot_messages"
    __table_args__ = (CheckConstraint(f"role IN {COPILOT_ROLES}", name="role"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    seq: Mapped[int] = mapped_column(BigInteger, Identity(), unique=True)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str] = mapped_column(Text)
    # Set by code from the retrieved context, never by the LLM.
    cited_case_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    cited_artifact_ids: Mapped[list[str]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class KnowledgeChunk(Base):
    """A retrievable slice of a case's memory with its embedding, pointing back at its source for citations."""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        CheckConstraint(f"chunk_type IN {CHUNK_TYPES}", name="chunk_type"),
        Index(
            "ix_knowledge_chunks_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    case_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("case_records.id", ondelete="CASCADE"), index=True)
    # Denormalised from the case so department-scoped retrieval filters without a join.
    department_id: Mapped[str] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"), index=True)
    artifact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("case_artifacts.id", ondelete="SET NULL"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("channel_messages.id", ondelete="SET NULL"))
    chunk_type: Mapped[str] = mapped_column(String(50))
    reference_label: Mapped[str | None] = mapped_column(String(100))  # "Section 4.2", "Chat #L42"
    content: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list[float]] = mapped_column(Vector(settings.embedding_dim))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    case: Mapped[CaseRecord] = relationship(lazy="raise")
