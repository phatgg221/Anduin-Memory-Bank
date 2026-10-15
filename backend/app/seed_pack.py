import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

SEED_PACK = Path(__file__).resolve().parents[1] / "data" / "seed_pack"
ICT = timezone(timedelta(hours=7))

MESSAGE_HEADER = re.compile(r"^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] @([a-z.]+)( ★)?$")
ATTACHMENT = re.compile(r"^\[attached\] (\S+)$")

DEPARTMENT_IDS = {"CLIENT_OPERATIONS", "LEGAL_COMPLIANCE", "SALES_SOLUTIONS", "CUSTOMER_SUCCESS", "ENGINEERING_DATA"}
FILE_TYPES = {
    "CLIENT_BRIEF",
    "LEGAL_DOC",
    "LEGAL_REDLINE",
    "SOP_PDF",
    "GUIDE_PDF",
    "TEMPLATE_PDF",
    "ARCHITECTURE_PDF",
    "RUNBOOK_MD",
    "POLICY_MD",
    "POSTMORTEM_MD",
    "MATRIX_CSV",
    "RFP_MATRIX_CSV",
    "TEMPLATE_CSV",
    "JSON_SCHEMA",
    "MAPPING_JSON",
    "CODE",
}


@dataclass
class Message:
    author: str
    at: datetime
    body: str
    milestone: bool
    attachment: str | None
    line: int


@dataclass
class SeedCase:
    folder: Path
    data: dict[str, Any]
    messages: list[Message] = field(default_factory=list)

    @property
    def code(self) -> str:
        return self.data["caseCode"]

    @property
    def resolved(self) -> bool:
        return self.data["status"] == "RESOLVED"


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_channel(text: str) -> list[Message]:
    messages: list[Message] = []
    current: dict[str, Any] | None = None
    body: list[str] = []

    def flush() -> None:
        if current is None:
            return
        while body and not body[-1].strip():
            body.pop()
        attachment = None
        if body and (match := ATTACHMENT.match(body[-1])):
            attachment = match.group(1)
            body.pop()
        messages.append(Message(body="\n".join(body).strip(), attachment=attachment, **current))
        body.clear()

    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("#") and current is None:
            continue
        if header := MESSAGE_HEADER.match(line):
            flush()
            stamp, author, star = header.groups()
            current = {
                "author": author,
                "at": datetime.strptime(stamp, "%Y-%m-%d %H:%M").replace(tzinfo=ICT),
                "milestone": bool(star),
                "line": number + 1,
            }
        elif current is not None and (line or body):
            body.append(line)
    flush()
    return messages


def load_case(folder: Path) -> SeedCase:
    case = SeedCase(folder=folder, data=read_json(folder / "case.json"))
    channel = folder / "channel.txt"
    if channel.exists():
        case.messages = parse_channel(channel.read_text(encoding="utf-8"))
    return case


def case_folders(kind: str) -> list[Path]:
    root = SEED_PACK / kind
    return sorted(p for p in root.iterdir() if p.is_dir() and (p / "case.json").exists()) if root.exists() else []


def load_departments() -> list[dict[str, Any]]:
    return read_json(SEED_PACK / "departments.json")


def load_users() -> list[dict[str, Any]]:
    return read_json(SEED_PACK / "users.json")


def load_cases() -> list[SeedCase]:
    return [load_case(folder) for folder in case_folders("cases") + case_folders("channels")]


def parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value)
