"""Render seed-pack legal excerpts (`*.pdf.md`) into PDFs.

Usage: python -m app.seed_pdfs [file.pdf.md ...]   (default: every *.pdf.md under data/seed_pack)
"""

import re
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab import rl_config
from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Table,
    TableStyle,
)

rl_config.invariant = 1

SEED_PACK = Path(__file__).resolve().parents[1] / "data" / "seed_pack"
DISCLAIMER = (
    "Fictional demo material generated for Dejavu. Not an actual document of any named sponsor, fund, or investor."
)
MUTED = colors.HexColor("#525866")
HAIRLINE = colors.HexColor("#CBD2DC")
CELL_BG = colors.HexColor("#ECEFF3")

BODY = ParagraphStyle("body", fontName="Times-Roman", fontSize=10.5, leading=14, spaceAfter=6, alignment=4)
TITLE = ParagraphStyle("title", fontName="Times-Bold", fontSize=15, leading=19, alignment=1, spaceAfter=4)
SUBTITLE = ParagraphStyle("subtitle", fontName="Times-Italic", fontSize=10.5, leading=14, alignment=1, spaceAfter=12)
H2 = ParagraphStyle("h2", fontName="Times-Bold", fontSize=12, leading=15, spaceBefore=10, spaceAfter=5)
H3 = ParagraphStyle("h3", fontName="Times-BoldItalic", fontSize=10.5, leading=14, spaceBefore=6, spaceAfter=3)
CLAUSE = ParagraphStyle("clause", parent=BODY, leftIndent=24)
NOTE = ParagraphStyle("note", parent=BODY, fontName="Times-Italic", leftIndent=14, textColor=MUTED)
CELL = ParagraphStyle("cell", fontName="Times-Roman", fontSize=9, leading=11)
CELL_HEAD = ParagraphStyle("cell_head", parent=CELL, fontName="Times-Bold")

SUBCLAUSE = re.compile(r"^\((?:[a-z]{1,2}|[ivx]{1,5})\)\s")
TABLE_RULE = re.compile(r":?-{3,}:?")


def inline(text: str) -> str:
    text = escape(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<i>\1</i>", text)
    return re.sub(r"`(.+?)`", r'<font face="Courier">\1</font>', text)


def build_table(rows: list[list[str]]) -> Table:
    width = LETTER[0] - 2 * inch
    columns = max(len(row) for row in rows)
    data = [
        [Paragraph(inline(cell), CELL_HEAD if r == 0 else CELL) for cell in row + [""] * (columns - len(row))]
        for r, row in enumerate(rows)
    ]
    table = Table(data, colWidths=[width / columns] * columns, repeatRows=1, hAlign="LEFT")
    table.setStyle(
        TableStyle(
            [
                ("GRID", (0, 0), (-1, -1), 0.5, HAIRLINE),
                ("BACKGROUND", (0, 0), (-1, 0), CELL_BG),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return table


def parse(markdown: str) -> tuple[str, list]:
    title = ""
    story: list = []
    paragraph: list[str] = []
    bullets: list[str] = []
    rows: list[list[str]] = []

    def flush() -> None:
        if paragraph:
            story.append(Paragraph(inline(" ".join(paragraph)), BODY))
            paragraph.clear()
        if bullets:
            items = [ListItem(Paragraph(inline(b), BODY), leftIndent=16) for b in bullets]
            story.append(ListFlowable(items, bulletType="bullet", start="•", leftIndent=16))
            bullets.clear()
        if rows:
            story.append(build_table(rows))
            rows.clear()

    for raw in markdown.splitlines():
        line = raw.strip()
        if line == "<!-- pagebreak -->":
            flush()
            story.append(PageBreak())
        elif not line:
            flush()
        elif line.startswith("|"):
            if paragraph or bullets:
                flush()
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if not all(TABLE_RULE.fullmatch(cell) for cell in cells):
                rows.append(cells)
        elif line.startswith("# "):
            flush()
            title = title or line[2:]
            story.append(Paragraph(inline(line[2:]), TITLE))
        elif line.startswith("## "):
            flush()
            story.append(Paragraph(inline(line[3:]), H2))
        elif line.startswith("### "):
            flush()
            story.append(Paragraph(inline(line[4:]), H3))
        elif line.startswith("*") and not line.startswith("**") and line.endswith("*") and not story[1:]:
            story.append(Paragraph(inline(line.strip("*")), SUBTITLE))
        elif line.startswith("- "):
            if paragraph or rows:
                flush()
            bullets.append(line[2:])
        elif SUBCLAUSE.match(line):
            flush()
            story.append(Paragraph(inline(line), CLAUSE))
        elif line.startswith("> "):
            flush()
            story.append(Paragraph(inline(line[2:]), NOTE))
        else:
            if bullets or rows:
                flush()
            paragraph.append(line)
    flush()
    return title, story


def render(source: Path) -> tuple[Path, int]:
    target = source.with_suffix("")
    title, story = parse(source.read_text(encoding="utf-8"))

    def decorate(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(MUTED)
        canvas.drawString(inch, LETTER[1] - 0.6 * inch, title[:100])
        canvas.drawRightString(LETTER[0] - inch, LETTER[1] - 0.6 * inch, "CONFIDENTIAL")
        canvas.drawString(inch, 0.55 * inch, DISCLAIMER)
        canvas.drawRightString(LETTER[0] - inch, 0.55 * inch, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(target),
        pagesize=LETTER,
        leftMargin=inch,
        rightMargin=inch,
        topMargin=0.9 * inch,
        bottomMargin=0.85 * inch,
        title=title,
        author="Dejavu seed pack",
        subject=DISCLAIMER,
    )
    doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
    return target, doc.page


def main(paths: list[str]) -> None:
    sources = [Path(p).resolve() for p in paths] or sorted(SEED_PACK.rglob("*.pdf.md"))
    for source in sources:
        target, pages = render(source)
        shown = target.relative_to(SEED_PACK) if target.is_relative_to(SEED_PACK) else target
        print(f"{pages} page(s)  {shown}")


if __name__ == "__main__":
    main(sys.argv[1:])
