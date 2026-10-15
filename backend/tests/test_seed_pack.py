import csv
import json
import re
from datetime import date
from pathlib import Path

import pytest

from app.seed_pack import (
    DEPARTMENT_IDS,
    FILE_TYPES,
    SEED_PACK,
    case_folders,
    load_case,
    load_departments,
    load_rooms,
    load_users,
    parse_timestamp,
)
from app.seed_pdfs import render

USERS = {u["handle"]: u for u in load_users()}
AUTHORS = {handle for handle in USERS if handle != "operator"}
RESOLVED = case_folders("cases")
OPEN = case_folders("channels")
SEVERITIES = {"HIGH", "MEDIUM", "LOW"}
DELTA_STATUSES = {"REUSABLE", "MODIFIED", "NET_NEW"}
CHAT_REFERENCE = re.compile(r"Chat #L(\d+)")


def folder_id(path: Path) -> str:
    return path.name


def test_departments_and_users():
    assert {d["id"] for d in load_departments()} == DEPARTMENT_IDS
    assert len(USERS) == len(load_users())
    for handle, user in USERS.items():
        assert user["primary_department_id"] in DEPARTMENT_IDS
        if handle == "operator":
            assert "email" not in user and "password_hash" not in user
            continue
        assert user["email"] and user["name"] and user["avatar_initials"]
        assert user["is_active"] is (user["departed_at"] is None)


@pytest.mark.parametrize("folder", RESOLVED + OPEN, ids=folder_id)
def test_case_manifest(folder):
    case = load_case(folder)
    data = case.data
    if case.resolved:
        assert folder.name.startswith(f"{data['caseCode']}_")
        for key in ("summary", "howItWent", "resolutionSteps", "pitfalls", "durationDays", "resolvedAt"):
            assert data.get(key), key
        created, resolved = parse_timestamp(data["createdAt"]), parse_timestamp(data["resolvedAt"])
        assert (resolved - created).days == data["durationDays"]
        for pitfall in data["pitfalls"]:
            assert pitfall["author"] in AUTHORS and pitfall["severity"] in SEVERITIES
        assert any(a["isReusable"] for a in data["artifacts"])
        body_lines = {m.line + i for m in case.messages for i in range(len(m.body.splitlines()))}
        for pitfall in data["pitfalls"]:
            if match := CHAT_REFERENCE.fullmatch(pitfall.get("reference") or ""):
                assert int(match.group(1)) in body_lines, pitfall["reference"]
    else:
        assert data["status"] == "OPEN" and folder.name == data["channelSlug"]
        assert "resolvedAt" not in data and data["comparisonResults"]
    assert data["departmentId"] in DEPARTMENT_IDS
    assert data["client"] and data["severity"] in {"CRITICAL", "HIGH", "MEDIUM", "LOW"}
    assert date.fromisoformat(data["dueDate"])
    assert set(data["secondaryDepartmentIds"]) <= DEPARTMENT_IDS
    assert data["createdBy"] in AUTHORS
    assert data.get("leadResolver") in AUTHORS | {None}
    for artifact in data["artifacts"]:
        assert artifact["fileType"] in FILE_TYPES
        assert (folder / artifact["file"]).is_file(), artifact["file"]
        assert artifact["uploadedBy"] in AUTHORS
        if artifact["file"].endswith(".pdf"):
            assert (folder / artifact["source"]).is_file()


@pytest.mark.parametrize("folder", RESOLVED + OPEN, ids=folder_id)
def test_channel_messages(folder):
    case = load_case(folder)
    data = case.data
    messages = case.messages
    low, high = (10, 15) if case.resolved else (3, 6)
    assert low <= len(messages) <= high
    files = {a["file"] for a in data["artifacts"]}
    start = parse_timestamp(data["createdAt"])
    end = parse_timestamp(data["resolvedAt"]) if case.resolved else None
    for previous, message in zip([None, *messages], messages, strict=False):
        assert message.author in AUTHORS, message.author
        assert message.body
        departed = USERS[message.author]["departed_at"]
        if departed:
            assert message.at.date() <= date.fromisoformat(departed), (message.author, message.at)
        assert message.at >= start and (end is None or message.at <= end), message.at
        if previous:
            assert message.at >= previous.at
        if message.attachment:
            assert message.attachment in files, message.attachment
    if case.resolved:
        assert 1 <= sum(m.milestone for m in messages) <= 3
        attached = {m.attachment for m in messages}
        assert {a["file"] for a in data["artifacts"] if a["isReusable"]} <= attached


def test_codes_and_slugs_are_unique():
    cases = [load_case(f).data for f in RESOLVED + OPEN]
    assert len({c["caseCode"] for c in cases}) == len(cases)
    assert len({c["channelSlug"] for c in cases}) == len(cases)


@pytest.mark.parametrize("folder", OPEN, ids=folder_id)
def test_comparison_results_reference_real_precedents(folder):
    artifacts = {load_case(f).data["caseCode"]: {a["file"] for a in load_case(f).data["artifacts"]} for f in RESOLVED}
    for match in load_case(folder).data["comparisonResults"]:
        assert match["caseCode"] in artifacts
        assert 0 <= match["similarityScore"] <= 100
        for item in match["deltaItems"]:
            assert item["status"] in DELTA_STATUSES
            if item["status"] == "NET_NEW":
                assert item["sourceArtifact"] is None
            elif item["sourceArtifact"] is not None:
                assert item["sourceArtifact"] in artifacts[match["caseCode"]], item["sourceArtifact"]


@pytest.mark.parametrize("path", sorted(SEED_PACK.rglob("*.json")), ids=lambda p: str(p.relative_to(SEED_PACK)))
def test_json_files_parse(path):
    json.loads(path.read_text())


@pytest.mark.parametrize("path", sorted(SEED_PACK.rglob("*.csv")), ids=lambda p: str(p.relative_to(SEED_PACK)))
def test_csv_rows_have_consistent_columns(path):
    rows = list(csv.reader(path.open()))
    assert len(rows) > 1 and len({len(row) for row in rows}) == 1


@pytest.mark.parametrize("source", sorted(SEED_PACK.rglob("*.pdf.md")), ids=lambda p: str(p.relative_to(SEED_PACK)))
def test_pdfs_are_rendered_from_current_source(source, tmp_path):
    copy = tmp_path / source.name
    copy.write_text(source.read_text())
    rendered, pages = render(copy)
    assert rendered.read_bytes() == source.with_suffix("").read_bytes(), "run: bun run seed:pdfs"
    assert 1 <= pages <= 4


def test_demo_citation_line_42():
    folder = next(f for f in RESOLVED if f.name.startswith("CASE-2025-014_"))
    lines = (folder / "channel.txt").read_text().splitlines()
    assert lines[40].startswith("[2025-04-14 23:48] @minh.nguyen")
    assert lines[41].startswith("Found the UAT blocker:")


def test_department_leads_are_active_people():
    for department in load_departments():
        lead = department["lead"]
        assert lead == "operator" or (lead in AUTHORS and USERS[lead]["is_active"]), department["id"]


def test_room_conversations():
    cases = {load_case(f).data["caseCode"]: load_case(f).data for f in RESOLVED + OPEN}
    rooms = load_rooms()
    assert {r["departmentId"] for r in rooms} == DEPARTMENT_IDS
    for room in rooms:
        assert cases[room["pinnedCase"]]["status"] == "OPEN", room["departmentId"]
        times = [parse_timestamp(m["at"]) for m in room["messages"]]
        assert times == sorted(times) and 2 <= len(times) <= 8
        for message in room["messages"]:
            assert message["author"] in AUTHORS and USERS[message["author"]]["is_active"], message["author"]
            for code in re.findall(r"#(CASE-\d{4}-\d{3})", message["content"]):
                assert code in cases, code
            if attachment := message["attachment"]:
                files = {a["file"] for a in cases[attachment["caseCode"]]["artifacts"]}
                assert attachment["file"] in files, attachment
