"""Numbered thread transcript: the citation surface. `Chat #L<n>` means the line prefixed `L<n>`."""

import uuid
from dataclasses import dataclass
from zoneinfo import ZoneInfo

from app.modules.intelligence.schemas import ThreadContext, TranscriptMessage

ICT = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass
class Transcript:
    text: str
    # line number → message, for every body line of every message
    lines: dict[int, TranscriptMessage]


def build_transcript(context: ThreadContext) -> Transcript:
    out = [f"# Case {context.case_code} · {context.title}", "# Times in ICT (UTC+7)", ""]
    lines: dict[int, TranscriptMessage] = {}
    for message in context.messages:
        status = "" if message.author_active else " [ALUMNI]"
        star = " ★" if message.is_milestone else ""
        stamp = message.created_at.astimezone(ICT).strftime("%Y-%m-%d %H:%M")
        out.append(f"[{stamp}] {message.author_name}{status}{star}")
        for body_line in message.content.splitlines() or [""]:
            out.append(body_line)
            lines[len(out)] = message
        if message.attachment:
            out.append(f"[attached] {message.attachment}")
        out.append("")
    # Every line carries its number, so the model can cite "Chat #L<n>" without counting.
    numbered = "\n".join(f"L{number:<4}| {line}" for number, line in enumerate(out, start=1))
    return Transcript(text=numbered, lines=lines)


def message_by_id(context: ThreadContext, message_id: uuid.UUID) -> TranscriptMessage | None:
    return next((m for m in context.messages if m.id == message_id), None)
