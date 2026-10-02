from decimal import Decimal

import pytest

from src.standardization.adapters.base import (
    FieldMapping,
    ResourceInfo,
    StandardizationError,
    build_record_set,
    get_path,
    map_records,
)
from src.standardization.schemas import FieldType, ResourceType, StandardRecord


class TestGetPath:
    def test_empty_path_returns_object_itself(self):
        obj = {"a": 1}
        assert get_path(obj, "") is obj

    def test_digit_segment_indexes_into_list(self):
        obj = {"items": [{"name": "first"}, {"name": "second"}]}
        assert get_path(obj, "items.1.name") == "second"

    def test_out_of_range_index_returns_default(self):
        obj = {"items": [{"name": "first"}]}
        assert get_path(obj, "items.5.name", default="missing") == "missing"


class TestMapRecords:
    def test_non_dict_items_are_skipped_with_warning(self):
        mapping = FieldMapping(record_type="order", fields={"client": {"path": "name", "type": "STRING"}})
        warnings: list[str] = []
        records = map_records([{"name": "Alice"}, "not-an-object", {"name": "Bob"}], mapping, warnings)
        assert len(records) == 2
        assert any("skipped (not an object)" in w for w in warnings)

    def test_unparseable_occurred_at_becomes_null_with_warning(self):
        mapping = FieldMapping(record_type="order", occurred_at_field="created_at",
                               fields={"client": {"path": "name", "type": "STRING"}})
        warnings: list[str] = []
        records = map_records([{"name": "Alice", "created_at": "not-a-date"}], mapping, warnings)
        assert records[0].occurred_at is None
        assert any("occurred_at set to null" in w for w in warnings)


class TestBuildRecordSet:
    RESOURCE = ResourceInfo(resource_id="r1", resource_name="Orders", resource_type=ResourceType.REST_API)

    def test_invalid_record_set_is_wrapped_as_standardization_error(self):
        # a record whose data references a field never declared in field_types
        # fails StandardRecordSet's own consistency check.
        record = StandardRecord(record_id="1", record_type="order", data={"unexpected": Decimal("1")})
        with pytest.raises(StandardizationError):
            build_record_set(records=[record], field_types={"client": FieldType.STRING}, resource=self.RESOURCE,
                             workspace_id="ws1", execution_id="exec1", raw={}, warnings=[])
