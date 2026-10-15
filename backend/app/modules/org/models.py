import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Department(Base):
    __tablename__ = "departments"

    id: Mapped[str] = mapped_column(String(50), primary_key=True)  # e.g. "LEGAL_COMPLIANCE"
    code: Mapped[str] = mapped_column(String(20), unique=True)  # e.g. "LEGAL"
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, server_default=text("''"))
    accent_color: Mapped[str] = mapped_column(String(20), server_default=text("'#0F2547'"))
    agent_system_hint: Mapped[str] = mapped_column(Text, server_default=text("''"))
    # Always a member of the department's war room. use_alter: users.primary_department_id points back here.
    lead_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="SET NULL", use_alter=True)
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
