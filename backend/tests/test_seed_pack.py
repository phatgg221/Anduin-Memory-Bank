import csv
import json
import re
from datetime import date
from pathlib import Path

import pytest

from app.seed_pdfs import SEED_PACK, render

CASES = sorted(p for p in (SEED_PACK / "cases").iterdir() if p.is_dir())
PEOPLE = {p["handle"]: p for p in json.loads((SEED_PACK / "people.json").read_text())}
SLACK_HEADER = re.compile(r"^\[(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}\] @([a-z.]+)$")


def manifest(case_dir: Path) -> dict:
    return json.loads((case_dir / "case.json").read_text())


@pytest.mark.parametrize("path", sorted(SEED_PACK.rglob("*.json")), ids=lambda p: str(p.relative_to(SEED_PACK)))
def test_json_files_parse(path):
    json.loads(path.read_text())


@pytest.mark.parametrize("path", sorted(SEED_PACK.rglob("*.csv")), ids=lambda p: p.name)
def test_csv_rows_have_consistent_columns(path):
    rows = list(csv.reader(path.open()))
    assert len({len(row) for row in rows}) == 1


@pytest.mark.parametrize("case_dir", CASES, ids=lambda p: p.name)
def test_manifest_matches_folder(case_dir):
    data = manifest(case_dir)
    assert case_dir.name == f"{data['caseId']}_{data['slug']}"
    assert data["author"] in PEOPLE
    assert all(handle in PEOPLE for handle in data["contributors"])
    for artifact in data["artifacts"]:
        assert (case_dir / artifact["file"]).is_file(), artifact["file"]
        if "source" in artifact:
            assert (case_dir / artifact["source"]).is_file(), artifact["source"]
    assert any(a["reusable"] for a in data["artifacts"])


@pytest.mark.parametrize("source", sorted(SEED_PACK.rglob("*.pdf.md")), ids=lambda p: p.name)
def test_pdfs_are_rendered_from_current_source(source, tmp_path):
    copy = tmp_path / source.name
    copy.write_text(source.read_text())
    rendered, pages = render(copy)
    assert rendered.read_bytes() == source.with_suffix("").read_bytes(), "run: bun run seed:pdfs"
    assert 2 <= pages <= 3


@pytest.mark.parametrize("path", sorted(SEED_PACK.rglob("slack_*.txt")), ids=lambda p: p.name)
def test_slack_authors_exist_and_alumni_post_before_leaving(path):
    headers = [m for line in path.read_text().splitlines() if (m := SLACK_HEADER.match(line))]
    assert 12 <= len(headers) <= 15
    for day, handle in (m.groups() for m in headers):
        person = PEOPLE[handle]
        if person["status"] == "ALUMNI":
            assert date.fromisoformat(day) <= date.fromisoformat(person["leftOn"]), (handle, day)


def test_demo_citation_line_42():
    thread = SEED_PACK / "cases/AND-2025-014_sequoia-heritage-cayman-feeder-iv/slack_uat_fatca_deadlock.txt"
    lines = thread.read_text().splitlines()
    assert lines[40] == "[2025-04-14 23:48] @minh.nguyen"
    assert lines[41].startswith("Found the UAT blocker:")


def test_expected_outcomes_reference_real_cases_and_artifacts():
    cases = {manifest(c)["caseId"]: {a["file"] for a in manifest(c)["artifacts"]} for c in CASES}
    for request in json.loads((SEED_PACK / "incoming/expected.json").read_text()):
        assert (SEED_PACK / "incoming" / request["file"]).is_file()
        assert request["retrieval"]["mustRankFirst"] in cases
        for row in request["expectedDelta"]:
            assert row["status"] in {"REUSABLE", "MODIFIED", "NET_NEW"}
            if row["sourceCase"]:
                assert row["artifact"] in cases[row["sourceCase"]], (row["sourceCase"], row["artifact"])
