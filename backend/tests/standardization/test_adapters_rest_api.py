from decimal import Decimal

import pytest

from src.standardization.adapters import rest_api
from src.standardization.adapters.base import ResourceInfo, StandardizationError
from src.standardization.schemas import ResourceType
from tests.standardization.fixtures import rest_api_payloads as fx

RESOURCE = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)


class TestRestApiToRecordSet:
    def test_mapping_applied_money_and_boolean_and_date(self):
        rs = rest_api.to_record_set(fx.ORDERS_RESPONSE, resource=RESOURCE, mapping=fx.ORDERS_MAPPING,
                                    workspace_id="ws1", execution_id="exec1")
        assert rs.record_count == 1
        record = rs.records[0]
        assert record.data["client"] == "Alice Tan"
        assert record.data["amount_myr"] == Decimal("1200.00")
        assert record.data["paid"] is True  # "ya" -> True
        assert record.metadata["room_no"] == "A-204"
        assert record.occurred_at is not None

    def test_missing_id_generates_id_and_warns(self):
        rs = rest_api.to_record_set(fx.ORDERS_RESPONSE_MISSING_ID, resource=RESOURCE, mapping=fx.ORDERS_MAPPING,
                                    workspace_id="ws1", execution_id="exec1")
        assert rs.records[0].record_id.startswith("order-")
        assert any("order_id" in w for w in rs.warnings)

    def test_bad_amount_becomes_null_with_warning(self):
        rs = rest_api.to_record_set(fx.ORDERS_RESPONSE_BAD_AMOUNT, resource=RESOURCE, mapping=fx.ORDERS_MAPPING,
                                    workspace_id="ws1", execution_id="exec1")
        assert rs.records[0].data["amount_myr"] is None
        assert any("amount_myr" in w for w in rs.warnings)

    def test_no_list_at_path_raises(self):
        with pytest.raises(StandardizationError):
            rest_api.to_record_set(fx.RESPONSE_NO_LIST_AT_PATH, resource=RESOURCE, mapping=fx.ORDERS_MAPPING,
                                   workspace_id="ws1", execution_id="exec1")

    def test_single_object_response_becomes_one_record(self):
        mapping = dict(fx.ORDERS_MAPPING, records_path="")
        rs = rest_api.to_record_set(fx.RESPONSE_SINGLE_OBJECT, resource=RESOURCE, mapping=mapping,
                                    workspace_id="ws1", execution_id="exec1")
        assert rs.record_count == 1

    def test_invalid_mapping_raises_mapping_invalid(self):
        with pytest.raises(StandardizationError) as exc_info:
            rest_api.to_record_set(fx.ORDERS_RESPONSE, resource=RESOURCE, mapping=fx.INVALID_MAPPING,
                                   workspace_id="ws1", execution_id="exec1")
        assert exc_info.value.code == "MAPPING_INVALID"

    def test_over_500_records_is_truncated(self):
        rs = rest_api.to_record_set(fx.make_bulk_orders(620), resource=RESOURCE, mapping=fx.ORDERS_MAPPING,
                                    workspace_id="ws1", execution_id="exec1")
        assert rs.record_count == 500
        assert rs.truncated is True

    def test_wrong_resource_type_raises(self):
        json_resource = ResourceInfo(resource_id="r2", resource_name="File", resource_type=ResourceType.JSON_FILE)
        with pytest.raises(StandardizationError):
            rest_api.to_record_set(fx.ORDERS_RESPONSE, resource=json_resource, mapping=fx.ORDERS_MAPPING,
                                   workspace_id="ws1", execution_id="exec1")
