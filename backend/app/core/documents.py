"""Plain-text extraction from uploaded files, for search, chunking and the LLM prompts."""

import io
import logging

from pypdf import PdfReader

from app.utils.markitdown import get_markitdown_tool

logger = logging.getLogger("uvicorn.error")

TEXT_TYPES = {".txt", ".md", ".csv", ".json", ".ts", ".eml"}
MAX_CHARS = 500_000

CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".md": "text/markdown",
    ".txt": "text/plain",
    ".json": "application/json",
    ".eml": "message/rfc822",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


def suffix(file_name: str) -> str:
    return "." + file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""


MARKDOWN_TYPES = {".pdf", ".docx", ".xlsx", ".csv", ".html"}


def extract_text(file_name: str, data: bytes) -> str | None:
    """Best effort, as Markdown: MarkItDown for PDF/Word/Excel/CSV (tables stay tables), then plain fallbacks.

    None when the format isn't readable here (the file is still stored).
    """
    kind = suffix(file_name)
    if kind in MARKDOWN_TYPES:
        try:
            markdown = get_markitdown_tool().convert_bytes(data, file_extension=kind, filename=file_name).markdown
            if markdown.strip():
                return markdown[:MAX_CHARS]
        except Exception as exc:  # noqa: BLE001 — fall back to the simple readers below
            logger.warning("MarkItDown couldn't convert %s: %s", file_name, exc)
    try:
        if kind in TEXT_TYPES:
            return data.decode("utf-8", errors="replace")[:MAX_CHARS]
        if kind == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            return "\n".join(page.extract_text() or "" for page in reader.pages)[:MAX_CHARS] or None
    except Exception as exc:  # noqa: BLE001 — a malformed file shouldn't fail the upload
        logger.warning("Text extraction failed for %s: %s", file_name, exc)
    return None
