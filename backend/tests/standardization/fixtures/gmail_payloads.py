"""
Sample Gmail API payloads for standardization tests.

The 'full' format fixtures are ported from the old src/ingress_normalization
test fixtures (real, documented Gmail API users.messages.get shapes). The
'raw' format fixtures are built with stdlib email.message.EmailMessage so the
MIME structure (boundaries, encodings) is always valid, rather than hand-typed.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import format_datetime

MYT = timezone(timedelta(hours=8))


def _b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


BODY_TEXT = "Please process the attached invoice."
ENCODED_BODY = _b64(BODY_TEXT)

HTML_BODY = "<html><body><p>Please process the attached invoice.</p></body></html>"
ENCODED_HTML_BODY = _b64(HTML_BODY)


# ---------------------------------------------------------------------------
# 'full' format (payload / headers / parts)
# ---------------------------------------------------------------------------
FULL_WITH_ATTACHMENT = {
    "id": "18abc123def",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "multipart/mixed",
        "headers": [
            {"name": "From", "value": "ABC Supplier <supplier@example.com>"},
            {"name": "Subject", "value": "Invoice INV-001"},
            {"name": "To", "value": "orders@case-platform.example.com"},
            {"name": "Authentication-Results", "value": "mx.google.com; dkim=pass; spf=fail;"},
        ],
        "parts": [
            {"mimeType": "text/plain", "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)}},
            {"filename": "invoice.pdf", "mimeType": "application/pdf", "body": {"attachmentId": "att-001", "size": 45231}},
        ],
    },
}

FULL_NO_ATTACHMENT = {
    "id": "18abc456",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [
            {"name": "From", "value": "noreply@example.com"},
            {"name": "Subject", "value": "Status Update"},
        ],
        "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)},
    },
}

FULL_HTML_ONLY = {
    "id": "18abc789",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/html",
        "headers": [
            {"name": "From", "value": "noreply@example.com"},
            {"name": "Subject", "value": "HTML Notice"},
        ],
        "body": {"data": ENCODED_HTML_BODY, "size": len(HTML_BODY)},
    },
}

FULL_MISSING_SENDER = {
    "id": "18abc999",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "Subject", "value": "No Sender"}],
        "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)},
    },
}

MISSING_ID = {
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)},
    },
}

FULL_MISSING_TIMESTAMP = {
    "id": "18abc111",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)},
    },
}

FULL_MALFORMED_ATTACHMENT = {
    "id": "18abc222",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "multipart/mixed",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "parts": [
            {"mimeType": "text/plain", "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)}},
            {"filename": "broken.pdf", "mimeType": "application/pdf", "body": {"size": 1000}},
        ],
    },
}

FULL_QUOTED_SENDER = {
    "id": "18abc333",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "From", "value": '"Doe, John" <john@example.com>'}],
        "body": {"data": ENCODED_BODY, "size": len(BODY_TEXT)},
    },
}

NEITHER_RAW_NOR_PAYLOAD = {"id": "no-source-18abc444"}


# ---------------------------------------------------------------------------
# 'raw' format (base64url RFC 822), built with EmailMessage for valid MIME
# ---------------------------------------------------------------------------
def _build_raw(*, msg_id: str, from_addr: str, subject: str, date: "datetime | None",
               html_body: str | None = None, plain_body: str | None = None,
               attachment_bytes: bytes | None = None, attachment_filename: str = "invoice.pdf") -> dict:
    em = EmailMessage()
    em["From"] = from_addr
    em["To"] = "orders@example.com"
    em["Subject"] = subject
    if date is not None:
        em["Date"] = format_datetime(date)
    if html_body is not None:
        em.set_content(html_body, subtype="html")
    else:
        em.set_content(plain_body or "")
    if attachment_bytes is not None:
        em.add_attachment(attachment_bytes, maintype="application", subtype="pdf", filename=attachment_filename)
    encoded = base64.urlsafe_b64encode(em.as_bytes()).decode().rstrip("=")
    return {"id": msg_id, "raw": encoded}


RAW_HTML_WITH_ATTACHMENT = _build_raw(
    msg_id="raw-html-1",
    from_addr="Supplier <SUPPLIER@Example.COM>",
    subject="  Invoice   INV-002  ",
    date=datetime(2026, 10, 1, 9, 0, tzinfo=MYT),
    html_body="<html><body><p>Please process the <b>attached</b> invoice.</p><script>evil()</script></body></html>",
    attachment_bytes=b"%PDF-1.4 fake pdf content",
)

RAW_PLAIN_NO_ATTACHMENT = _build_raw(
    msg_id="raw-plain-1",
    from_addr="noreply@example.com",
    subject="Status",
    date=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc),
    plain_body=BODY_TEXT,
)

RAW_MISSING_DATE = _build_raw(
    msg_id="raw-no-date-1",
    from_addr="noreply@example.com",
    subject="No date",
    date=None,
    plain_body=BODY_TEXT,
)
