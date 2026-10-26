"""
CASE — Audit & Transparency Layer
Canonical serialization and event hashing (AUDIT_MODULE_PLAN.md §5.2)

Location: src/audit/canonical.py

This file funtion: 
To provide canonical serialization and event hashing for the audit and transparency layer of the CASE system. 
It defines functions to normalize data, compute hashes, and ensure that events are stored in a consistent and verifiable manner.
Then, it provides a mechanism to compute a SHA-256 hash over the canonical JSON representation of an event, ensuring that the event data can be verified for integrity and authenticity.
Ringkasnya: Dia tukar satu event jadi teks yang sentiasa sama untuk data yang sama, dan hashkan teks itu. Jadi bila orang lain hash event yang sama, dia dapat hash yang sama.
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

#extendable for later kalau hash_field ada version baru
HASH_VERSION = 1

# Order matters: this is the hashed list after HASH_VERSION. `event_id` is not hashed (random);
# `seq` is (detects reordering and gaps). Any UI that shows the formula must take the field list from this constant.
#HASH_FIELDS ni adalah senarai field yang akan di hash. will be used in compute_event_hash function. 
HASH_FIELDS: tuple[str, ...] = (
    "seq", 
    "workspace_id", 
    "event_timestamp", 
    "execution_id", 
    "event_type", 
    "action",
    "actor_type", "actor_id", "actor_role", 
    "target_type", "target_id", "source",
    "outcome", "details", "previous_hash",
)
#event id takde sebab dia random, so tak boleh dijadikan hash. Seq kena ada sebab nak detect reordering and gaps. Any UI that shows the formula must take the field list from this constant.
#current_hash takde seabab dia adalah hasil hash, bukan input. 
GENESIS_HASH = "0" * 64
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%S.%fZ"

#macam float atau Decimal yang tak finite (inf, -inf, nan) tak boleh di hash.
# kita raise error and bagi message je
class CanonicalizationError(ValueError):
    """A value cannot be hashed consistently. The message names the
    path, never the value, so a rejected secret does not end up in a log."""

    def __init__(self, path: str, problem: str) -> None:
        super().__init__(f"{path}: {problem}")
        self.path = path


def format_timestamp(value: datetime) -> str:
    """Aware datetime -> 'YYYY-MM-DDTHH:MM:SS.ffffffZ' in UTC."""
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(timezone.utc).strftime(TIMESTAMP_FORMAT)

#make sure string tu does not contain null bytes and is valid UTF-8. 
# If not, raise CanonicalizationError with the path and problem description.
#\x00 ni adalah null byte, which is not allowed in Postgres jsonb.
def _check_text(value: str, path: str) -> str:
    if "\x00" in value:
        raise CanonicalizationError(path, "contains \\u0000 (cannot be stored in Postgres jsonb)")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise CanonicalizationError(path, "is not valid UTF-8 (lone surrogate)") from None
    return value

#untuk check value type and convert to plain JSON types. 
#Floats are rejected, Decimal becomes a string, UUID a lowercase string, datetime the UTC timestamp format. Naive datetimes and any type without a fixed rule are rejected rather than guessed.
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

# Converts normalized data into a consistent JSON string for hashing.
# Sorts keys, removes unnecessary spaces, and preserves Unicode characters.
# Ensures the same data always produces the same JSON representation.
def canonical_json(value: Any) -> str:
    """Stable JSON text: sorted keys, no spaces, UTF-8 characters kept as-is."""
    return json.dumps(normalize(value), sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

#accept event to do hashing
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
