import io
from pathlib import Path

import pytest

from app.utils.markitdown import (
    ConversionResult,
    MarkItDownTool,
    aconvert_to_markdown,
    convert_to_markdown,
    get_markitdown_tool,
)
from utils.markitdown import convert_to_markdown as top_level_convert


def test_convert_bytes_text():
    sample_text = b"# Test Document\n\nThis is a sample document for testing MarkItDown."
    res = convert_to_markdown(sample_text, file_extension=".txt")

    assert isinstance(res, ConversionResult)
    assert "Test Document" in res.markdown
    assert "sample document" in res.markdown
    assert res.word_count > 0
    assert res.char_count > 0
    assert str(res) == res.markdown


def test_convert_stream():
    tool = MarkItDownTool()
    stream = io.BytesIO(b"## Section Heading\n\n- Point 1\n- Point 2")
    res = tool.convert_stream(stream, file_extension=".md", source_name="points.md")

    assert "Section Heading" in res.markdown
    assert "Point 1" in res.markdown
    assert res.source == "points.md"
    assert res.file_extension == ".md"


def test_top_level_utils_reexport():
    res = top_level_convert(b"Header\nBody paragraph", file_extension=".txt")
    assert "Header" in res.markdown
    assert "Body paragraph" in res.markdown


def test_convert_seed_pdf():
    pdf_path = (
        Path(__file__).resolve().parents[1]
        / "data"
        / "seed_pack"
        / "cases"
        / "CASE-2025-067_kingsmoor-european-infrastructure-raif"
        / "luxembourg_cssf_10pct_aml_compliance_guide.pdf"
    )
    if not pdf_path.exists():
        pytest.skip(f"Seed PDF not found at {pdf_path}")

    res = convert_to_markdown(pdf_path)
    assert "CSSF" in res.markdown or "Luxembourg" in res.markdown
    assert res.file_extension == ".pdf"
    assert res.source == str(pdf_path)


@pytest.mark.anyio
async def test_aconvert_to_markdown():
    data = b"# Async Test\n\nExecuted smoothly without blocking event loop."
    res = await aconvert_to_markdown(data, file_extension=".md")
    assert "Async Test" in res.markdown
    assert "Executed smoothly" in res.markdown


def test_file_not_found():
    tool = get_markitdown_tool()
    with pytest.raises(FileNotFoundError):
        tool.convert_file("non_existent_file_12345.xyz")
