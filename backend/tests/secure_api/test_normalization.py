"""
Task 3.4: Testing of standardization process

Uses placeholder raw data from test_fixtures.py, shaped like what each
resource type is assumed to return (see test_fixtures.py for caveats).
"""

from datetime import datetime
from uuid import uuid4

from src.secure_api.normalization import standardize_record, standardize_records
from src.secure_api.schemas import FieldTypeEnum, ResourceTypeEnum
from tests.secure_api.test_fixtures import MOCK_RAW_DATA


def _fields_by_name(record):
    return {f.field_name: f for f in record.fields}


class TestRestApiStandardization:
    def test_mapped_fields_are_renamed_and_typed(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.REST_API, MOCK_RAW_DATA[ResourceTypeEnum.REST_API]
        )
        fields = _fields_by_name(record)

        assert fields["record_id"].original_field_name == "id"
        assert fields["record_id"].field_value == "usr_123"
        assert fields["record_id"].transformed is True

        assert fields["created_timestamp"].field_type == FieldTypeEnum.DATETIME
        assert fields["created_timestamp"].field_value == datetime.fromisoformat("2026-08-20T10:30:00+00:00")

    def test_unmapped_fields_pass_through(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.REST_API, MOCK_RAW_DATA[ResourceTypeEnum.REST_API]
        )
        fields = _fields_by_name(record)

        assert fields["name"].transformed is False
        assert fields["name"].field_type == FieldTypeEnum.STRING
        assert fields["active"].field_type == FieldTypeEnum.BOOLEAN


class TestDatabaseStandardization:
    def test_mapped_fields(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.DATABASE, MOCK_RAW_DATA[ResourceTypeEnum.DATABASE]
        )
        fields = _fields_by_name(record)

        assert fields["record_id"].field_value == 42
        assert fields["created_timestamp"].field_type == FieldTypeEnum.DATETIME
        # No conversion_rule defined for DATABASE's created_date -> value passes through raw
        assert fields["created_timestamp"].field_value == "2026-08-15"

    def test_unmapped_fields_pass_through(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.DATABASE, MOCK_RAW_DATA[ResourceTypeEnum.DATABASE]
        )
        fields = _fields_by_name(record)

        assert fields["customer_name"].field_type == FieldTypeEnum.STRING
        assert fields["balance"].field_type == FieldTypeEnum.NUMBER


class TestEmailServiceStandardization:
    def test_mapped_fields(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.EMAIL_SERVICE, MOCK_RAW_DATA[ResourceTypeEnum.EMAIL_SERVICE]
        )
        fields = _fields_by_name(record)

        assert fields["record_id"].original_field_name == "message_id"
        assert fields["sender"].field_value == "alice@example.com"
        assert fields["recipient"].field_value == "bob@example.com"

    def test_unmapped_fields_pass_through(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.EMAIL_SERVICE, MOCK_RAW_DATA[ResourceTypeEnum.EMAIL_SERVICE]
        )
        fields = _fields_by_name(record)

        assert fields["subject"].transformed is False


class TestJsonFileStandardization:
    def test_all_fields_pass_through_unmapped(self):
        resource_id = uuid4()
        record = standardize_record(
            resource_id, ResourceTypeEnum.JSON_FILE, MOCK_RAW_DATA[ResourceTypeEnum.JSON_FILE]
        )
        fields = _fields_by_name(record)

        assert all(f.transformed is False for f in record.fields)
        assert fields["item_id"].field_type == FieldTypeEnum.NUMBER
        assert fields["in_stock"].field_type == FieldTypeEnum.BOOLEAN


class TestStandardizeRecords:
    def test_batch_standardization_preserves_order_and_original_data(self):
        resource_id = uuid4()
        raw_records = [
            MOCK_RAW_DATA[ResourceTypeEnum.JSON_FILE],
            {"item_id": 8, "label": "Gadget"},
        ]
        records = standardize_records(resource_id, ResourceTypeEnum.JSON_FILE, raw_records)

        assert len(records) == 2
        assert records[0].original_data == raw_records[0]
        assert records[1].original_data == raw_records[1]
        assert all(r.resource_id == resource_id for r in records)
