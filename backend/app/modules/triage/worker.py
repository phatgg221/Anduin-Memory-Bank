import asyncio
import logging

from app.core.config import settings
from app.modules.triage import service

logger = logging.getLogger("uvicorn.error")


async def run_worker() -> None:
    """Claims QUEUED jobs one at a time. SKIP LOCKED keeps several workers or processes from double-claiming."""
    while True:
        try:
            job_id = await service.claim_next()
        except Exception as exc:  # noqa: BLE001 — e.g. the DB restarting; keep the loop alive
            logger.warning("Job claim failed: %s", exc)
            await asyncio.sleep(settings.worker_poll_interval_seconds * 5)
            continue
        if job_id is None:
            await asyncio.sleep(settings.worker_poll_interval_seconds)
            continue
        logger.info("Processing case job %s", job_id)
        await service.process(job_id)  # CancelledError propagates: the job stays PROCESSING and the sweeper requeues it


async def run_sweeper() -> None:
    while True:
        await asyncio.sleep(settings.sweeper_interval_seconds)
        try:
            if recovered := await service.sweep_once():
                logger.warning("Sweeper requeued or failed %s stalled job(s)", recovered)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Sweep failed: %s", exc)
