"""
CASE — Data Standardization & Normalization Layer
REST API adapter (Step 3)

Location: src/standardization/adapters/rest_api.py

Input: the parsed JSON body the Secure API received from a REST_API resource,
plus that resource's FieldMapping (from resources.schema_definition).
Output: StandardRecordSet.

Every API names its fields differently, so nothing is hardcoded here:
the mapping says where the list is and which field is which.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import ValidationError

from ..schemas import ResourceType, StandardRecordSet
from .base import FieldMapping, ResourceInfo, StandardizationError, build_record_set, get_path, map_records


def to_record_set(response: Any, *, resource: ResourceInfo, mapping: FieldMapping | dict, workspace_id: str,
                  execution_id: str, fetched_at: Optional[datetime] = None) -> StandardRecordSet:
    if resource.resource_type is not ResourceType.REST_API:
        raise StandardizationError(f"rest_api adapter got a {resource.resource_type.value} resource", source="REST_API")
    try:
        mapping = mapping if isinstance(mapping, FieldMapping) else FieldMapping.model_validate(mapping)
    except ValidationError as exc:
        raise StandardizationError(f"invalid field mapping for {resource.resource_name}: {exc.errors()[0]['msg']}",
                                   code="MAPPING_INVALID", source="REST_API") from exc

    items = get_path(response, mapping.records_path) if mapping.records_path else response
    if isinstance(items, dict):
        items = [items]  # a single object response becomes one record
    if not isinstance(items, list):
        raise StandardizationError(f"no list found at '{mapping.records_path or '(root)'}' in the API response",
                                   source="REST_API")

    warnings: list[str] = []
    records = map_records(items, mapping, warnings)
    field_types = {name: spec.type for name, spec in mapping.fields.items()}
    return build_record_set(records=records, field_types=field_types, resource=resource, workspace_id=workspace_id,
                            execution_id=execution_id, raw=response, warnings=warnings, fetched_at=fetched_at)
