"""Plain-text extraction from uploaded files, for search, chunking and the LLM prompts."""

import io
import logging
import re

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
PAGE_MARKER = re.compile(r"<!-- page (\d+) -->")


def mark_pages(pages: list[str]) -> str:
    """Pages joined with the same `<!-- page N -->` markers the OCR model writes, so chunks can cite a page."""
    return "\n\n".join(f"<!-- page {number} -->\n{page.strip()}" for number, page in enumerate(pages, start=1))


def split_pages(text: str) -> list[tuple[int, str]]:
    """(page number, text) for text with page markers; [] when it has none."""
    parts = PAGE_MARKER.split(text)
    return [(int(parts[i]), parts[i + 1].strip()) for i in range(1, len(parts) - 1, 2) if parts[i + 1].strip()]


def extract_text(file_name: str, data: bytes) -> str | None:
    """Best effort, as Markdown: MarkItDown for PDF/Word/Excel/CSV (tables stay tables), then plain fallbacks.

    None when the format isn't readable here (the file is still stored).
    """
    kind = suffix(file_name)
    if kind in MARKDOWN_TYPES:
        try:
            markdown = get_markitdown_tool().convert_bytes(data, file_extension=kind, filename=file_name).markdown
            if kind == ".pdf" and markdown.strip():
                markdown = mark_pages(markdown.split("\f"))
            if markdown.strip():
                return markdown[:MAX_CHARS]
        except Exception as exc:  # noqa: BLE001 — fall back to the simple readers below
            logger.warning("MarkItDown couldn't convert %s: %s", file_name, exc)
    try:
        if kind in TEXT_TYPES:
            return data.decode("utf-8", errors="replace")[:MAX_CHARS]
        if kind == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            pages = [page.extract_text() or "" for page in reader.pages]
            return mark_pages(pages)[:MAX_CHARS] if any(p.strip() for p in pages) else None
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
