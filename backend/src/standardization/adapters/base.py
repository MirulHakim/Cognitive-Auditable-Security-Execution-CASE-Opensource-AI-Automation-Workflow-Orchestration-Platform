"""
CASE — Data Standardization & Normalization Layer
Adapters: shared pieces (Step 3)

Location: src/standardization/adapters/base.py

- StandardizationError : the one error type every adapter raises
- ResourceInfo         : which resource the data came from
- FieldMapping         : per-resource config (stored in resources.schema_definition)
- get_path             : read 'data.items.0.name' style paths from nested JSON
- map_records          : turn a list of raw items into StandardRecords using a FieldMapping
- build_record_set     : wrap records into a validated StandardRecordSet
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..schemas import MAX_RECORDS, FieldType, ResourceType, StandardRecord, StandardRecordSet
from ..utils import coerce_or_warn, parse_date, sha256_hex


class StandardizationError(ValueError):
    """Raised when raw data cannot be standardized. `code` goes into the audit event."""

    def __init__(self, message: str, code: str = "STANDARDIZATION_FAILED", source: str = "") -> None:
        super().__init__(message)
        self.code = code
        self.source = source


class ResourceInfo(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    resource_id: str = Field(min_length=1)
    resource_name: str = Field(min_length=1)
    resource_type: ResourceType


class FieldSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    path: str = Field(min_length=1, description="Dotted path inside one raw item, e.g. 'customer.name'")
    type: FieldType
    format: Optional[Literal["money"]] = Field(default=None, description="'money' rounds NUMBER to 2 decimal places")


class FieldMapping(BaseModel):
    """
    Stored as JSON in resources.schema_definition. Example:
    {
      "records_path": "data.orders",
      "record_type": "order",
      "id_field": "order_id",
      "occurred_at_field": "created_at",
      "fields": {
        "client":     {"path": "customer.name", "type": "STRING"},
        "amount_myr": {"path": "total", "type": "NUMBER", "format": "money"},
        "status":     {"path": "status", "type": "STRING"}
      },
      "metadata_fields": {"room_no": "room.number"}
    }
    """

    model_config = ConfigDict(extra="forbid", frozen=True)
    records_path: str = Field(default="", description="Where the list of items is. Empty = the root is the list")
    record_type: str = Field(min_length=1, max_length=64)
    id_field: Optional[str] = None
    occurred_at_field: Optional[str] = None
    fields: dict[str, FieldSpec] = Field(min_length=1)
    metadata_fields: dict[str, str] = Field(default_factory=dict, description="Domain-specific values (e.g. dorm room_no)")


_MISSING = object()


def get_path(obj: Any, path: str, default: Any = None) -> Any:
    """Read a dotted path. Digits index into lists: 'items.0.name'. Missing parts return default."""
    if not path:
        return obj
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part, _MISSING)
        elif isinstance(cur, list) and part.isdigit():
            idx = int(part)
            cur = cur[idx] if idx < len(cur) else _MISSING
        else:
            cur = _MISSING
        if cur is _MISSING:
            return default
    return cur


def map_records(items: list[Any], mapping: FieldMapping, warnings: list[str]) -> list[StandardRecord]:
    """Apply a FieldMapping to raw items. Bad values become null + a warning; non-object items are skipped."""
    records: list[StandardRecord] = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            warnings.append(f"item {i + 1} skipped (not an object)")
            continue
        raw_id = get_path(item, mapping.id_field) if mapping.id_field else None
        record_id = str(raw_id).strip() if raw_id not in (None, "") else f"{mapping.record_type}-{i + 1}"
        if mapping.id_field and raw_id in (None, ""):
            warnings.append(f"item {i + 1}: no '{mapping.id_field}', generated id {record_id}")

        data: dict[str, Any] = {}
        for name, spec in mapping.fields.items():
            value = coerce_or_warn(name, get_path(item, spec.path), spec.type, warnings, record_id)
            if spec.format == "money" and isinstance(value, (Decimal, int)):
                value = Decimal(value).quantize(Decimal("0.01"))
            data[name] = value

        occurred_at = None
        if mapping.occurred_at_field:
            raw_dt = get_path(item, mapping.occurred_at_field)
            if raw_dt not in (None, ""):
                try:
                    occurred_at = parse_date(raw_dt)
                except ValueError as exc:
                    warnings.append(f"record {record_id}: occurred_at set to null ({exc})")

        metadata = {k: get_path(item, p) for k, p in mapping.metadata_fields.items() if get_path(item, p) is not None}
        records.append(StandardRecord(record_id=record_id[:255], record_type=mapping.record_type,
                                      occurred_at=occurred_at, data=data, metadata=metadata))
    return records


def cap_records(records: list[StandardRecord], warnings: list[str]) -> tuple[list[StandardRecord], bool]:
    if len(records) <= MAX_RECORDS:
        return records, False
    warnings.append(f"{len(records)} records received; only the first {MAX_RECORDS} were kept")
    return records[:MAX_RECORDS], True


def build_record_set(*, records: list[StandardRecord], field_types: dict[str, FieldType], resource: ResourceInfo,
                     workspace_id: str, execution_id: str, raw: Any, warnings: list[str],
                     fetched_at: Optional[datetime] = None, already_truncated: bool = False) -> StandardRecordSet:
    records, truncated = cap_records(records, warnings)
    try:
        return StandardRecordSet(
            workspace_id=workspace_id, execution_id=execution_id,
            resource_id=resource.resource_id, resource_name=resource.resource_name, resource_type=resource.resource_type,
            fetched_at=fetched_at or datetime.now(timezone.utc),
            field_types=field_types, records=records, record_count=len(records),
            truncated=truncated or already_truncated,
            raw_hash=sha256_hex(raw if isinstance(raw, (bytes, str, dict, list)) else str(raw)),
            warnings=warnings,
        )
    except ValidationError as exc:
        raise StandardizationError(f"record set failed validation: {exc.errors()[0]['msg']}",
                                   source=resource.resource_type.value) from exc
