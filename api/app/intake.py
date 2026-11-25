"""Reading an uploaded file before a run continues.

PDFs use their text layer (pypdf). Images need OCR: Pillow is present for
decoding, but Tesseract itself is an external binary — when it is missing the
intake refuses the upload with a clear 503 instead of pretending to read it.
"""

from __future__ import annotations

import io
from typing import Any

from .errors import unprocessable, unavailable

FILE_TYPES = ("pdf", "jpg", "jpeg", "png")


class UnreadableFile(Exception):
    pass


def _extension(file_name: str) -> str:
    _, _, suffix = file_name.rpartition(".")
    return suffix.lower()


def _kind(file_name: str, mime_type: str) -> str | None:
    suffix = _extension(file_name)
    if suffix in FILE_TYPES:
        return "jpeg" if suffix == "jpeg" else suffix
    lowered = mime_type.lower()
    if "pdf" in lowered:
        return "pdf"
    if "jpeg" in lowered or "jpg" in lowered:
        return "jpg"
    if "png" in lowered:
        return "png"
    return None


def read_pdf_text(data: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as error:  # pragma: no cover - dependency is declared
        raise UnreadableFile("PDF support is not installed.") from error

    try:
        reader = PdfReader(io.BytesIO(data))
        pages = [(page.extract_text() or "") for page in reader.pages]
    except Exception as error:
        raise UnreadableFile("The PDF could not be opened.") from error

    text = "\n".join(part.strip() for part in pages if part.strip())
    if not text.strip():
        raise UnreadableFile(
            "The PDF has no text layer. Upload a scanned page as JPG/PNG so OCR can read it."
        )
    return text


def ocr_image(data: bytes) -> str:
    try:
        from PIL import Image
        import pytesseract  # type: ignore[import-not-found]
    except ImportError as error:
        raise unavailable(
            "OCR is unavailable: install Tesseract and pytesseract, or upload a PDF with a text layer.",
            {"reason": str(error)},
        ) from error

    try:
        image = Image.open(io.BytesIO(data))
        text = pytesseract.image_to_string(image)
    except Exception as error:
        raise UnreadableFile("The image could not be read.") from error

    if not text.strip():
        raise UnreadableFile("OCR found no text in the image.")
    return text


def read_upload(
    *,
    file_name: str,
    mime_type: str,
    data: bytes,
    accepted: list[str] | None,
) -> dict[str, Any]:
    """Extracts text, enforcing the step's accepted file types."""
    accepted_types = [item.lower() for item in (accepted or list(FILE_TYPES))]
    kind = _kind(file_name, mime_type)
    if kind is None:
        raise unprocessable(
            f"'{file_name}' is not a supported file type. Upload one of: {', '.join(FILE_TYPES)}.",
            {"acceptedFileTypes": accepted_types},
        )
    if kind not in accepted_types and not (
        kind == "jpeg" and "jpeg" in accepted_types
    ) and kind not in {"jpeg"}:
        raise unprocessable(
            f"This step accepts {', '.join(accepted_types)}; '{file_name}' is a {kind}.",
            {"acceptedFileTypes": accepted_types},
        )

    if kind == "pdf":
        text = read_pdf_text(data)
        method = "pdf-text-layer"
    else:
        text = ocr_image(data)
        method = "ocr"

    return {
        "fileName": file_name,
        "mimeType": mime_type or f"application/{kind}",
        "bytes": len(data),
        "text": text,
        "method": method,
    }
