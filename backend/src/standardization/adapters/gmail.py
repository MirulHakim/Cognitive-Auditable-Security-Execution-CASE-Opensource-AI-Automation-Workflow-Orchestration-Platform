"""
CASE — Data Standardization & Normalization Layer
Gmail adapter (Step 3)

Location: src/standardization/adapters/gmail.py

One parser, two outputs:
  - to_message(): an incoming Gmail request  -> StandardMessage   (standardization 1)
  - to_record():  an email read from the EMAIL_SERVICE resource -> StandardRecord (standardization 2)

Accepts Gmail API messages in either format:
  - format='raw'  (recommended): {"id": ..., "raw": "<base64url RFC 822>", "internalDate": "..."}
  - format='full': {"id": ..., "payload": {"headers": [...], "body": {...}, "parts": [...]}}

Security decisions (whitelist, DKIM/SPF) are made at ingress, not here.
The caller passes verified=True only after ingress has accepted the sender.
`auth_results()` is provided so ingress can read DKIM/SPF from the same parse.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from typing import Any, Optional

from pydantic import ValidationError

from ..schemas import AttachmentMeta, FieldType, MessageSource, Sender, StandardMessage, StandardRecord, VerificationMethod
from ..utils import decode_b64url, decode_b64url_text, html_to_text, normalize_short_text, normalize_text, parse_address, parse_date, sha256_hex
from .base import StandardizationError

EMAIL_RECORD_BODY_CHARS = 2_000  # shorter per email when many emails go into one record set

EMAIL_FIELD_TYPES: dict[str, FieldType] = {
    "sender": FieldType.STRING,
    "sender_name": FieldType.STRING,
    "subject": FieldType.STRING,
    "body_text": FieldType.STRING,
    "attachment_count": FieldType.NUMBER,
}


@dataclass(frozen=True)
class ParsedEmail:
    gmail_id: str
    from_name: Optional[str]
    from_addr: str
    subject: Optional[str]
    date: datetime
    body_text: str
    body_truncated: bool
    attachments: list[AttachmentMeta] = field(default_factory=list)
    auth_results: str = ""
    raw_hash: str = ""


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------
def _from_raw_format(msg: dict[str, Any]) -> tuple[dict[str, str], str, bool, list[AttachmentMeta], bytes]:
    raw_bytes = decode_b64url(msg["raw"])
    em: EmailMessage = BytesParser(policy=policy.default).parsebytes(raw_bytes)
    headers = {k.lower(): str(v) for k, v in em.items()}
    text, is_html = "", False
    body = em.get_body(preferencelist=("plain", "html"))
    if body is not None:
        try:
            text = body.get_content()
        except (LookupError, ValueError):
            text = (body.get_payload(decode=True) or b"").decode("utf-8", errors="replace")
        is_html = body.get_content_type() == "text/html"
    atts = []
    for i, part in enumerate(em.iter_attachments()):
        payload = part.get_payload(decode=True) or b""
        # Raw format has no Gmail attachmentId (the content is already inline) -
        # use Content-ID if the part has one, else a stable positional id.
        content_id = part.get("Content-ID")
        attachment_id = content_id.strip("<>") if content_id else f"att{i}"
        atts.append(AttachmentMeta(attachment_id=attachment_id, filename=(part.get_filename() or "attachment")[:255],
                                   mime_type=part.get_content_type(), size_bytes=len(payload)))
    return headers, text, is_html, atts, raw_bytes


def _walk_parts(part: dict[str, Any], found: dict[str, str], atts: list[AttachmentMeta]) -> None:
    mime = part.get("mimeType", "")
    body = part.get("body") or {}
    if part.get("filename"):
        # attachmentId may be absent - the attachment is still listed (with
        # attachment_id=None) rather than dropped; it just can't be fetched later.
        atts.append(AttachmentMeta(attachment_id=body.get("attachmentId"), filename=part["filename"][:255],
                                   mime_type=mime or "application/octet-stream", size_bytes=int(body.get("size", 0))))
    elif mime in ("text/plain", "text/html") and body.get("data") and mime not in found:
        charset = "utf-8"
        for h in part.get("headers", []):
            if h.get("name", "").lower() == "content-type":
                m = re.search(r'charset="?([\w-]+)', h.get("value", ""))
                charset = m.group(1) if m else charset
        found[mime] = decode_b64url_text(body["data"], charset)
    for sub in part.get("parts", []) or []:
        _walk_parts(sub, found, atts)


def _from_full_format(msg: dict[str, Any]) -> tuple[dict[str, str], str, bool, list[AttachmentMeta]]:
    payload = msg.get("payload") or {}
    headers = {h["name"].lower(): h.get("value", "") for h in payload.get("headers", []) if "name" in h}
    found: dict[str, str] = {}
    atts: list[AttachmentMeta] = []
    _walk_parts(payload, found, atts)
    if "text/plain" in found:
        return headers, found["text/plain"], False, atts
    return headers, found.get("text/html", ""), "text/html" in found, atts


def parse_gmail(msg: dict[str, Any], max_body_chars: Optional[int] = None) -> ParsedEmail:
    """Parse a Gmail API message (raw or full format) into clean fields."""
    if not isinstance(msg, dict) or "id" not in msg:
        raise StandardizationError("not a Gmail API message (missing 'id')", source="GMAIL")
    try:
        if "raw" in msg:
            headers, text, is_html, atts, raw_bytes = _from_raw_format(msg)
            raw_hash = sha256_hex(raw_bytes)
        elif "payload" in msg:
            headers, text, is_html, atts = _from_full_format(msg)
            raw_hash = sha256_hex(msg)
        else:
            raise StandardizationError("Gmail message has neither 'raw' nor 'payload'", source="GMAIL")

        from_name, from_addr = parse_address(headers.get("from", ""))
        date_src = headers.get("date") or msg.get("internalDate")
        if date_src is None:
            raise StandardizationError("Gmail message has no date", source="GMAIL")
        date = parse_date(date_src)
        if is_html:
            text = html_to_text(text)
        kwargs = {"max_chars": max_body_chars} if max_body_chars else {}
        body, truncated = normalize_text(text, **kwargs)
        return ParsedEmail(gmail_id=str(msg["id"]), from_name=from_name, from_addr=from_addr,
                           subject=normalize_short_text(headers.get("subject")), date=date,
                           body_text=body, body_truncated=truncated, attachments=atts,
                           auth_results=headers.get("authentication-results", ""), raw_hash=raw_hash)
    except StandardizationError:
        raise
    except (ValueError, KeyError, TypeError, ValidationError) as exc:
        raise StandardizationError(f"could not parse Gmail message: {exc}", source="GMAIL") from exc


def auth_results(msg: dict[str, Any]) -> dict[str, Optional[str]]:
    """For ingress: read DKIM/SPF results, e.g. {'dkim': 'pass', 'spf': 'fail'}."""
    header = parse_gmail(msg).auth_results
    get = lambda key: (re.search(rf"\b{key}=(\w+)", header) or [None, None])[1]
    return {"dkim": get("dkim"), "spf": get("spf")}


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------
def to_message(msg: dict[str, Any], *, workspace_id: str, verified: bool,
               metadata: Optional[dict[str, Any]] = None) -> StandardMessage:
    """Incoming Gmail request -> StandardMessage. `verified` comes from the ingress check."""
    p = parse_gmail(msg)
    try:
        return StandardMessage(
            workspace_id=workspace_id, source=MessageSource.GMAIL, source_message_id=p.gmail_id,
            sender=Sender(id=p.from_addr, display_name=p.from_name, verified=verified,
                          verification_method=VerificationMethod.WHITELIST_DKIM_SPF),
            received_at=p.date, subject=p.subject, body_text=p.body_text, body_truncated=p.body_truncated,
            attachments=p.attachments, metadata=metadata or {}, raw_hash=p.raw_hash,
        )
    except ValidationError as exc:
        raise StandardizationError(f"Gmail message failed validation: {exc.errors()[0]['msg']}", source="GMAIL") from exc


def to_record(msg: dict[str, Any]) -> StandardRecord:
    """Email read from the EMAIL_SERVICE resource -> StandardRecord (use with EMAIL_FIELD_TYPES)."""
    p = parse_gmail(msg, max_body_chars=EMAIL_RECORD_BODY_CHARS)
    return StandardRecord(
        record_id=p.gmail_id, record_type="email", occurred_at=p.date,
        data={"sender": p.from_addr, "sender_name": p.from_name, "subject": p.subject,
              "body_text": p.body_text, "attachment_count": len(p.attachments)},
        metadata={"body_truncated": True} if p.body_truncated else {},
    )
