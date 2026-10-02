"""
Task 3.2-3.3: Data Standardization & Normalization Layer

Transforms raw, heterogeneous data returned by a resource (DATABASE, REST_API,
EMAIL_SERVICE, JSON_FILE) into the unified StandardizedDataRecord format, using
the field mappings already defined in schemas.DataConversionConfig.

NOTE: Task 3.1 (analyze real data structures from connected resources) hasn't
happened yet, since Sprint 2.3's real DB/API connections don't exist. The field
mappings this relies on (schemas.DataConversionConfig) are provisional and
based on assumed shapes, not confirmed ones. Once Sprint 2.3 lands, re-check
those mappings against real responses.
"""

from datetime import datetime
from typing import Any, Dict, List
from uuid import UUID, uuid4

from .schemas import (
    DataConversionConfig,
    FieldTypeEnum,
    ResourceTypeEnum,
    StandardizedDataField,
    StandardizedDataRecord,
)

# Registry of named conversion functions referenced by TypeConversionRule.conversion_rule
_CONVERSION_FUNCTIONS = {
    "parse_iso8601()": lambda v: datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else v,
}


def _infer_field_type(value: Any) -> FieldTypeEnum:
    """Best-effort type inference for fields with no explicit conversion rule."""
    if isinstance(value, bool):
        return FieldTypeEnum.BOOLEAN
    if isinstance(value, (int, float)):
        return FieldTypeEnum.NUMBER
    if isinstance(value, datetime):
        return FieldTypeEnum.DATETIME
    if isinstance(value, (dict, list)):
        return FieldTypeEnum.JSON
    if isinstance(value, str):
        return FieldTypeEnum.STRING
    return FieldTypeEnum.UNKNOWN


def standardize_field(
    source_field: str,
    value: Any,
    resource_type: ResourceTypeEnum,
) -> StandardizedDataField:
    """Map a single raw field to its standardized form using DataConversionConfig rules."""
    rules = DataConversionConfig.get_conversion_rules(resource_type)
    rule = next((r for r in rules if r.source_field == source_field), None)

    if rule is None:
        return StandardizedDataField(
            field_name=source_field,
            field_value=value,
            original_field_name=None,
            field_type=_infer_field_type(value),
            transformed=False,
        )

    converted_value = value
    if rule.conversion_rule:
        convert = _CONVERSION_FUNCTIONS.get(rule.conversion_rule)
        if convert is not None:
            converted_value = convert(value)

    return StandardizedDataField(
        field_name=rule.target_field,
        field_value=converted_value,
        original_field_name=source_field,
        field_type=rule.target_type,
        transformed=True,
    )


def standardize_record(
    resource_id: UUID,
    resource_type: ResourceTypeEnum,
    raw_record: Dict[str, Any],
) -> StandardizedDataRecord:
    """Convert one raw record from a resource into a StandardizedDataRecord."""
    fields = [
        standardize_field(key, value, resource_type)
        for key, value in raw_record.items()
    ]

    return StandardizedDataRecord(
        record_id=uuid4(),
        resource_id=resource_id,
        resource_type=resource_type,
        fields=fields,
        original_data=raw_record,
        standardization_timestamp=datetime.utcnow(),
    )


def standardize_records(
    resource_id: UUID,
    resource_type: ResourceTypeEnum,
    raw_records: List[Dict[str, Any]],
) -> List[StandardizedDataRecord]:
    """Convert a list of raw records from a resource into StandardizedDataRecords."""
    return [standardize_record(resource_id, resource_type, r) for r in raw_records]
