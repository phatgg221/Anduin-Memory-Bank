"""Top-level utils.markitdown re-export from app.utils.markitdown."""

from app.utils.markitdown import (
    ConversionResult,
    MarkItDownTool,
    aconvert_to_markdown,
    cli,
    convert_to_markdown,
    get_markitdown_tool,
)

__all__ = [
    "ConversionResult",
    "MarkItDownTool",
    "aconvert_to_markdown",
    "cli",
    "convert_to_markdown",
    "get_markitdown_tool",
]

if __name__ == "__main__":
    cli()
