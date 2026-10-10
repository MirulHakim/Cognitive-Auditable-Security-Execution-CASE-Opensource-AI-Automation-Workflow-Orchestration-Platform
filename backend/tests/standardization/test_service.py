import pytest

from src.standardization.adapters.base import ResourceInfo, StandardizationError
from src.standardization.schemas import ResourceType
from src.standardization.service import _standardize_email_service, standardize_message, standardize_resource
from src.standardization.utils import sha256_hex
from tests.standardization.fixtures import gmail_payloads as gmail_fx
from tests.standardization.fixtures import json_file_payloads as json_fx
from tests.standardization.fixtures import rest_api_payloads as rest_fx
from tests.standardization.fixtures import telegram_payloads as tg_fx
from tests.standardization.fixtures import web_form_payloads as form_fx


class TestStandardizeMessageDispatch:
    def test_gmail_dispatch_emits_one_message_standardized_event_with_correct_hashes(self, memory_audit):
        msg = standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1",
                                  execution_id="exec1", verified=True, audit=memory_audit)
        events = [e for e in memory_audit.events if e["action"] == "MESSAGE_STANDARDIZED"]
        assert len(events) == 1
        details = events[0]["details"]
        assert details["input_hash"] == msg.raw_hash
        assert details["output_hash"] != msg.raw_hash
        assert events[0]["outcome"] == "SUCCESS"
        assert events[0]["target"] == "exec1"

    def test_telegram_dispatch_emits_one_message_standardized_event(self, memory_audit):
        standardize_message("TELEGRAM", tg_fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True, audit=memory_audit)
        events = [e for e in memory_audit.events if e["action"] == "MESSAGE_STANDARDIZED"]
        assert len(events) == 1

    def test_web_form_dispatch_emits_one_message_standardized_event(self, memory_audit):
        standardize_message("WEB_FORM", form_fx.VALID_FORM, workspace_id="ws1",
                            user_email="officer@example.com", audit=memory_audit)
        events = [e for e in memory_audit.events if e["action"] == "MESSAGE_STANDARDIZED"]
        assert len(events) == 1

    def test_web_form_without_email_raises_validation_error(self, memory_audit):
        with pytest.raises(StandardizationError) as exc_info:
            standardize_message("WEB_FORM", form_fx.VALID_FORM, workspace_id="ws1", audit=memory_audit)
        assert exc_info.value.code == "VALIDATION_ERROR"


class TestStandardizeResourceEmailService:
    def test_one_broken_of_three_messages_is_skipped_with_warning(self, memory_audit):
        resource = ResourceInfo(resource_id="r1", resource_name="Support Inbox", resource_type=ResourceType.EMAIL_SERVICE)
        messages = [gmail_fx.FULL_WITH_ATTACHMENT, gmail_fx.FULL_NO_ATTACHMENT, gmail_fx.NEITHER_RAW_NOR_PAYLOAD]
        rs = standardize_resource(resource, messages, workspace_id="ws1", execution_id="exec1", audit=memory_audit)
        assert rs.record_count == 2
        assert len(rs.warnings) == 1
        events = [e for e in memory_audit.events if e["action"] == "DATA_STANDARDIZED"]
        assert events[0]["details"]["record_count"] == 2
        assert events[0]["details"]["warning_count"] == 1

    def test_rest_api_without_mapping_raises_mapping_invalid(self, memory_audit):
        resource = ResourceInfo(resource_id="r2", resource_name="Orders API", resource_type=ResourceType.REST_API)
        with pytest.raises(StandardizationError) as exc_info:
            standardize_resource(resource, rest_fx.ORDERS_RESPONSE, workspace_id="ws1", execution_id="exec1", audit=memory_audit)
        assert exc_info.value.code == "MAPPING_INVALID"

    def test_json_file_dispatch_emits_one_data_standardized_event(self, memory_audit):
        resource = ResourceInfo(resource_id="r3", resource_name="Policies", resource_type=ResourceType.JSON_FILE)
        rs = standardize_resource(resource, json_fx.POLICY_DOCUMENT_BYTES, workspace_id="ws1", execution_id="exec1", audit=memory_audit)
        assert rs.record_count == 1
        events = [e for e in memory_audit.events if e["action"] == "DATA_STANDARDIZED"]
        assert len(events) == 1


class TestStandardizeEmailServiceGuards:
    """Direct unit tests of the private helper's own guard clauses - unreachable
    through standardize_resource's public dispatch, which only calls this helper
    when resource.resource_type is already EMAIL_SERVICE."""

    def test_wrong_resource_type_raises(self):
        resource = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)
        with pytest.raises(StandardizationError):
            _standardize_email_service([], resource=resource, workspace_id="ws1", execution_id="exec1")

    def test_non_list_raw_raises(self):
        resource = ResourceInfo(resource_id="r1", resource_name="Support Inbox", resource_type=ResourceType.EMAIL_SERVICE)
        with pytest.raises(StandardizationError):
            _standardize_email_service({"not": "a list"}, resource=resource, workspace_id="ws1", execution_id="exec1")


class TestFailureAuditAndReraise:
    def test_message_failure_emits_standardization_failed_then_reraises(self, memory_audit):
        with pytest.raises(StandardizationError):
            standardize_message("GMAIL", gmail_fx.MISSING_ID, workspace_id="ws1",
                               execution_id="exec1", verified=True, audit=memory_audit)
        assert len(memory_audit.events) == 1
        event = memory_audit.events[0]
        assert event["action"] == "STANDARDIZATION_FAILED"
        assert event["outcome"] == "FAILURE"
        assert event["details"]["stage"] == "message"

    def test_resource_failure_emits_standardization_failed_then_reraises(self, memory_audit):
        resource = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)
        with pytest.raises(StandardizationError):
            standardize_resource(resource, rest_fx.RESPONSE_NO_LIST_AT_PATH, workspace_id="ws1", execution_id="exec1",
                                 mapping=rest_fx.ORDERS_MAPPING, audit=memory_audit)
        assert len(memory_audit.events) == 1
        event = memory_audit.events[0]
        assert event["action"] == "STANDARDIZATION_FAILED"
        assert event["outcome"] == "FAILURE"
        assert event["details"]["stage"] == "resource"


class TestAuditDetailsNeverLeakPayload:
    def test_message_success_audit_has_no_body_text_or_raw_payload(self, memory_audit):
        standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1",
                            execution_id="exec1", verified=True, audit=memory_audit)
        for event in memory_audit.events:
            assert "body_text" not in event["details"]
            assert "payload" not in event["details"]
            assert gmail_fx.BODY_TEXT not in str(event["details"])

    def test_message_failure_audit_has_no_raw_payload(self, memory_audit):
        with pytest.raises(StandardizationError):
            standardize_message("GMAIL", gmail_fx.FULL_MISSING_SENDER, workspace_id="ws1",
                               execution_id="exec1", verified=True, audit=memory_audit)
        for event in memory_audit.events:
            assert "payload" not in event["details"]
            assert "raw" not in event["details"]

    def test_resource_success_audit_has_no_raw_payload_or_record_content(self, memory_audit):
        resource = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)
        standardize_resource(resource, rest_fx.ORDERS_RESPONSE, workspace_id="ws1", execution_id="exec1",
                             mapping=rest_fx.ORDERS_MAPPING, audit=memory_audit)
        for event in memory_audit.events:
            assert "records" not in event["details"]
            assert "Alice Tan" not in str(event["details"])


class TestDeterministicOutputHash:
    def test_same_gmail_input_twice_gives_same_output_hash(self, memory_audit):
        standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1",
                            execution_id="exec1", verified=True, audit=memory_audit)
        standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1",
                            execution_id="exec1", verified=True, audit=memory_audit)
        hashes = [e["details"]["output_hash"] for e in memory_audit.events if e["action"] == "MESSAGE_STANDARDIZED"]
        assert len(hashes) == 2
        assert hashes[0] == hashes[1]

    def test_same_resource_input_twice_gives_same_output_hash(self, memory_audit):
        resource = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)
        standardize_resource(resource, rest_fx.ORDERS_RESPONSE, workspace_id="ws1", execution_id="exec1",
                             mapping=rest_fx.ORDERS_MAPPING, audit=memory_audit)
        standardize_resource(resource, rest_fx.ORDERS_RESPONSE, workspace_id="ws1", execution_id="exec1",
                             mapping=rest_fx.ORDERS_MAPPING, audit=memory_audit)
        hashes = [e["details"]["output_hash"] for e in memory_audit.events if e["action"] == "DATA_STANDARDIZED"]
        assert len(hashes) == 2
        assert hashes[0] == hashes[1]

    def test_raw_hash_is_also_deterministic(self, memory_audit):
        """Sanity check: input_hash (raw_hash) is a pure function of the raw payload."""
        assert sha256_hex(gmail_fx.FULL_WITH_ATTACHMENT["payload"]) is not None  # payload hashing doesn't crash
        msg1 = standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1", verified=True)
        msg2 = standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id="ws1", verified=True)
        assert msg1.raw_hash == msg2.raw_hash


class TestServiceDefensivePaths:
    """§7.2 rule 6 requires catching StandardizationError and pydantic.ValidationError
    even though today's adapters already wrap ValidationError themselves before it
    reaches service.py - these exercise that defensive catch directly, and the
    unsupported-channel/-resource-type branches, via monkeypatching and unvalidated
    construction rather than real-world inputs."""

    def test_unsupported_channel_raises_unsupported_input(self, memory_audit):
        with pytest.raises(StandardizationError) as exc_info:
            standardize_message("SLACK", {}, workspace_id="ws1", audit=memory_audit)
        assert exc_info.value.code == "UNSUPPORTED_INPUT"

    def test_bare_validation_error_from_message_adapter_is_wrapped(self, monkeypatch, memory_audit):
        from pydantic import BaseModel

        class _Dummy(BaseModel):
            required_field: int

        def boom(*args, **kwargs):
            _Dummy()  # missing required_field -> raises pydantic.ValidationError

        monkeypatch.setattr("src.standardization.service.gmail.to_message", boom)
        with pytest.raises(StandardizationError):
            standardize_message("GMAIL", {}, workspace_id="ws1", verified=True, audit=memory_audit)
        assert memory_audit.events[0]["action"] == "STANDARDIZATION_FAILED"

    def test_bare_validation_error_from_resource_adapter_is_wrapped(self, monkeypatch, memory_audit):
        from pydantic import BaseModel

        class _Dummy(BaseModel):
            required_field: int

        def boom(*args, **kwargs):
            _Dummy()

        monkeypatch.setattr("src.standardization.service.rest_api.to_record_set", boom)
        resource = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)
        with pytest.raises(StandardizationError):
            standardize_resource(resource, {}, workspace_id="ws1", execution_id="exec1",
                                 mapping=rest_fx.ORDERS_MAPPING, audit=memory_audit)
        assert memory_audit.events[0]["action"] == "STANDARDIZATION_FAILED"

    def test_unrecognised_resource_type_raises_unsupported_input(self, memory_audit):
        from enum import Enum

        class _FakeResourceType(Enum):
            CARRIER_PIGEON = "CARRIER_PIGEON"

        # model_construct bypasses the ResourceType enum validation, standing in for
        # a future resource type the if/elif dispatch in standardize_resource doesn't
        # yet handle - the .value attribute still exists so dispatch gets to compare.
        resource = ResourceInfo.model_construct(resource_id="r1", resource_name="Mystery",
                                                resource_type=_FakeResourceType.CARRIER_PIGEON)
        with pytest.raises(StandardizationError) as exc_info:
            standardize_resource(resource, {}, workspace_id="ws1", execution_id="exec1", audit=memory_audit)
        assert exc_info.value.code == "UNSUPPORTED_INPUT"
