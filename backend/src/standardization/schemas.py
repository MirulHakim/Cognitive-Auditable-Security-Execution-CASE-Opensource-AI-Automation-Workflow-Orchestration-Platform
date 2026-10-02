"""
CASE — Data Standardization & Normalization Layer
Schemas (Step 1 of the module lifecycle)

Suggested location in the repo: src/standardization/schemas.py

Two output formats:
  - StandardMessage   : one incoming request (Gmail / Telegram / web form),
                        passed to AI intent classification.
  - StandardRecordSet : data fetched by the Secure API after Plan review,
                        passed to AI document generation.

Rules:
  - Schemas are strict: they VALIDATE, they do not guess. Converting raw
    values (dates, amounts, HTML) is done by the adapters + utils (Step 2-3).
  - All datetimes are timezone-aware and stored in UTC.
  - Amounts use Decimal, never float.
  - Domain-specific fields (e.g. dorm student_id, room_no) go in `metadata`,
    so the core schema stays domain-agnostic.
  - raw_hash links the standardized output to the original payload for audit.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any, Literal, Optional
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# ---------------------------------------------------------------------------
# Limits (sized for the small local model, qwen3.5:9b)
# ---------------------------------------------------------------------------
SCHEMA_VERSION = "1.0"
MAX_BODY_CHARS = 10_000
MAX_RECORDS = 500
MAX_METADATA_KEYS = 50

SHA256_PATTERN = r"^[a-f0-9]{64}$"
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------
def _to_utc(value: datetime) -> datetime:
    """Reject naive datetimes; convert aware datetimes to UTC."""
    if value.tzinfo is None or value.tzinfo.utcoffset(value) is None:
        raise ValueError("datetime must be timezone-aware (adapters must attach a timezone)")
    return value.astimezone(timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


class _StrictModel(BaseModel):
    """Base for all standardized models: no unknown fields, immutable, trimmed strings."""

    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)

    def canonical_json(self) -> str:
        """Stable JSON string (sorted keys, no spaces). Use this when hashing for the audit."""
        return json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _check_metadata(value: dict[str, Any]) -> dict[str, Any]:
    if len(value) > MAX_METADATA_KEYS:
        raise ValueError(f"metadata can have at most {MAX_METADATA_KEYS} keys")
    try:
        json.dumps(value, default=str)
    except (TypeError, ValueError) as exc:
        raise ValueError("metadata must be JSON-serializable") from exc
    return value


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------
class MessageSource(str, Enum):
    GMAIL = "GMAIL"
    TELEGRAM = "TELEGRAM"
    WEB_FORM = "WEB_FORM"


class VerificationMethod(str, Enum):
    WHITELIST_DKIM_SPF = "WHITELIST_DKIM_SPF"  # Gmail: allowed sender + DKIM/SPF pass
    WHITELIST = "WHITELIST"                    # Telegram: allowed sender
    JWT = "JWT"                                # Web form: signed-in user


class ResourceType(str, Enum):
    REST_API = "REST_API"
    EMAIL_SERVICE = "EMAIL_SERVICE"
    JSON_FILE = "JSON_FILE"


class FieldType(str, Enum):
    STRING = "STRING"
    NUMBER = "NUMBER"      # Decimal or int, never float
    BOOLEAN = "BOOLEAN"
    DATETIME = "DATETIME"  # timezone-aware, UTC
    JSON = "JSON"          # nested dict or list


# ---------------------------------------------------------------------------
# 1. StandardMessage — incoming request
# ---------------------------------------------------------------------------
class Sender(_StrictModel):
    id: str = Field(min_length=1, max_length=320, description="Lowercased email, @username, or signed-in user's email")
    display_name: Optional[str] = Field(default=None, max_length=200)
    verified: bool
    verification_method: VerificationMethod

    @field_validator("id")
    @classmethod
    def _normalize_id(cls, v: str) -> str:
        return v.strip().lower()


class AttachmentMeta(_StrictModel):
    """Metadata only. Attachment content is not read in the MVP.

    attachment_id is kept so a later step can fetch the actual content via the
    channel's API (Gmail attachmentId, Telegram file_id, ...), when the channel
    provides one. When it doesn't, attachment_id is None - the attachment is
    still listed (filename/mime_type/size_bytes) rather than dropped, so the
    AI, the approver, and the audit trail all know it exists even though it
    can't be fetched later."""

    attachment_id: Optional[str] = Field(default=None, min_length=1, max_length=255)
    filename: str = Field(min_length=1, max_length=255)
    mime_type: str = Field(min_length=1, max_length=127)
    size_bytes: int = Field(ge=0)


class StandardMessage(_StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    message_id: UUID = Field(default_factory=uuid4)
    workspace_id: str = Field(min_length=1)
    source: MessageSource
    source_message_id: str = Field(min_length=1, max_length=255)
    sender: Sender
    received_at: datetime
    subject: Optional[str] = Field(default=None, max_length=500)
    body_text: str = Field(max_length=MAX_BODY_CHARS)
    body_truncated: bool = False
    attachments: list[AttachmentMeta] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw_hash: str = Field(pattern=SHA256_PATTERN, description="SHA-256 of the original raw payload")
    standardized_at: datetime = Field(default_factory=_utc_now)

    @field_validator("received_at", "standardized_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return _to_utc(v)

    @field_validator("body_text")
    @classmethod
    def _clean_body(cls, v: str) -> str:
        # Keep line breaks (they carry meaning); remove control characters.
        if _CONTROL_CHARS.search(v):
            raise ValueError("body_text contains control characters (clean it in the adapter)")
        return v

    @field_validator("metadata")
    @classmethod
    def _meta(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _check_metadata(v)

    @model_validator(mode="after")
    def _source_rules(self) -> "StandardMessage":
        expected = {
            MessageSource.GMAIL: VerificationMethod.WHITELIST_DKIM_SPF,
            MessageSource.TELEGRAM: VerificationMethod.WHITELIST,
            MessageSource.WEB_FORM: VerificationMethod.JWT,
        }[self.source]
        if self.sender.verification_method != expected:
            raise ValueError(f"{self.source.value} messages must use verification_method {expected.value}")
        if not self.sender.verified:
            raise ValueError("only verified senders can be standardized (unverified messages are rejected at ingress)")
        if self.source != MessageSource.GMAIL and self.subject is not None:
            raise ValueError("only GMAIL messages have a subject")
        if not self.body_text and not self.attachments:
            raise ValueError("message has no text and no attachments")
        return self


# ---------------------------------------------------------------------------
# 2. StandardRecord / StandardRecordSet — resource data after Plan review
# ---------------------------------------------------------------------------
class StandardRecord(_StrictModel):
    record_id: str = Field(min_length=1, max_length=255)
    record_type: str = Field(min_length=1, max_length=64, description="e.g. order, policy_rule, email")
    occurred_at: Optional[datetime] = None
    data: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("occurred_at")
    @classmethod
    def _utc(cls, v: Optional[datetime]) -> Optional[datetime]:
        return _to_utc(v) if v is not None else None

    @field_validator("metadata")
    @classmethod
    def _meta(cls, v: dict[str, Any]) -> dict[str, Any]:
        return _check_metadata(v)


def _value_matches(value: Any, ftype: FieldType) -> bool:
    if value is None:
        return True  # unparseable values are set to null and reported in warnings
    if ftype is FieldType.STRING:
        return isinstance(value, str)
    if ftype is FieldType.NUMBER:
        return isinstance(value, (Decimal, int)) and not isinstance(value, bool)
    if ftype is FieldType.BOOLEAN:
        return isinstance(value, bool)
    if ftype is FieldType.DATETIME:
        return isinstance(value, datetime) and value.tzinfo is not None
    if ftype is FieldType.JSON:
        return isinstance(value, (dict, list))
    return False


class StandardRecordSet(_StrictModel):
    schema_version: Literal["1.0"] = SCHEMA_VERSION
    record_set_id: UUID = Field(default_factory=uuid4)
    workspace_id: str = Field(min_length=1)
    execution_id: str = Field(min_length=1, description="Same ID the audit uses to group a request's records")
    resource_id: str = Field(min_length=1)
    resource_name: str = Field(min_length=1, max_length=255)
    resource_type: ResourceType
    fetched_at: datetime
    field_types: dict[str, FieldType]
    records: list[StandardRecord] = Field(default_factory=list, max_length=MAX_RECORDS)
    record_count: int = Field(ge=0)
    truncated: bool = False
    raw_hash: str = Field(pattern=SHA256_PATTERN, description="SHA-256 of the original raw response")
    warnings: list[str] = Field(default_factory=list)

    @field_validator("fetched_at")
    @classmethod
    def _utc(cls, v: datetime) -> datetime:
        return _to_utc(v)

    @model_validator(mode="after")
    def _consistency(self) -> "StandardRecordSet":
        if self.record_count != len(self.records):
            raise ValueError(f"record_count ({self.record_count}) does not match number of records ({len(self.records)})")
        for rec in self.records:
            unknown = set(rec.data) - set(self.field_types)
            if unknown:
                raise ValueError(f"record {rec.record_id}: fields not declared in field_types: {sorted(unknown)}")
            for name, value in rec.data.items():
                ftype = self.field_types[name]
                if not _value_matches(value, ftype):
                    raise ValueError(f"record {rec.record_id}: field '{name}' should be {ftype.value}, got {type(value).__name__}")
        return self


__all__ = [
    "SCHEMA_VERSION", "MAX_BODY_CHARS", "MAX_RECORDS",
    "MessageSource", "VerificationMethod", "ResourceType", "FieldType",
    "Sender", "AttachmentMeta", "StandardMessage",
    "StandardRecord", "StandardRecordSet",
]
