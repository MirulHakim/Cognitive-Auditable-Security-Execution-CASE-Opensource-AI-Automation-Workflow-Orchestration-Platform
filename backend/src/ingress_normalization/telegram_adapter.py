"""
Telegram Adapter - Ingress Input Normalization

Converts a Telegram Bot API Update/Message object into a
StandardizedIngressRequest. Shape verified against Telegram's official Bot
API reference rather than guessed:

- Sender is `from.id` (integer) + optional `from.username`/`from.first_name`
  - not a flat "sender" field.
- There is no "subject" concept in Telegram at all - always None.
- Text lives in `text`, but media messages use `caption` instead - a
  document-only message can have no text field at all.
- Attachments are type-specific objects (document/audio/video/photo), each
  shaped differently, not a single uniform "attachments" array.
- `date` is a Unix timestamp in seconds (not milliseconds, unlike Gmail).
- Accepts either a full Update payload ({"update_id": ..., "message": {...}})
  or a bare Message dict, since either could reasonably be what the Ingress
  Listener hands over.

Required fields (sender, message id, timestamp) are fail-fast: missing data
raises ValueError rather than being silently replaced with a misleading
default (e.g. an empty sender, or epoch 0 standing in for an unknown time) -
same policy as the Gmail adapter, so the two behave consistently.

Deliberately does not check whitelist/workspace/permissions - that's the
Ingress Listener / security layer's responsibility.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List

from ._validation import require
from .schemas import IngressAttachment, StandardizedIngressRequest

_SINGLE_OBJECT_MEDIA_FIELDS = ("document", "audio", "video")


def _extract_attachments(message: Dict[str, Any]) -> List[IngressAttachment]:
    attachments: List[IngressAttachment] = []

    for field in _SINGLE_OBJECT_MEDIA_FIELDS:
        media = message.get(field)
        if not media:
            continue
        file_id = media.get("file_id")
        if not file_id:
            # unusable reference, can't be retrieved later - deliberately
            # skipped rather than included as a broken attachment, same
            # policy as the Gmail adapter's missing-attachmentId case.
            continue
        attachments.append(IngressAttachment(
            attachment_id=file_id,
            filename=media.get("file_name"),
            mime_type=media.get("mime_type"),
            size_bytes=media.get("file_size"),
        ))

    # photo is an array of PhotoSize (same image at different resolutions) - keep the largest
    photos = message.get("photo")
    if photos:
        largest = max(photos, key=lambda p: p.get("file_size", 0))
        file_id = largest.get("file_id")
        if file_id:
            attachments.append(IngressAttachment(
                attachment_id=file_id,
                filename=None,
                mime_type="image/jpeg",
                size_bytes=largest.get("file_size"),
            ))

    return attachments


def normalize_telegram(raw: Dict[str, Any]) -> StandardizedIngressRequest:
    """Convert a Telegram Bot API Update or bare Message into StandardizedIngressRequest.

    Raises ValueError if sender, message id, or timestamp is missing - these
    are never fabricated.
    """
    message = raw.get("message", raw)

    message_id = require(message.get("message_id"), "Telegram message missing required 'message_id' field")

    sender = message.get("from") or {}
    sender_id_raw = sender.get("id")
    require(sender_id_raw, f"Telegram message {message_id} missing required 'from.id' field")
    sender_id = str(sender_id_raw)
    sender_name = sender.get("username") or sender.get("first_name")

    content = message.get("text") or message.get("caption") or ""

    raw_date = message.get("date")
    require(raw_date, f"Telegram message {message_id} missing required 'date' field")
    received_at = datetime.fromtimestamp(raw_date, tz=timezone.utc)

    return StandardizedIngressRequest(
        source="TELEGRAM",
        sender_id=sender_id,
        sender_name=sender_name,
        subject=None,
        content=content,
        attachments=_extract_attachments(message),
        received_at=received_at,
        source_message_id=str(message_id),
        metadata={"chat_id": message.get("chat", {}).get("id")},
    )
