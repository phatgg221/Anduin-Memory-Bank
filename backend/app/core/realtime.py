"""Publish war-room events to PartyKit (realtime/), one PartyKit room per department.

Best effort by design: the database is the source of truth and clients still poll as a fallback, so a realtime
outage only delays updates. Publish after the write has committed, never before.
"""

import logging
from typing import Any, Literal

import httpx2

from app.core.config import settings

logger = logging.getLogger("uvicorn.error")

async def publish(department_id: str, event: dict[str, Any]) -> None:
    if not settings.realtime_url:
        return
    url = f"{settings.realtime_url}/parties/main/{department_id}"
    try:
        # A client per call: chat-volume traffic, and no client bound to a stale event loop.
        async with httpx2.AsyncClient(timeout=httpx2.Timeout(1.0)) as client:
            response = await client.post(url, json=event, headers={"x-realtime-secret": settings.realtime_secret})
            response.raise_for_status()
    except httpx2.HTTPError as exc:
        logger.warning("Realtime publish to %s failed: %s", department_id, exc)


async def room_changed(department_id: str, reason: Literal["members", "pinned_case"]) -> None:
    await publish(department_id, {"type": "room.changed", "reason": reason})
