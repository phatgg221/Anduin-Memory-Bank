"""LLM contracts. The model fills these; code validates them and sets every ID afterwards (guard.py)."""

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class PitfallDraft(BaseModel):
    warning: Annotated[str, StringConstraints(strip_whitespace=True, min_length=10, max_length=600)] = Field(
        description="A concrete warning for the next team: what broke or nearly broke, the impact, and how to avoid it."
    )
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    reference: str | None = Field(
        default=None,
        description='Where this comes from: "Chat #L<n>" (a line number in the transcript) or an attachment file name.',
    )


class CaseMemoryDraft(BaseModel):
    """What the summarizer writes from a case thread, for a human to review before it's committed."""

    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=1200)] = Field(
        description="2-3 sentences: the problem and the fix, specific enough to match a future request."
    )
    how_it_went: Annotated[str, StringConstraints(strip_whitespace=True, min_length=20, max_length=3000)] = Field(
        description="4-8 sentences: what happened, impact (delays, people, money), blockers, and how it was resolved."
    )
    resolution_steps: list[Text] = Field(min_length=1, max_length=8, description="Imperative steps that fixed it.")
    pitfalls: list[PitfallDraft] = Field(default_factory=list, max_length=6)
    context_tags: dict[str, str] = Field(
        default_factory=dict,
        description='Up to 6 Title Case labels for retrieval, e.g. {"Jurisdiction": "Cayman Islands"}.',
    )


class GuardedPitfall(BaseModel):
    warning: str
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    reference: str | None
    authorId: str | None  # noqa: N815 — matches the stored JSONB shape (camelCase, like the seed pack)
    messageId: str | None  # noqa: N815


class CaseMemoryRecord(BaseModel):
    """A guarded draft: references checked, author/message IDs set by code from the referenced transcript line."""

    summary: str
    how_it_went: str
    resolution_steps: list[str]
    pitfalls: list[GuardedPitfall]
    context_tags: dict[str, str]


@dataclass
class TranscriptMessage:
    id: uuid.UUID
    author_id: uuid.UUID | None
    author_name: str
    author_title: str | None
    author_active: bool
    content: str
    created_at: datetime
    is_milestone: bool
    attachment: str | None = None


@dataclass
class ThreadContext:
    """Everything the summarizer may read: plain data, assembled by the triage worker."""

    case_code: str
    title: str
    department: str
    initial_request_brief: str
    context_tags: dict[str, str]
    messages: list[TranscriptMessage]
    client_name: str | None = None
    severity: str = "MEDIUM"
    due_date: str | None = None
    artifacts: list[str] = field(default_factory=list)
    room_mentions: list[TranscriptMessage] = field(default_factory=list)
