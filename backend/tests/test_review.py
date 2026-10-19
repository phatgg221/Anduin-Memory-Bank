import io
import uuid

from tests.test_case_threads import AURELIAN, SOVEREIGN, signed_in
from tests.test_memory import run_job
from tests.test_workspace import with_indexed_precedent


def _pdf(pages: list[str]) -> bytes:
    from reportlab.pdfgen import canvas

    out = io.BytesIO()
    page = canvas.Canvas(out)
    for words in pages:
        page.drawString(72, 760, words)
        page.showPage()
    page.save()
    return out.getvalue()


def test_pdf_text_keeps_page_numbers_and_chunks_cite_them():
    from app.core import documents
    from app.modules.intelligence.indexer import file_parts

    text = documents.extract_text("letter.pdf", _pdf(["MFN threshold is USD 15 million", "Sovereign immunity"]))
    assert documents.split_pages(text) == [(1, "MFN threshold is USD 15 million"), (2, "Sovereign immunity")]
    parts = file_parts("letter.pdf", text, 10)
    assert [(label, page) for label, _, page in parts] == [("letter.pdf · p.1", 1), ("letter.pdf · p.2", 2)]
    sections = file_parts("runbook.md", "# Intro\nhello\n## DKIM alignment\n" + "x" * 1600, 10)
    assert [label for label, _, _ in sections] == ["runbook.md · § Intro", "runbook.md · § DKIM alignment"]


def test_review_guard_keeps_only_real_sources_and_messages():
    from app.modules.intelligence.reviewer import Evidence, ReviewMessage, guard_review
    from app.modules.intelligence.schemas import ReviewDraft, ReviewFindingDraft

    source = {
        "case_id": "c1",
        "case_code": "CASE-2025-052",
        "this_case": False,
        "label": "redlines.pdf · p.3",
        "page": 3,
    }
    evidence = [Evidence("E1", source, "MFN split into tiers", 0.2)]
    messages = [ReviewMessage(uuid.uuid4(), "Elena", "10:00", "Offer MFN at $15M")]
    draft = ReviewDraft(
        overall="Mostly sound; check the MFN tier.",
        findings=[
            ReviewFindingDraft(
                claim="Offer MFN at $15M",
                verdict="CONFLICTS",
                comment="[CASE-2025-052] split it.",
                evidence=["E1", "E9"],
                messages=[1, 4],
            ),
            ReviewFindingDraft(
                claim="Skip the KYC refresh", verdict="SUPPORTED", comment="Fine per [CASE-2024-001].", evidence=[]
            ),
            ReviewFindingDraft(
                claim="Ask about ERISA status", verdict="MISSING", comment="Past teams asked first.", evidence=[]
            ),
        ],
    )
    findings, warnings = guard_review(draft, evidence, messages)
    assert [(f["verdict"], len(f["citations"])) for f in findings] == [("CONFLICTS", 1), ("NO_PRECEDENT", 0)]
    assert findings[0]["citations"][0]["page"] == 3 and findings[0]["message_ids"] == [str(messages[0].id)]
    assert any("E9" in w for w in warnings) and any("CASE-2024-001" in w for w in warnings)
    assert any("Dropped" in w and "ERISA" in w for w in warnings)


def test_review_a_range_of_the_case_channel(client, sql):
    elena, _ = signed_in(client, sql)
    with_indexed_precedent(client, sql, elena)
    said = [
        "Plan: offer the sovereign LP an MFN tier from $15M, same as the Orchid side letter.",
        "Agreed, and we reuse the MFN tier eligibility matrix from last year.",
        "I'll send the client the redline on Friday.",
    ]
    ids = []
    for content in said:
        body = {"id": str(uuid.uuid4()), "content": content}
        ids.append(client.post(f"/api/cases/{AURELIAN}/thread/messages", json=body, headers=elena).json()["id"])
    ask = {"id": str(uuid.uuid4()), "content": "@Dejavu review these 3 messages"}
    client.post(f"/api/cases/{AURELIAN}/thread/messages", json=ask, headers=elena)

    job_id = str(uuid.uuid4())
    body = {
        "message_id": ask["id"],
        "job_id": job_id,
        "question": ask["content"],
        "reply_in_channel": True,
        "review": {"message_ids": [ids[2], ids[0]], "focus": "Is the MFN tier right?"},
    }
    job = client.post(f"/api/cases/{AURELIAN}/copilot", json=body, headers=elena).json()
    assert job["is_review"] and job["steps"][0] == "Reading the selected messages" and job["in_channel"]

    run_job(client, job_id)
    reply = client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()["messages"][-1]
    review = reply["agent_payload"]
    assert reply["id"] == job_id and reply["is_agent"] and review["kind"] == "review"
    assert review["range"]["count"] == 2 and review["range"]["message_ids"] == [ids[0], ids[2]]
    assert review["focus"] == "Is the MFN tier right?" and review["sources_checked"] > 0
    cited = [c for f in review["findings"] for c in f["citations"]]
    assert cited and all(c["case_code"] and c["label"] for c in cited)
    assert review["findings"][0]["message_ids"] == [ids[0]]
    assert reply["content"].startswith("Review of 2 messages:")


def test_review_range_must_be_in_this_channel(client, sql):
    elena, _ = signed_in(client, sql)
    sql(f"""INSERT INTO channel_messages (id, case_id, content) VALUES
            ('00000000-0000-0000-0000-00000000aa01', '{SOVEREIGN}', 'from another case')""")
    mine = {"id": str(uuid.uuid4()), "content": "Our plan for the signer issue"}
    client.post(f"/api/cases/{AURELIAN}/thread/messages", json=mine, headers=elena)
    body = {
        "message_id": mine["id"],
        "job_id": str(uuid.uuid4()),
        "question": "@Dejavu review",
        "reply_in_channel": True,
        "review": {"message_ids": [mine["id"], "00000000-0000-0000-0000-00000000aa01"]},
    }
    refused = client.post(f"/api/cases/{AURELIAN}/copilot", json=body, headers=elena)
    assert refused.status_code == 422 and "this case" in refused.json()["detail"]
    body["reply_in_channel"] = False
    body["review"]["message_ids"] = [mine["id"]]
    assert client.post(f"/api/cases/{AURELIAN}/copilot", json=body, headers=elena).status_code == 422


def _reuse_ask(client, headers, file_id: str):
    post = {"id": str(uuid.uuid4()), "content": "Reusing the file.", "attached_artifact_id": file_id}
    client.post(f"/api/cases/{AURELIAN}/thread/messages", json=post, headers=headers)
    body = {
        "message_id": post["id"],
        "job_id": str(uuid.uuid4()),
        "question": "Brief on reusing the file",
        "reply_in_channel": True,
        "reuse": {"artifact_id": file_id},
    }
    return client.post(f"/api/cases/{AURELIAN}/copilot", json=body, headers=headers), body["job_id"]


def test_reusing_a_past_file_posts_a_brief(client, sql):
    from tests.test_workspace import SOVEREIGN_FILE

    elena, _ = signed_in(client, sql)
    with_indexed_precedent(client, sql, elena)
    asked, job_id = _reuse_ask(client, elena, SOVEREIGN_FILE)
    assert asked.status_code == 202 and asked.json()["is_reuse"]
    assert asked.json()["steps"][0] == "Opening the file and its case"
    again, _ = _reuse_ask(client, elena, SOVEREIGN_FILE)
    assert again.status_code == 202  # a button, not chat: no per-person cooldown

    run_job(client, job_id)
    reply = next(
        m for m in client.get(f"/api/cases/{AURELIAN}/thread", headers=elena).json()["messages"] if m["id"] == job_id
    )
    brief = reply["agent_payload"]
    assert brief["kind"] == "reuse" and brief["verdict"] in ("READY", "ADAPT", "CAUTION")
    assert (
        brief["file"]["case_code"] == "CASE-2025-052"
        and brief["file"]["file_name"] == "mfn_tier_eligibility_matrix.csv"
    )
    assert brief["sources_checked"] > 0 and brief["what_it_is"] and brief["fit"]
    assert reply["content"].startswith("Reuse brief · mfn_tier_eligibility_matrix.csv from [CASE-2025-052]")


def test_reuse_brief_needs_a_file_from_another_case(client, sql):
    elena, _ = signed_in(client, sql)
    sql(f"""INSERT INTO case_artifacts (id, case_id, file_name, file_type, content_type, size_bytes, minio_object_key)
            VALUES ('00000000-0000-0000-0000-0000000000f7', '{AURELIAN}', 'own.csv', 'MATRIX_CSV', 'text/csv',
                    1, 'k')""")
    own, _ = _reuse_ask(client, elena, "00000000-0000-0000-0000-0000000000f7")
    missing, _ = _reuse_ask(client, elena, str(uuid.uuid4()))
    assert own.status_code == 422 and missing.status_code == 422
