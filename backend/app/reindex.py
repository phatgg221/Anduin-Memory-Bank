"""Queue an INDEX job for every resolved case (e.g. after changing the embedding model). The API's worker runs them.

Usage: python -m app.reindex [--missing]   (bun run reindex)
  --missing  only cases that have no knowledge chunks yet (what `bun run seed` does)
"""

import asyncio
import sys
import uuid

from sqlalchemy import exists, select

from app.core.db import SessionLocal, engine
from app.modules.cases.models import CaseRecord, KnowledgeChunk
from app.modules.triage import service as triage


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
    codes = await queue_index_jobs(only_missing="--missing" in sys.argv)
    await engine.dispose()
    print(f"Queued INDEX jobs for {len(codes)} resolved case(s): {', '.join(codes) or 'none'}")
    print("The API's background worker embeds them; watch progress with: bun run logs backend")


if __name__ == "__main__":
    asyncio.run(main())
