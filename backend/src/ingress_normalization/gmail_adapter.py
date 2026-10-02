"""
Gmail Adapter - Ingress Input Normalization

Converts a Gmail API `users.messages.get` response into a
StandardizedIngressRequest. Shape verified against Google's official Gmail
API reference (Message / MessagePart resources) rather than guessed:

- Sender/Subject/Date are NOT flat fields - they live in payload.headers as
  an array of {name, value} pairs.
- Body text is base64url-encoded and may be nested under payload.parts for
  multipart messages (text/plain part alongside attachment parts).
- Attachments appear as parts with a `filename` and `body.attachmentId` -
  there is no separate top-level "attachments" array.
- internalDate is epoch milliseconds, as a string.

Required fields (sender, message id, timestamp) are fail-fast: missing data
raises ValueError rather than being silently replaced with a misleading
default (e.g. an empty sender, or "now" standing in for an unknown time).

Deliberately does not check whitelist/workspace/permissions - that's the
Ingress Listener / security layer's responsibility.
"""

import base64
from datetime import datetime, timezone
from email.utils import parseaddr
from html.parser import HTMLParser
from typing import Any, Dict, List, Optional, Tuple

from ._validation import require
from .schemas import IngressAttachment, StandardizedIngressRequest


def _get_header(headers: List[Dict[str, str]], name: str) -> Optional[str]:
    for header in headers:
        if header.get("name", "").lower() == name.lower():
            return header.get("value")
    return None


def _parse_sender(from_header: Optional[str]) -> Tuple[str, Optional[str]]:
    """Parse a From header into (email, display_name) using stdlib email
    parsing rather than manual </> splitting, which mishandles quoted
    display names (e.g. '"Doe, John" <john@example.com>') and other
    RFC 2822 edge cases."""
    if not from_header:
        return "", None
    display_name, email_address = parseaddr(from_header)
    return email_address, (display_name or None)


class _HTMLTextExtractor(HTMLParser):
    """Best-effort plain-text extraction from an HTML body - not full HTML
    rendering, just enough to keep `content` readable when no text/plain
    part exists. Stdlib only, deliberately not pulling in a full HTML
    parsing library, to stay within normalization's scope."""

    _SKIP_TAGS = {"script", "style"}

    def __init__(self):
        super().__init__()
        self._skip_depth = 0
        self.text_parts: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1

    def handle_endtag(self, tag):
        if tag in self._SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1

    def handle_data(self, data):
        if self._skip_depth == 0:
            stripped = data.strip()
            if stripped:
                self.text_parts.append(stripped)


def _html_to_text(html: str) -> str:
    extractor = _HTMLTextExtractor()
    extractor.feed(html)
    return " ".join(extractor.text_parts)


def _decode_body(body: Dict[str, Any]) -> str:
    data = body.get("data")
    if not data:
        return ""
    padded = data + "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(padded).decode("utf-8", errors="replace")


def _walk_parts(part: Dict[str, Any]) -> Tuple[Optional[str], Optional[str], List[IngressAttachment]]:
    """Recursively walk a MessagePart tree.

    Returns (plain_text, html_text, attachments) - the caller prefers
    plain_text and only falls back to html_text if no text/plain part
    exists anywhere in the tree.
    """
    plain_text: Optional[str] = None
    html_text: Optional[str] = None
    attachments: List[IngressAttachment] = []

    mime_type = part.get("mimeType", "")
    filename = part.get("filename")
    body = part.get("body") or {}

    if filename:
        attachment_id = body.get("attachmentId")
        if attachment_id:
            attachments.append(IngressAttachment(
                attachment_id=attachment_id,
                filename=filename,
                mime_type=mime_type or None,
                size_bytes=body.get("size"),
            ))
        # else: a filename with no attachmentId is an unusable reference -
        # it can't be retrieved later, so it's deliberately skipped rather
        # than included as a broken attachment.
    elif mime_type == "text/plain" and body.get("data"):
        plain_text = _decode_body(body)
    elif mime_type == "text/html" and body.get("data"):
        html_text = _decode_body(body)

    for child in part.get("parts", []):
        child_plain, child_html, child_attachments = _walk_parts(child)
        if child_plain and not plain_text:
            plain_text = child_plain
        if child_html and not html_text:
            html_text = child_html
        attachments.extend(child_attachments)

    return plain_text, html_text, attachments


def normalize_gmail(raw: Dict[str, Any]) -> StandardizedIngressRequest:
    """Convert a Gmail API `users.messages.get` response into StandardizedIngressRequest.

    Raises ValueError if sender, message id, or timestamp is missing - these
    are never fabricated.
    """
    message_id = require(raw.get("id"), "Gmail message missing required 'id' field")

    payload = raw.get("payload", {})
    headers = payload.get("headers", [])

    sender_id, sender_name = _parse_sender(_get_header(headers, "From"))
    require(sender_id, f"Gmail message {message_id} missing required 'From' header")

    subject = _get_header(headers, "Subject")

    plain_text, html_text, attachments = _walk_parts(payload)
    if plain_text is not None:
        content = plain_text
    elif html_text is not None:
        content = _html_to_text(html_text)
    else:
        content = ""

    internal_date_ms = raw.get("internalDate")
    require(internal_date_ms, f"Gmail message {message_id} missing required 'internalDate' field")
    received_at = datetime.fromtimestamp(int(internal_date_ms) / 1000, tz=timezone.utc)

    return StandardizedIngressRequest(
        source="GMAIL",
        sender_id=sender_id,
        sender_name=sender_name,
        subject=subject,
        content=content,
        attachments=attachments,
        received_at=received_at,
        source_message_id=message_id,
        metadata={"thread_id": raw.get("threadId")},
    )
