"""MarkItDown tool for converting various document formats into Markdown.

Built on Microsoft's MarkItDown library (supports PDF, DOCX, XLSX, PPTX, HTML,
CSV, JSON, XML, text, audio transcription, etc.).

Usage:
    # 1. Functional synchronous conversion:
    from app.utils.markitdown import convert_to_markdown

    result = convert_to_markdown("path/to/contract.pdf")
    print(result.markdown)

    # 2. Functional asynchronous conversion (thread-safe, non-blocking for FastAPI):
    from app.utils.markitdown import aconvert_to_markdown

    result = await aconvert_to_markdown(raw_bytes, file_extension=".docx")
    print(result.markdown)

    # 3. Object-oriented tool with MinIO storage conversion:
    from app.utils.markitdown import MarkItDownTool

    tool = MarkItDownTool()
    result = await tool.aconvert_storage_object(bucket="dejavu", key="cases/CASE-001/agreement.pdf")
"""

from __future__ import annotations

import asyncio
import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO

from markitdown import MarkItDown


@dataclass(slots=True)
class ConversionResult:
    """Standardized result returned by document-to-markdown conversions."""

    markdown: str
    title: str | None = None
    source: str | None = None
    file_extension: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def char_count(self) -> int:
        return len(self.markdown)

    @property
    def word_count(self) -> int:
        return len(self.markdown.split())

    def __str__(self) -> str:
        return self.markdown


class MarkItDownTool:
    """Wrapper around Microsoft MarkItDown with streaming, storage, and async support."""

    def __init__(
        self,
        llm_client: Any | None = None,
        llm_model: str | None = None,
        style_guidance: str | None = None,
    ) -> None:
        """Initialize MarkItDown engine.

        Args:
            llm_client: Optional OpenAI-compatible LLM client for multimodal image description.
            llm_model: Optional LLM model identifier (e.g. "gpt-4o").
            style_guidance: Optional system prompt or style guide for LLM conversions.
        """
        self._md = MarkItDown(
            llm_client=llm_client,
            llm_model=llm_model,
            style_guidance=style_guidance,
        )

    @property
    def client(self) -> MarkItDown:
        """Access underlying Microsoft MarkItDown instance."""
        return self._md

    def convert_file(self, path: str | Path, **kwargs: Any) -> ConversionResult:
        """Convert a local file to Markdown.

        Args:
            path: Path to the document (e.g. PDF, Word, Excel, etc.).
            **kwargs: Extra parameters passed to MarkItDown.convert().
        """
        p = Path(path).resolve()
        if not p.is_file():
            raise FileNotFoundError(f"File not found: {p}")

        res = self._md.convert(str(p), **kwargs)
        markdown = res.text_content or ""
        ext = p.suffix.lower() if p.suffix else None

        return ConversionResult(
            markdown=markdown,
            title=getattr(res, "title", None),
            source=str(p),
            file_extension=ext,
            metadata={"filename": p.name},
        )

    def convert_stream(
        self,
        stream: BinaryIO,
        *,
        file_extension: str | None = None,
        source_name: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Convert a seekable binary stream to Markdown.

        Args:
            stream: File-like binary stream (must be seekable, e.g. io.BytesIO).
            file_extension: Extension hint including the dot (e.g. '.pdf', '.docx').
            source_name: Optional descriptor or original filename.
            **kwargs: Extra parameters passed to MarkItDown.convert_stream().
        """
        if not hasattr(stream, "seekable") or not stream.seekable():
            # Wrap non-seekable streams in BytesIO
            stream = io.BytesIO(stream.read())

        clean_ext = file_extension.lower() if file_extension else None
        if clean_ext and not clean_ext.startswith("."):
            clean_ext = f".{clean_ext}"

        res = self._md.convert_stream(stream, file_extension=clean_ext, **kwargs)
        markdown = res.text_content or ""

        return ConversionResult(
            markdown=markdown,
            title=getattr(res, "title", None),
            source=source_name,
            file_extension=clean_ext,
            metadata={"stream_type": type(stream).__name__},
        )

    def convert_bytes(
        self,
        data: bytes,
        *,
        file_extension: str | None = None,
        filename: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Convert raw bytes to Markdown.

        Args:
            data: Raw document byte content.
            file_extension: Extension hint including dot (e.g. '.pdf').
            filename: Optional filename used to infer extension if not provided.
            **kwargs: Extra parameters passed to MarkItDown.convert_stream().
        """
        ext = file_extension
        if not ext and filename:
            ext = Path(filename).suffix

        stream = io.BytesIO(data)
        return self.convert_stream(
            stream,
            file_extension=ext,
            source_name=filename or "bytes",
            **kwargs,
        )

    def convert_storage_object(
        self,
        bucket: str,
        key: str,
        *,
        filename: str | None = None,
        minio_client: Any | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Fetch and convert an object stored in MinIO/S3 object storage.

        Args:
            bucket: MinIO bucket name.
            key: Object key in the bucket.
            filename: Optional filename hint to determine format.
            minio_client: Optional MinIO client. Defaults to app.core.storage.internal.
            **kwargs: Extra parameters passed to conversion.
        """
        client = minio_client
        if client is None:
            from app.core.storage import internal

            client = internal

        response = client.get_object(bucket, key)
        try:
            data = response.read()
        finally:
            response.close()
            response.release_conn()

        target_name = filename or Path(key).name
        ext = Path(target_name).suffix
        res = self.convert_bytes(data, file_extension=ext, filename=target_name, **kwargs)
        res.metadata.update({"bucket": bucket, "object_key": key})
        return res

    def convert(
        self,
        source: str | Path | BinaryIO | bytes,
        *,
        file_extension: str | None = None,
        filename: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Universal converter entrypoint accepting a file path, bytes, or binary stream."""
        if isinstance(source, (str, Path)):
            p = Path(source)
            if p.is_file():
                return self.convert_file(p, **kwargs)
            # If string is not an existing file path, check if it's raw text/markdown
            guessed_ext = file_extension or (f".{p.suffix.lstrip('.')}" if p.suffix else ".txt")
            return self.convert_bytes(
                str(source).encode("utf-8"),
                file_extension=guessed_ext,
                filename=filename,
                **kwargs,
            )
        if isinstance(source, bytes):
            return self.convert_bytes(source, file_extension=file_extension, filename=filename, **kwargs)
        if hasattr(source, "read"):
            return self.convert_stream(
                source,
                file_extension=file_extension or (Path(filename).suffix if filename else None),
                source_name=filename,
                **kwargs,
            )

        raise TypeError(f"Unsupported source type for MarkItDown conversion: {type(source)!r}")

    # Async non-blocking equivalents (using asyncio.to_thread)

    async def aconvert_file(self, path: str | Path, **kwargs: Any) -> ConversionResult:
        """Asynchronously convert a local file on a worker thread."""
        return await asyncio.to_thread(self.convert_file, path, **kwargs)

    async def aconvert_stream(
        self,
        stream: BinaryIO,
        *,
        file_extension: str | None = None,
        source_name: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Asynchronously convert a stream on a worker thread."""
        return await asyncio.to_thread(
            self.convert_stream,
            stream,
            file_extension=file_extension,
            source_name=source_name,
            **kwargs,
        )

    async def aconvert_bytes(
        self,
        data: bytes,
        *,
        file_extension: str | None = None,
        filename: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Asynchronously convert raw bytes on a worker thread."""
        return await asyncio.to_thread(
            self.convert_bytes,
            data,
            file_extension=file_extension,
            filename=filename,
            **kwargs,
        )

    async def aconvert_storage_object(
        self,
        bucket: str,
        key: str,
        *,
        filename: str | None = None,
        minio_client: Any | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Asynchronously fetch and convert a MinIO storage object."""
        return await asyncio.to_thread(
            self.convert_storage_object,
            bucket,
            key,
            filename=filename,
            minio_client=minio_client,
            **kwargs,
        )

    async def aconvert(
        self,
        source: str | Path | BinaryIO | bytes,
        *,
        file_extension: str | None = None,
        filename: str | None = None,
        **kwargs: Any,
    ) -> ConversionResult:
        """Asynchronously convert any supported source on a worker thread."""
        return await asyncio.to_thread(
            self.convert,
            source,
            file_extension=file_extension,
            filename=filename,
            **kwargs,
        )


_default_tool: MarkItDownTool | None = None


def get_markitdown_tool() -> MarkItDownTool:
    """Get or initialize the shared singleton MarkItDownTool instance."""
    global _default_tool
    if _default_tool is None:
        _default_tool = MarkItDownTool()
    return _default_tool


def convert_to_markdown(
    source: str | Path | BinaryIO | bytes,
    *,
    file_extension: str | None = None,
    filename: str | None = None,
    **kwargs: Any,
) -> ConversionResult:
    """Convenience function to convert file, bytes, or stream to Markdown synchronously."""
    return get_markitdown_tool().convert(
        source,
        file_extension=file_extension,
        filename=filename,
        **kwargs,
    )


async def aconvert_to_markdown(
    source: str | Path | BinaryIO | bytes,
    *,
    file_extension: str | None = None,
    filename: str | None = None,
    **kwargs: Any,
) -> ConversionResult:
    """Convenience function to convert file, bytes, or stream to Markdown asynchronously."""
    return await get_markitdown_tool().aconvert(
        source,
        file_extension=file_extension,
        filename=filename,
        **kwargs,
    )


def cli() -> None:
    """Command-line interface for converting files to Markdown."""
    import argparse
    import sys

    parser = argparse.ArgumentParser(
        description="Convert documents (PDF, DOCX, XLSX, etc.) to Markdown via Microsoft MarkItDown.",
    )
    parser.add_argument("path", help="Path to the document to convert")
    parser.add_argument("-o", "--output", help="Output file path (default: stdout)")

    args = parser.parse_args()
    try:
        result = convert_to_markdown(args.path)
        if args.output:
            out_p = Path(args.output).resolve()
            out_p.parent.mkdir(parents=True, exist_ok=True)
            out_p.write_text(result.markdown, encoding="utf-8")
            print(f"Successfully converted {args.path} -> {out_p} ({result.word_count} words)")
        else:
            sys.stdout.write(result.markdown)
            if not result.markdown.endswith("\n"):
                sys.stdout.write("\n")
    except Exception as exc:
        print(f"Error converting {args.path}: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    cli()
