"""
CASE — Audit & Transparency Layer
Canonical serialization and event hashing (AUDIT_MODULE_PLAN.md §5.2)

Location: src/audit/canonical.py

The one place that decides which bytes are hashed. Standard library only and
no imports from the rest of the package, so an exported chain can be
re-verified offline with this file alone (§8.6).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

HASH_VERSION = 1

# Order matters: this is the hashed list after HASH_VERSION. `event_id` is not
# hashed (random); `seq` is (detects reordering and gaps). Any UI that shows
# the formula must take the field list from this constant.
HASH_FIELDS: tuple[str, ...] = (
    "seq", "workspace_id", "event_timestamp", "execution_id", "event_type", "action",
    "actor_type", "actor_id", "actor_role", "target_type", "target_id", "source",
    "outcome", "details", "previous_hash",
)

GENESIS_HASH = "0" * 64
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"


class CanonicalizationError(ValueError):
    """A value cannot be hashed deterministically. The message names the
    path, never the value, so a rejected secret does not end up in a log."""

    def __init__(self, path: str, problem: str) -> None:
        super().__init__(f"{path}: {problem}")
        self.path = path


def format_timestamp(value: datetime) -> str:
    """Aware datetime -> 'YYYY-MM-DDTHH:MM:SS.ffffffZ' in UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(timezone.utc).strftime(TIMESTAMP_FORMAT)


def _check_text(value: str, path: str) -> str:
    if "\x00" in value:
        raise CanonicalizationError(path, "contains \\u0000 (cannot be stored in Postgres jsonb)")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise CanonicalizationError(path, "is not valid UTF-8 (lone surrogate)") from None
    return value


def normalize(value: Any, path: str = "$") -> Any:
    """Convert a value to plain JSON types following the §5.2 rules.

    Floats are rejected anywhere (non-deterministic); Decimal becomes a string,
    UUID a lowercase string, datetime the UTC timestamp format. Naive datetimes
    and any type without a fixed rule are rejected rather than guessed.
    """
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, Enum):
        return normalize(value.value, path)
    if isinstance(value, int):
        return int(value)
    if isinstance(value, float):
        raise CanonicalizationError(path, "floats are not allowed (pass numbers as int or Decimal string)")
    if isinstance(value, str):
        return _check_text(str(value), path)
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise CanonicalizationError(path, "Decimal must be finite")
        return str(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise CanonicalizationError(path, "datetime must be timezone-aware")
        return format_timestamp(value)
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, item in value.items():
            if isinstance(key, Enum):
                key = key.value
            if not isinstance(key, str):
                raise CanonicalizationError(path, f"keys must be strings, got {type(key).__name__}")
            key = _check_text(str(key), f"{path}.<key>")
            out[key] = normalize(item, f"{path}.{key}")
        return out
    if isinstance(value, (list, tuple)):
        return [normalize(item, f"{path}[{i}]") for i, item in enumerate(value)]
    raise CanonicalizationError(path, f"unsupported type {type(value).__name__}")


def canonical_json(value: Any) -> str:
    """Stable JSON text: sorted keys, no spaces, UTF-8 characters kept as-is."""
    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def compute_event_hash(event: Any) -> str:
    """SHA-256 over canonical_json([HASH_VERSION, *HASH_FIELDS values]).

    `event` is an AuditEvent or a plain mapping with the same keys (e.g. one
    record of a JSON export), so verification works without the models.
    """
    get = event.__getitem__ if isinstance(event, Mapping) else (lambda name: getattr(event, name))
    return sha256_hex(canonical_json([HASH_VERSION, *(get(name) for name in HASH_FIELDS)]))


__all__ = [
    "HASH_VERSION", "HASH_FIELDS", "GENESIS_HASH", "TIMESTAMP_FORMAT",
    "CanonicalizationError", "format_timestamp", "normalize", "canonical_json", "sha256_hex",
    "compute_event_hash",
]
