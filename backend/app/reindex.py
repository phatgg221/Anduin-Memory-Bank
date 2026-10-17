"""Queue an INDEX job for every resolved case (e.g. after changing the embedding model). The API's worker runs them.

Usage: python -m app.reindex [--missing]   (bun run reindex)
  --missing  only cases that have no knowledge chunks yet (what `bun run seed` does)

A full reindex first re-reads stored PDFs (not OCR'd ones) so their text carries page markers, and drops open cases'
intake chunks; the next analysis or review re-embeds them.
"""

import asyncio
import sys
import uuid

from sqlalchemy import delete, exists, select

from app.core import documents, storage
from app.core.db import SessionLocal, engine
from app.modules.cases.models import CaseArtifact, CaseRecord, KnowledgeChunk
from app.modules.triage import service as triage


async def refresh_pdf_text() -> int:
    async with SessionLocal() as session:
        pdfs = list(
            await session.scalars(
                select(CaseArtifact).where(
                    CaseArtifact.file_name.ilike("%.pdf"), CaseArtifact.text_method.is_distinct_from("OCR")
                )
            )
        )
        refreshed = 0
        for artifact in pdfs:
            try:
                data = await asyncio.to_thread(storage.read_object, artifact.minio_object_key)
            except Exception as error:  # noqa: BLE001 — a missing object shouldn't stop the rest
                print(f"  skipped {artifact.file_name}: {error}")
                continue
            if text := await asyncio.to_thread(documents.extract_text, artifact.file_name, data):
                artifact.preview_text, artifact.text_status = text, "READY"
                refreshed += 1
        open_ids = select(CaseRecord.id).where(CaseRecord.status == "OPEN")
        await session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.case_id.in_(open_ids)))
        await session.commit()
        return refreshed


async def queue_index_jobs(only_missing: bool) -> list[str]:
    async with SessionLocal() as session:
        query = select(CaseRecord).where(CaseRecord.status == "RESOLVED").order_by(CaseRecord.case_code)
        if only_missing:
            query = query.where(~exists().where(KnowledgeChunk.case_id == CaseRecord.id))
        cases = list(await session.scalars(query))
        for case in cases:
            await triage.enqueue(session, uuid.uuid4(), case.id, "INDEX", None)
        return [case.case_code for case in cases]


async def main() -> None:
    only_missing = "--missing" in sys.argv
    if not only_missing:
        print(f"Re-read {await refresh_pdf_text()} PDF(s) with page numbers")
    codes = await queue_index_jobs(only_missing)
    await engine.dispose()
    print(f"Queued INDEX jobs for {len(codes)} resolved case(s): {', '.join(codes) or 'none'}")
    print("The API's background worker embeds them; watch progress with: bun run logs backend")


if __name__ == "__main__":
    asyncio.run(main())
