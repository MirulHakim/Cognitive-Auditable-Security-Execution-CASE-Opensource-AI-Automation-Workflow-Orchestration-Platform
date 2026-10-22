"""AuditService is a drop-in for Standardization's MemoryAuditLogger: the same
calls the Standardization tests make are accepted and stored correctly
(AUDIT_MODULE_PLAN.md §10). These use UUID workspace ids; the original
Standardization tests keep "ws1" because MemoryAuditLogger validates nothing."""

from uuid import UUID

import pytest

from src.audit.canonical import compute_event_hash
from src.standardization.adapters.base import ResourceInfo, StandardizationError
from src.standardization.audit_port import MemoryAuditLogger
from src.standardization.schemas import ResourceType
from src.standardization.service import standardize_message, standardize_resource
from tests.audit.conftest import WS
from tests.standardization.fixtures import gmail_payloads as gmail_fx
from tests.standardization.fixtures import json_file_payloads as json_fx
from tests.standardization.fixtures import rest_api_payloads as rest_fx
from tests.standardization.fixtures import telegram_payloads as tg_fx
from tests.standardization.fixtures import web_form_payloads as form_fx

pytestmark = pytest.mark.anyio

EXEC = "0d9e7a52-3c1f-4b6a-9e8d-7f6a5b4c3d2e"
ORDERS = ResourceInfo(resource_id="r1", resource_name="Orders API", resource_type=ResourceType.REST_API)


async def _call(case, audit):
    """Run one Standardization call; failures are expected for some cases."""
    try:
        await case(audit)
    except StandardizationError:
        pass


CASES = {
    "gmail_success": lambda a: standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id=WS,
                                                   execution_id=EXEC, verified=True, audit=a),
    "gmail_success_no_execution_id": lambda a: standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT,
                                                                   workspace_id=WS, verified=True, audit=a),
    "telegram_success": lambda a: standardize_message("TELEGRAM", tg_fx.UPDATE_WITH_DOCUMENT, workspace_id=WS,
                                                      execution_id=EXEC, verified=True, audit=a),
    "web_form_success": lambda a: standardize_message("WEB_FORM", form_fx.VALID_FORM, workspace_id=WS,
                                                      execution_id=EXEC, user_email="officer@example.com", audit=a),
    "web_form_missing_email": lambda a: standardize_message("WEB_FORM", form_fx.VALID_FORM, workspace_id=WS,
                                                            execution_id=EXEC, audit=a),
    "gmail_missing_id": lambda a: standardize_message("GMAIL", gmail_fx.MISSING_ID, workspace_id=WS,
                                                      execution_id=EXEC, verified=True, audit=a),
    "gmail_missing_sender": lambda a: standardize_message("GMAIL", gmail_fx.FULL_MISSING_SENDER, workspace_id=WS,
                                                          verified=True, audit=a),
    "unsupported_channel": lambda a: standardize_message("SLACK", {}, workspace_id=WS, audit=a),
    "email_service_resource": lambda a: standardize_resource(
        ResourceInfo(resource_id="r9", resource_name="Inbox", resource_type=ResourceType.EMAIL_SERVICE),
        [gmail_fx.FULL_WITH_ATTACHMENT, gmail_fx.NEITHER_RAW_NOR_PAYLOAD], workspace_id=WS, execution_id=EXEC, audit=a),
    "rest_api_resource": lambda a: standardize_resource(ORDERS, rest_fx.ORDERS_RESPONSE, workspace_id=WS,
                                                        execution_id=EXEC, mapping=rest_fx.ORDERS_MAPPING, audit=a),
    "rest_api_no_mapping": lambda a: standardize_resource(ORDERS, rest_fx.ORDERS_RESPONSE, workspace_id=WS,
                                                          execution_id=EXEC, audit=a),
    "rest_api_no_mapping_no_execution_id": lambda a: standardize_resource(ORDERS, rest_fx.ORDERS_RESPONSE,
                                                                          workspace_id=WS, execution_id="", audit=a),
    "json_file_resource": lambda a: standardize_resource(
        ResourceInfo(resource_id="r3", resource_name="Policies", resource_type=ResourceType.JSON_FILE),
        json_fx.POLICY_DOCUMENT_BYTES, workspace_id=WS, execution_id=EXEC, audit=a),
}


@pytest.mark.parametrize("name", sorted(CASES))
async def test_audit_service_records_what_memory_logger_receives(name, service, repo):
    memory = MemoryAuditLogger()
    await _call(CASES[name], memory)
    await _call(CASES[name], service)

    stored = await repo.list_events(UUID(WS))
    assert len(stored) == len(memory.events) == 1
    sent, event = memory.events[0], stored[0]
    assert event.action == sent["action"]
    assert event.outcome.value == sent["outcome"]
    assert event.source.value == sent["source"]
    assert f"{event.target_type}:{event.target_id}" == sent["target"]
    assert (event.actor_id, event.actor_role.value, event.actor_type.value) == ("system", "SYSTEM", "SYSTEM")
    assert event.execution_id == (sent["execution_id"] or None)
    assert compute_event_hash(event) == event.current_hash


@pytest.mark.parametrize("name", sorted(CASES))
async def test_details_are_stored_exactly_as_sent(name, service, repo):
    memory = MemoryAuditLogger()
    await _call(CASES[name], memory)
    await _call(CASES[name], service)
    (event,) = await repo.list_events(UUID(WS))
    sent = memory.events[0]["details"]
    if name == "web_form_success":
        # No submitted_at is passed, so received_at (and therefore output_hash) is the
        # wall-clock time of each call; the two runs legitimately differ there.
        sent = {k: v for k, v in sent.items() if k != "output_hash"}
        assert len(event.details.pop("output_hash")) == 64
    assert event.details == sent


async def test_output_hash_is_recorded_for_provenance(service, repo):
    msg = await standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id=WS,
                                    execution_id=EXEC, verified=True, audit=service)
    (event,) = await repo.list_events(UUID(WS))
    assert event.details["input_hash"] == msg.raw_hash
    assert len(event.details["output_hash"]) == 64


async def test_a_request_builds_one_chain(service, repo):
    await standardize_message("GMAIL", gmail_fx.FULL_WITH_ATTACHMENT, workspace_id=WS, execution_id=EXEC,
                              verified=True, audit=service)
    with pytest.raises(StandardizationError):
        await standardize_message("GMAIL", gmail_fx.MISSING_ID, workspace_id=WS, execution_id=EXEC,
                                  verified=True, audit=service)
    first, second = await repo.list_events(UUID(WS))
    assert (first.seq, second.seq) == (1, 2)
    assert second.previous_hash == first.current_hash
