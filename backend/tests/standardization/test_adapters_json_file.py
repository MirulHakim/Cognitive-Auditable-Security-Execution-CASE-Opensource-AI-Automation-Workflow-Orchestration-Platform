import json as json_module

import pytest

from src.standardization.adapters import json_file
from src.standardization.adapters.base import ResourceInfo, StandardizationError
from src.standardization.adapters.json_file import MAX_FILE_BYTES
from src.standardization.schemas import FieldType, ResourceType
from tests.standardization.fixtures import json_file_payloads as fx
from tests.standardization.fixtures import rest_api_payloads as rest_fx

RESOURCE = ResourceInfo(resource_id="r1", resource_name="Policies", resource_type=ResourceType.JSON_FILE)


class TestJsonFileToRecordSet:
    def test_policy_object_becomes_one_record_with_inferred_types(self):
        rs = json_file.to_record_set(fx.POLICY_DOCUMENT_BYTES, resource=RESOURCE, workspace_id="ws1",
                                     execution_id="exec1", record_type="policy_rule")
        assert rs.record_count == 1
        record = rs.records[0]
        assert record.record_id == "POL-001"
        assert rs.field_types["effective_date"] == FieldType.DATETIME
        assert rs.field_types["max_fee"] == FieldType.NUMBER
        assert rs.field_types["tags"] == FieldType.JSON
        assert rs.field_types["title"] == FieldType.STRING

    def test_invalid_json_raises(self):
        with pytest.raises(StandardizationError):
            json_file.to_record_set(fx.INVALID_JSON_TEXT, resource=RESOURCE, workspace_id="ws1", execution_id="exec1")

    def test_list_of_non_objects_raises(self):
        with pytest.raises(StandardizationError):
            json_file.to_record_set(fx.LIST_OF_NON_OBJECTS, resource=RESOURCE, workspace_id="ws1", execution_id="exec1")

    def test_wrong_resource_type_raises(self):
        rest_resource = ResourceInfo(resource_id="r2", resource_name="API", resource_type=ResourceType.REST_API)
        with pytest.raises(StandardizationError):
            json_file.to_record_set(fx.POLICY_DOCUMENT_BYTES, resource=rest_resource, workspace_id="ws1", execution_id="exec1")

    def test_list_of_items_each_become_a_record_with_inferred_types(self):
        rs = json_file.to_record_set(fx.LIST_OF_ITEMS, resource=RESOURCE, workspace_id="ws1", execution_id="exec1")
        assert rs.record_count == 2
        assert rs.field_types["in_stock"] == FieldType.BOOLEAN
        assert rs.field_types["item_id"] == FieldType.NUMBER


class TestJsonFileWithMapping:
    def test_mapping_applied_same_as_rest_api(self):
        content = json_module.dumps(rest_fx.ORDERS_RESPONSE)
        rs = json_file.to_record_set(content, resource=RESOURCE, workspace_id="ws1", execution_id="exec1",
                                     mapping=rest_fx.ORDERS_MAPPING)
        assert rs.record_count == 1
        assert rs.records[0].data["client"] == "Alice Tan"

    def test_invalid_mapping_raises_mapping_invalid(self):
        content = json_module.dumps(rest_fx.ORDERS_RESPONSE)
        with pytest.raises(StandardizationError) as exc_info:
            json_file.to_record_set(content, resource=RESOURCE, workspace_id="ws1", execution_id="exec1",
                                    mapping=rest_fx.INVALID_MAPPING)
        assert exc_info.value.code == "MAPPING_INVALID"

    def test_no_list_at_mapping_path_raises(self):
        content = json_module.dumps({"data": {"orders": "not-a-list"}})
        with pytest.raises(StandardizationError):
            json_file.to_record_set(content, resource=RESOURCE, workspace_id="ws1", execution_id="exec1",
                                    mapping=rest_fx.ORDERS_MAPPING)


class TestJsonFileLimitsAndEncoding:
    def test_file_too_large_raises(self):
        oversized = b"1" * (MAX_FILE_BYTES + 1)
        with pytest.raises(StandardizationError):
            json_file.to_record_set(oversized, resource=RESOURCE, workspace_id="ws1", execution_id="exec1")

    def test_invalid_utf8_raises(self):
        with pytest.raises(StandardizationError):
            json_file.to_record_set(b"\xff\xff\xff", resource=RESOURCE, workspace_id="ws1", execution_id="exec1")
