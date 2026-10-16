"""Plain-text extraction from uploaded files, for search, chunking and the LLM prompts."""

import io
import logging

from pypdf import PdfReader, PdfWriter

from app.utils.markitdown import get_markitdown_tool

logger = logging.getLogger("uvicorn.error")

TEXT_TYPES = {".txt", ".md", ".csv", ".json", ".ts", ".eml"}
IMAGE_TYPES = {".png", ".jpg", ".jpeg"}
SCANNED_CHARS_PER_PAGE = 200  # less text than this per page = a scan (or a photo pasted into a PDF)
OCR_MAX_PAGES = 30
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
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
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


def needs_ocr(file_name: str, data: bytes, text: str | None) -> bool:
    """Photos always; PDFs whose text layer is (nearly) empty: under SCANNED_CHARS_PER_PAGE characters a page."""
    kind = suffix(file_name)
    if kind in IMAGE_TYPES:
        return True
    if kind != ".pdf":
        return False
    try:
        pages = len(PdfReader(io.BytesIO(data)).pages)
    except Exception:  # noqa: BLE001 — unreadable structure: let OCR try
        return True
    return len((text or "").strip()) < SCANNED_CHARS_PER_PAGE * max(pages, 1)


def first_pages(data: bytes, limit: int = OCR_MAX_PAGES) -> tuple[bytes, int]:
    """The first `limit` pages as a new PDF (bounds OCR time and cost), and the document's page count."""
    reader = PdfReader(io.BytesIO(data))
    total = len(reader.pages)
    if total <= limit:
        return data, total
    writer = PdfWriter()
    for page in reader.pages[:limit]:
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue(), total
