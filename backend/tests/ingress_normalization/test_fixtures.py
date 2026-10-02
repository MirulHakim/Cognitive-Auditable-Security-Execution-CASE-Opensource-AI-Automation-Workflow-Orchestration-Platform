"""
Mock raw Gmail/Telegram payloads, shaped to match the real, documented
Gmail API (users.messages.get) and Telegram Bot API (Message object)
structures - verified against official docs, not guessed.
"""

import base64

_BODY_TEXT = "Please process the attached invoice."
_ENCODED_BODY = base64.urlsafe_b64encode(_BODY_TEXT.encode()).decode().rstrip("=")

_HTML_BODY = "<html><body><p>Please process the attached invoice.</p></body></html>"
_ENCODED_HTML_BODY = base64.urlsafe_b64encode(_HTML_BODY.encode()).decode().rstrip("=")

GMAIL_RAW_MESSAGE = {
    "id": "18abc123def",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "multipart/mixed",
        "headers": [
            {"name": "From", "value": "ABC Supplier <supplier@example.com>"},
            {"name": "Subject", "value": "Invoice INV-001"},
            {"name": "To", "value": "orders@case-platform.example.com"},
        ],
        "parts": [
            {
                "mimeType": "text/plain",
                "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
            },
            {
                "filename": "invoice.pdf",
                "mimeType": "application/pdf",
                "body": {"attachmentId": "att-001", "size": 45231},
            },
        ],
    },
}

GMAIL_RAW_MESSAGE_NO_ATTACHMENT = {
    "id": "18abc456",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [
            {"name": "From", "value": "noreply@example.com"},
            {"name": "Subject", "value": "Status Update"},
        ],
        "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
    },
}

GMAIL_RAW_MESSAGE_HTML_ONLY = {
    "id": "18abc789",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/html",
        "headers": [
            {"name": "From", "value": "noreply@example.com"},
            {"name": "Subject", "value": "HTML Notice"},
        ],
        "body": {"data": _ENCODED_HTML_BODY, "size": len(_HTML_BODY)},
    },
}

GMAIL_RAW_MESSAGE_MISSING_SENDER = {
    "id": "18abc999",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [
            {"name": "Subject", "value": "No Sender"},
        ],
        "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
    },
}

GMAIL_RAW_MESSAGE_MISSING_ID = {
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
    },
}

GMAIL_RAW_MESSAGE_MISSING_TIMESTAMP = {
    "id": "18abc111",
    "threadId": "18abc000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
    },
}

GMAIL_RAW_MESSAGE_MALFORMED_ATTACHMENT = {
    "id": "18abc222",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "multipart/mixed",
        "headers": [{"name": "From", "value": "supplier@example.com"}],
        "parts": [
            {"mimeType": "text/plain", "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)}},
            {"filename": "broken.pdf", "mimeType": "application/pdf", "body": {"size": 1000}},
        ],
    },
}

GMAIL_RAW_MESSAGE_QUOTED_SENDER = {
    "id": "18abc333",
    "threadId": "18abc000",
    "internalDate": "1755683400000",
    "payload": {
        "mimeType": "text/plain",
        "headers": [
            {"name": "From", "value": '"Doe, John" <john@example.com>'},
        ],
        "body": {"data": _ENCODED_BODY, "size": len(_BODY_TEXT)},
    },
}

TELEGRAM_RAW_UPDATE = {
    "update_id": 987654,
    "message": {
        "message_id": 123,
        "date": 1755683400,
        "from": {
            "id": 456,
            "is_bot": False,
            "first_name": "John",
            "username": "supplier",
        },
        "chat": {"id": 456, "type": "private"},
        "text": "Please process the attached invoice.",
        "document": {
            "file_id": "BAACAgIAAxkBAA",
            "file_name": "invoice.pdf",
            "mime_type": "application/pdf",
            "file_size": 45231,
        },
    },
}

TELEGRAM_RAW_TEXT_ONLY = {
    "update_id": 987655,
    "message": {
        "message_id": 124,
        "date": 1755683400,
        "from": {"id": 789, "is_bot": False, "first_name": "Jane"},
        "chat": {"id": 789, "type": "private"},
        "text": "What is the status of my order?",
    },
}

TELEGRAM_RAW_MISSING_SENDER = {
    "message": {
        "message_id": 200,
        "date": 1755683400,
        "chat": {"id": 1, "type": "private"},
        "text": "Hello",
    },
}

TELEGRAM_RAW_MISSING_MESSAGE_ID = {
    "message": {
        "date": 1755683400,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "Hello",
    },
}

TELEGRAM_RAW_MISSING_DATE = {
    "message": {
        "message_id": 201,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "Hello",
    },
}

TELEGRAM_RAW_MALFORMED_DOCUMENT = {
    "message": {
        "message_id": 202,
        "date": 1755683400,
        "from": {"id": 456, "is_bot": False, "first_name": "John"},
        "chat": {"id": 456, "type": "private"},
        "text": "See attached",
        "document": {"file_name": "broken.pdf", "mime_type": "application/pdf"},
    },
}
