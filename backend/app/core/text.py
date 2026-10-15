import re

# A case mentioned in chat: #CASE-2026-047. Shared by the war rooms, case threads and the seed.
CASE_TAG = re.compile(r"#(CASE-\d{4}-\d{3})\b")


def slugify(text: str, max_length: int = 60) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:max_length].rstrip("-") or "case"
