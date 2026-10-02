"""
CASE — Data Standardization & Normalization Layer
Telegram adapter (Step 3)

Location: src/standardization/adapters/telegram.py

Input: one Telegram Bot API Update (JSON dict), e.g. from a webhook. A bare
Message dict (no Update envelope) is also accepted, since either could
reasonably be what the Ingress Listener hands over.
Output: StandardMessage (standardization 1 only; Telegram is not a data resource).

The input is told apart by shape, not by the presence of "update_id": a
"message" key means an Update envelope; "message_id" + "chat" at the top
level means a bare Message. Anything else - edited_message, channel_post,
or an unrecognised shape - is rejected, so one request = one new message.

Identity is the numeric Telegram user id (`from.id`), not the username: a
username is optional on Telegram and can change, but the numeric id is always
present and stable. sender.id is "tg:<id>"; the username, if any, is kept
separately in metadata["telegram_username"] for display/lookup. The
allowed-sender whitelist must therefore be keyed by numeric id - when an admin
adds someone by username, ingress resolves and stores their id the first time
that user messages the bot.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import ValidationError

from ..schemas import AttachmentMeta, MessageSource, Sender, StandardMessage, VerificationMethod
from ..utils import normalize_short_text, normalize_telegram_username, normalize_text, parse_date, sha256_hex
from .base import StandardizationError


def _attachments(m: dict[str, Any]) -> list[AttachmentMeta]:
    """document/audio/video are single objects; photo is an array of sizes of
    the same image - only the largest is kept. An attachment always gets an
    entry even without a file_id (attachment_id=None): it's still listed,
    just not fetchable later."""
    atts: list[AttachmentMeta] = []
    if doc := m.get("document"):
        atts.append(AttachmentMeta(attachment_id=doc.get("file_id"), filename=(doc.get("file_name") or "document")[:255],
                                   mime_type=doc.get("mime_type") or "application/octet-stream",
                                   size_bytes=int(doc.get("file_size") or 0)))
    if audio := m.get("audio"):
        atts.append(AttachmentMeta(attachment_id=audio.get("file_id"),
                                   filename=(audio.get("file_name") or audio.get("title") or "audio")[:255],
                                   mime_type=audio.get("mime_type") or "audio/mpeg",
                                   size_bytes=int(audio.get("file_size") or 0)))
    if video := m.get("video"):
        atts.append(AttachmentMeta(attachment_id=video.get("file_id"), filename=(video.get("file_name") or "video")[:255],
                                   mime_type=video.get("mime_type") or "video/mp4",
                                   size_bytes=int(video.get("file_size") or 0)))
    if photos := m.get("photo"):
        biggest = max(photos, key=lambda ph: ph.get("file_size") or 0)
        atts.append(AttachmentMeta(attachment_id=biggest.get("file_id"), filename="photo.jpg", mime_type="image/jpeg",
                                   size_bytes=int(biggest.get("file_size") or 0)))
    return atts


def to_message(update: dict[str, Any], *, workspace_id: str, verified: bool,
               metadata: Optional[dict[str, Any]] = None) -> StandardMessage:
    """Telegram Update (or bare Message) -> StandardMessage. `verified` comes from the ingress allowed-sender check."""
    if not isinstance(update, dict):
        raise StandardizationError("Telegram payload must be an object", source="TELEGRAM")
    if "message" in update:
        m = update["message"]
    elif "message_id" in update and "chat" in update:
        m = update  # bare Message object, no Update envelope
    else:
        kinds = [k for k in update if k != "update_id"]
        raise StandardizationError(f"unsupported Telegram update type: {kinds or 'unknown'}",
                                   code="UNSUPPORTED_INPUT", source="TELEGRAM")
    try:
        sender = m.get("from") or {}
        from_id = sender.get("id")
        if not from_id:
            raise StandardizationError("Telegram message has no sender id", source="TELEGRAM")
        name = " ".join(x for x in (sender.get("first_name"), sender.get("last_name")) if x)
        meta = dict(metadata or {})
        if username := sender.get("username"):
            meta["telegram_username"] = normalize_telegram_username(username)
        body, truncated = normalize_text(m.get("text") or m.get("caption") or "")
        return StandardMessage(
            workspace_id=workspace_id, source=MessageSource.TELEGRAM,
            source_message_id=f"{m['chat']['id']}:{m['message_id']}",
            sender=Sender(id=f"tg:{from_id}", display_name=normalize_short_text(name, 200), verified=verified,
                          verification_method=VerificationMethod.WHITELIST),
            received_at=parse_date(m["date"]), subject=None, body_text=body, body_truncated=truncated,
            attachments=_attachments(m), metadata=meta, raw_hash=sha256_hex(update),
        )
    except StandardizationError:
        raise
    except (KeyError, TypeError, ValueError, ValidationError) as exc:
        msg = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
        raise StandardizationError(f"could not standardize Telegram message: {msg}", source="TELEGRAM") from exc
