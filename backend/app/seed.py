"""Load the seed pack (backend/data/seed_pack/) into Postgres and MinIO. Idempotent: safe to re-run.

Usage: python -m app.seed   (bun run seed)
"""

import asyncio
import io
import mimetypes
import os
import re
import uuid
from datetime import date
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import SessionLocal, engine
from app.core.security import UNUSABLE_PASSWORD
from app.core.storage import ensure_bucket, internal
from app.modules.auth.models import User
from app.modules.cases.models import CaseArtifact, CaseRecord, ChannelMessage
from app.modules.org.models import Department
from app.seed_pack import SeedCase, load_cases, load_departments, load_users, parse_timestamp

CHAT_REFERENCE = re.compile(r"Chat #L(\d+)")
USER_FIELDS = ("name", "primary_department_id", "role", "job_title", "avatar_initials", "is_active", "tenure_note")
mimetypes.add_type("text/markdown", ".md")
mimetypes.add_type("text/csv", ".csv")
mimetypes.add_type("text/plain", ".ts")


async def seed_departments(session: AsyncSession) -> None:
    existing = {d.id: d for d in (await session.scalars(select(Department))).all()}
    for row in load_departments():
        department = existing.get(row["id"]) or Department(id=row["id"])
        for key in ("code", "name", "description", "accent_color", "agent_system_hint"):
            setattr(department, key, row[key])
        session.add(department)
    await session.flush()


async def seed_users(session: AsyncSession) -> dict[str, uuid.UUID]:
    rows = load_users()
    emails = [r["email"] for r in rows if "email" in r]
    existing = {u.email: u for u in (await session.scalars(select(User).where(User.email.in_(emails)))).all()}
    handles: dict[str, uuid.UUID] = {}
    for row in rows:
        if row["handle"] == "operator":
            await link_operator(session, row)
            continue
        user = existing.get(row["email"]) or User(email=row["email"], password_hash=UNUSABLE_PASSWORD)
        for key in USER_FIELDS:
            setattr(user, key, row[key])
        user.departed_at = date.fromisoformat(row["departed_at"]) if row["departed_at"] else None
        session.add(user)
        await session.flush()
        handles[row["handle"]] = user.id
    return handles


async def link_operator(session: AsyncSession, row: dict[str, Any]) -> None:
    email = os.environ.get(row["matchEmailEnv"], "").strip().lower()
    if not email:
        print(f"  operator: {row['matchEmailEnv']} not set, skipped")
        return
    user = await session.scalar(select(User).where(User.email == email))
    if user is None:
        print(f"  operator: no registered account for {email}, skipped (register first, then re-seed)")
        return
    user.primary_department_id = row["primary_department_id"]
    user.role = row["role"]
    user.job_title = row["job_title"]
    print(f"  operator: {email} → {row['role']}")


def object_key(case: SeedCase, file_name: str) -> str:
    return f"cases/{case.data['channelSlug']}/artifacts/{file_name}"


def preview_text(case: SeedCase, artifact: dict[str, Any]) -> str | None:
    path = case.folder / (artifact.get("source") or artifact["file"])
    if path.suffix == ".pdf":
        return None
    return path.read_text(encoding="utf-8")


def upload(case: SeedCase, artifact: dict[str, Any]) -> tuple[str, int]:
    path = case.folder / artifact["file"]
    data = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    internal.put_object(
        settings.minio_bucket, object_key(case, path.name), io.BytesIO(data), len(data), content_type=content_type
    )
    return content_type, len(data)


def chat_message_id(reference: str | None, case: SeedCase, message_ids: list[uuid.UUID]) -> uuid.UUID | None:
    match = CHAT_REFERENCE.fullmatch(reference or "")
    if not match:
        return None
    line = int(match.group(1))
    for message, message_id in zip(case.messages, message_ids, strict=True):
        if message.line <= line < message.line + len(message.body.splitlines()):
            return message_id
    return None


async def seed_case(
    session: AsyncSession,
    case: SeedCase,
    handles: dict[str, uuid.UUID],
    artifact_ids: dict[tuple[str, str], uuid.UUID],
    case_ids: dict[str, uuid.UUID],
) -> None:
    data = case.data
    record = await session.scalar(select(CaseRecord).where(CaseRecord.case_code == case.code))
    if record is None:
        record = CaseRecord(case_code=case.code)
        session.add(record)
    record.channel_slug = data["channelSlug"]
    record.title = data["title"]
    record.department_id = data["departmentId"]
    record.secondary_department_ids = data["secondaryDepartmentIds"]
    record.status = data["status"]
    record.created_by_user_id = handles[data["createdBy"]]
    record.lead_resolver_user_id = handles.get(data.get("leadResolver") or "")
    record.initial_request_brief = data["initialRequestBrief"]
    record.context_tags = data["contextTags"]
    record.summary = data.get("summary")
    record.how_it_went = data.get("howItWent")
    record.resolution_steps = data.get("resolutionSteps", [])
    record.duration_days = data.get("durationDays")
    record.created_at = parse_timestamp(data["createdAt"])
    record.resolved_at = parse_timestamp(data["resolvedAt"]) if data.get("resolvedAt") else None
    await session.flush()
    case_ids[case.code] = record.id

    existing = {
        a.file_name: a for a in (await session.scalars(select(CaseArtifact).where(CaseArtifact.case_id == record.id)))
    }
    for row in data["artifacts"]:
        content_type, size = await asyncio.to_thread(upload, case, row)
        artifact = existing.pop(row["file"], None) or CaseArtifact(case_id=record.id, file_name=row["file"])
        artifact.file_type = row["fileType"]
        artifact.content_type = content_type
        artifact.size_bytes = size
        artifact.is_reusable = row["isReusable"]
        artifact.description = row["description"]
        artifact.minio_object_key = object_key(case, row["file"])
        artifact.preview_text = preview_text(case, row)
        artifact.uploaded_by_user_id = handles[row["uploadedBy"]]
        artifact.created_at = record.created_at
        session.add(artifact)
        await session.flush()
        artifact_ids[(case.code, row["file"])] = artifact.id
    for stale in existing.values():
        await session.delete(stale)

    await session.execute(delete(ChannelMessage).where(ChannelMessage.case_id == record.id))
    messages = [
        ChannelMessage(
            id=uuid.uuid4(),
            case_id=record.id,
            user_id=handles[m.author],
            content=m.body,
            attached_artifact_id=artifact_ids[(case.code, m.attachment)] if m.attachment else None,
            is_resolution_milestone=m.milestone,
            created_at=m.at,
        )
        for m in case.messages
    ]
    session.add_all(messages)
    await session.flush()

    message_ids = [m.id for m in messages]
    record.pitfalls = [
        {
            "warning": p["warning"],
            "severity": p["severity"],
            "reference": p.get("reference"),
            "authorId": str(handles[p["author"]]),
            "messageId": str(mid) if (mid := chat_message_id(p.get("reference"), case, message_ids)) else None,
        }
        for p in data.get("pitfalls", [])
    ]
    record.comparison_results = resolve_comparisons(data.get("comparisonResults"), artifact_ids, case_ids)


def resolve_comparisons(
    results: list[dict[str, Any]] | None,
    artifact_ids: dict[tuple[str, str], uuid.UUID],
    case_ids: dict[str, uuid.UUID],
) -> list[dict[str, Any]] | None:
    if results is None:
        return None
    return [
        {
            **match,
            "caseId": str(case_ids[match["caseCode"]]),
            "deltaItems": [
                {
                    **item,
                    "sourceArtifactId": str(artifact_ids[(match["caseCode"], item["sourceArtifact"])])
                    if item["sourceArtifact"]
                    else None,
                }
                for item in match["deltaItems"]
            ],
        }
        for match in results
    ]


async def main() -> None:
    await asyncio.to_thread(ensure_bucket)
    cases = sorted(load_cases(), key=lambda c: (not c.resolved, c.code))
    async with SessionLocal() as session, session.begin():
        await seed_departments(session)
        handles = await seed_users(session)
        artifact_ids: dict[tuple[str, str], uuid.UUID] = {}
        case_ids: dict[str, uuid.UUID] = {}
        for case in cases:
            await seed_case(session, case, handles, artifact_ids, case_ids)
            print(f"  {case.code}  {case.data['status']:8}  {len(case.messages):2} messages  {case.data['title'][:60]}")
    await engine.dispose()
    resolved = sum(c.resolved for c in cases)
    print(f"Seeded {len(handles)} colleagues, {resolved} resolved cases, {len(cases) - resolved} open channels.")
    print("Knowledge chunks are not embedded yet: they land with the intelligence pipeline.")


if __name__ == "__main__":
    asyncio.run(main())
