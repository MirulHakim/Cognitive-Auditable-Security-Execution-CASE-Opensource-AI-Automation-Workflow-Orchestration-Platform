"""
CASE — Data Standardization & Normalization Layer
JSON file adapter (Step 3)

Location: src/standardization/adapters/json_file.py

Input: the content of a JSON_FILE resource (bytes, text, or already-parsed JSON).
Output: StandardRecordSet.

- With a FieldMapping: same behaviour as the REST API adapter.
- Without one: field types are inferred from the values.
    * a list of objects   -> one record per object
    * a single object     -> one record (e.g. a policy document)
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional

from pydantic import ValidationError

from ..schemas import FieldType, ResourceType, StandardRecord, StandardRecordSet
from ..utils import coerce_or_warn, infer_field_type
from .base import FieldMapping, ResourceInfo, StandardizationError, build_record_set, get_path, map_records

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


def _load(content: Any) -> Any:
    if isinstance(content, (bytes, bytearray)):
        if len(content) > MAX_FILE_BYTES:
            raise StandardizationError(f"JSON file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB", source="JSON_FILE")
        content = content.decode("utf-8-sig", errors="strict")
    if isinstance(content, str):
        try:
            return json.loads(content)
        except json.JSONDecodeError as exc:
            raise StandardizationError(f"invalid JSON at line {exc.lineno}: {exc.msg}", source="JSON_FILE") from exc
    return content


def to_record_set(content: Any, *, resource: ResourceInfo, workspace_id: str, execution_id: str,
                  mapping: FieldMapping | dict | None = None, record_type: str = "document",
                  fetched_at: Optional[datetime] = None) -> StandardRecordSet:
    if resource.resource_type is not ResourceType.JSON_FILE:
        raise StandardizationError(f"json_file adapter got a {resource.resource_type.value} resource", source="JSON_FILE")
    try:
        data = _load(content)
    except UnicodeDecodeError as exc:
        raise StandardizationError("JSON file is not valid UTF-8", source="JSON_FILE") from exc
    warnings: list[str] = []

    if mapping is not None:
        try:
            mapping = mapping if isinstance(mapping, FieldMapping) else FieldMapping.model_validate(mapping)
        except ValidationError as exc:
            raise StandardizationError(f"invalid field mapping: {exc.errors()[0]['msg']}", code="MAPPING_INVALID",
                                       source="JSON_FILE") from exc
        items = get_path(data, mapping.records_path) if mapping.records_path else data
        items = [items] if isinstance(items, dict) else items
        if not isinstance(items, list):
            raise StandardizationError(f"no list found at '{mapping.records_path or '(root)'}'", source="JSON_FILE")
        records = map_records(items, mapping, warnings)
        field_types = {n: s.type for n, s in mapping.fields.items()}
    else:
        items = [data] if isinstance(data, dict) else data
        if not isinstance(items, list) or not all(isinstance(x, dict) for x in items):
            raise StandardizationError("JSON file must be an object or a list of objects", source="JSON_FILE")
        keys: list[str] = []
        for it in items:
            keys += [k for k in it if k not in keys]
        field_types = {k: infer_field_type(it.get(k) for it in items) for k in keys}
        records = []
        for i, it in enumerate(items):
            id_key = next((k for k in ("id", f"{record_type}_id") if it.get(k) not in (None, "")), None) \
                or next((k for k in it if k.endswith("_id") and isinstance(it[k], (str, int)) and it[k] != ""), None)
            rid = str(it[id_key]) if id_key else f"{record_type}-{i + 1}"
            values = {k: coerce_or_warn(k, it.get(k), field_types[k], warnings, rid) for k in keys}
            records.append(StandardRecord(record_id=rid[:255], record_type=record_type, data=values))

    return build_record_set(records=records, field_types=field_types, resource=resource, workspace_id=workspace_id,
                            execution_id=execution_id, raw=content if isinstance(content, (bytes, str)) else data,
                            warnings=warnings, fetched_at=fetched_at)
