import inspect
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

import pytest

from src.audit.canonical import GENESIS_HASH, compute_event_hash
from src.audit.errors import AuditValidationError
from src.audit.repository import InMemoryAuditRepository
from src.audit.service import MAX_DETAILS_BYTES, AuditService
from src.audit.port import AuditLogger
from tests.audit.conftest import HASH_A, HASH_B, WS, CountingIds, StepClock, event_kwargs

pytestmark = pytest.mark.anyio


async def _rejected(service, code, **overrides):
    with pytest.raises(AuditValidationError) as exc_info:
        await service.append_event(**event_kwargs(**overrides))
    assert exc_info.value.code == code
    return exc_info.value


class TestProtocol:
    def test_log_event_signature_matches_audit_logger(self):
        expected = inspect.signature(AuditLogger.log_event)
        actual = inspect.signature(AuditService.log_event)
        assert [(p.name, p.kind, p.default) for p in actual.parameters.values()] == \
               [(p.name, p.kind, p.default) for p in expected.parameters.values()]
        assert inspect.iscoroutinefunction(AuditService.log_event)

    async def test_log_event_returns_none_and_stores_the_event(self, service, repo):
        assert await service.log_event(**event_kwargs()) is None
        assert len(await repo.list_events(UUID(WS))) == 1


class TestMapping:
    async def test_fields_mapped_per_8_1(self, service):
        event = await service.append_event(**event_kwargs())
        assert event.workspace_id == UUID(WS)
        assert (event.actor_id, event.actor_role.value, event.actor_type.value) == ("u-123", "OPERATOR", "USER")
        assert (event.target_type, event.target_id) == ("execution", "job-1")
        assert event.event_type.value == "USER_ACTION"
        assert (event.action, event.source.value, event.outcome.value) == ("REQUEST_UNSUPPORTED", "WEB_APP", "SUCCESS")
        assert event.execution_id == "job-1"

    @pytest.mark.parametrize("role,actor_type", [
        ("ADMIN", "USER"), ("OPERATOR", "USER"), ("AUDITOR", "USER"), ("SYSTEM", "SYSTEM"), ("AI", "AI"),
    ])
    async def test_actor_type_derived_from_role(self, service, role, actor_type):
        event = await service.append_event(**event_kwargs(role=role))
        assert event.actor_type.value == actor_type

    @pytest.mark.parametrize("actor,role", [
        ("qwen3.5:9b", "AI"), ("system", "SYSTEM"), ("6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b", "OPERATOR"),
    ])
    async def test_actor_ids_accepted(self, service, actor, role):
        event = await service.append_event(**event_kwargs(actor=actor, role=role))
        assert event.actor_id == actor

    async def test_ai_actor_is_the_model_name(self, service):
        event = await service.append_event(**event_kwargs(role="AI", actor="qwen3.5:9b", action="AI_CONTENT_GENERATED"))
        assert (event.actor_id, event.actor_type.value) == ("qwen3.5:9b", "AI")

    async def test_target_split_on_first_colon_only(self, service):
        event = await service.append_event(**event_kwargs(target="execution:abc:def"))
        assert (event.target_type, event.target_id) == ("execution", "abc:def")

    async def test_workspace_uuid_is_stored_lowercase_canonical(self, service):
        event = await service.append_event(**event_kwargs(workspace_id=WS.upper()))
        assert str(event.workspace_id) == WS

    async def test_execution_id_optional(self, service):
        event = await service.append_event(**event_kwargs(execution_id=None, target=f"workspace:{WS}"))
        assert event.execution_id is None

    async def test_timestamp_set_by_service_in_utc(self, repo):
        fixed = datetime(2026, 10, 22, 9, 0, tzinfo=timezone.utc)
        service = AuditService(repo, clock=lambda: fixed)
        event = await service.append_event(**event_kwargs())
        assert event.event_timestamp == fixed and event.event_timestamp.tzinfo == timezone.utc

    async def test_stored_hash_recomputes(self, service):
        event = await service.append_event(**event_kwargs())
        assert compute_event_hash(event) == event.current_hash


class TestRejections:
    async def test_unknown_action(self, service):
        await _rejected(service, "UNKNOWN_ACTION", action="SOMETHING_ELSE")

    async def test_action_is_case_sensitive(self, service):
        await _rejected(service, "UNKNOWN_ACTION", action="request_unsupported")

    @pytest.mark.parametrize("outcome", ["OK", "success", "", None])
    async def test_bad_outcome(self, service, outcome):
        await _rejected(service, "INVALID_OUTCOME", outcome=outcome)

    @pytest.mark.parametrize("role", ["DEVELOPER", "admin", "STAFF", ""])
    async def test_bad_role(self, service, role):
        await _rejected(service, "INVALID_ROLE", role=role)

    @pytest.mark.parametrize("actor", ["", "   ", "x" * 129, "line\nbreak", "ali@example.com", None])
    async def test_bad_actor(self, service, actor):
        await _rejected(service, "INVALID_ACTOR", actor=actor)

    @pytest.mark.parametrize("target", [
        "exec1", "", ":abc", "execution:", "Execution:abc", "exec-ution:abc", "execution:ali@example.com",
        "execution: abc", None,
    ])
    async def test_bad_target(self, service, target):
        await _rejected(service, "INVALID_TARGET", target=target)

    @pytest.mark.parametrize("workspace_id", ["ws1", "", None, 42])
    async def test_workspace_must_be_uuid(self, service, workspace_id):
        await _rejected(service, "INVALID_WORKSPACE", workspace_id=workspace_id)

    @pytest.mark.parametrize("source", ["SLACK", "gmail", "", None])
    async def test_source_must_be_in_fixed_list(self, service, source):
        await _rejected(service, "INVALID_SOURCE", source=source)

    @pytest.mark.parametrize("source", [
        "GMAIL", "TELEGRAM", "WEB_FORM", "WEB_APP", "SYSTEM", "REST_API", "JSON_FILE", "EMAIL_SERVICE",
    ])
    async def test_every_listed_source_accepted(self, service, source):
        event = await service.append_event(**event_kwargs(source=source))
        assert event.source.value == source

    @pytest.mark.parametrize("execution_id", ["", "x" * 129, "job 1", "ali@example.com", 7])
    async def test_bad_execution_id(self, service, execution_id):
        await _rejected(service, "INVALID_EXECUTION_ID", execution_id=execution_id)

    async def test_rejected_event_does_not_advance_the_chain(self, service, repo):
        await service.append_event(**event_kwargs())
        await _rejected(service, "UNKNOWN_ACTION", action="NOPE")
        second = await service.append_event(**event_kwargs())
        assert second.seq == 2
        assert (await repo.get_head(UUID(WS))).last_seq == 2

    async def test_rejection_is_raised_by_log_event_too(self, service):
        with pytest.raises(AuditValidationError):
            await service.log_event(**event_kwargs(action="NOPE"))


class TestDetails:
    async def test_details_must_be_a_dict(self, service):
        await _rejected(service, "INVALID_DETAILS", details=["not", "a", "dict"])

    @pytest.mark.parametrize("details", [{"score": 0.5}, {"a": {"b": [1, 2.5]}}])
    async def test_float_rejected(self, service, details):
        await _rejected(service, "INVALID_DETAILS", details=details)

    async def test_nul_rejected(self, service):
        await _rejected(service, "INVALID_DETAILS", details={"note": "a\x00b"})

    @pytest.mark.parametrize("details", [
        {"body": "hello"}, {"BODY_TEXT": "x"}, {"meta": {"Prompt": "x"}},
        {"items": [{"ok": 1}, {"password": "x"}]},
        {"bot_token": "123:abc"}, {"access_token": "x"}, {"Client_Secret": "x"},
    ])
    async def test_forbidden_keys_rejected(self, service, details):
        error = await _rejected(service, "FORBIDDEN_DETAILS", details=details)
        assert "123:abc" not in str(error)

    @pytest.mark.parametrize("details", [
        {"prompt_hash": HASH_A}, {"content_hash": HASH_A}, {"body_truncated": False}, {"token_count": 3},
    ])
    async def test_hash_and_flag_keys_allowed(self, service, details):
        await service.append_event(**event_kwargs(details=details))

    async def test_forbidden_key_reported_before_missing_required_keys(self, service):
        await _rejected(service, "FORBIDDEN_DETAILS", action="EXECUTION_CLOSED", details={"raw": "x"})

    def _details_of_size(self, size: int) -> dict:
        overhead = len('{"pad":""}')
        return {"pad": "x" * (size - overhead)}

    async def test_exactly_8_kb_accepted(self, service):
        await service.append_event(**event_kwargs(details=self._details_of_size(MAX_DETAILS_BYTES)))

    async def test_over_8_kb_rejected(self, service):
        await _rejected(service, "DETAILS_TOO_LARGE", details=self._details_of_size(MAX_DETAILS_BYTES + 1))

    async def test_size_counts_utf8_bytes_not_characters(self, service):
        # 'é' is 2 bytes: 4100 of them is 8200 bytes although only 4100 characters.
        await _rejected(service, "DETAILS_TOO_LARGE", details={"pad": "é" * 4100})

    async def test_details_stored_in_canonical_form(self, service):
        event = await service.append_event(**event_kwargs(details={
            "amount": Decimal("1.50"), "ref": UUID(WS), "at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }))
        assert event.details == {"amount": "1.50", "ref": WS, "at": "2026-01-01T00:00:00.000000Z"}

    async def test_caller_details_are_not_shared_with_the_stored_event(self, service, repo):
        details = {"reason_code": "NO_TEMPLATE", "list": [1]}
        await service.append_event(**event_kwargs(details=details))
        details["list"].append(2)
        (stored,) = await repo.list_events(UUID(WS))
        assert stored.details["list"] == [1]


# One valid details example per action with required details.
VALID = {
    "MESSAGE_STANDARDIZED": {"adapter": "gmail_adapter v1", "schema": "StandardMessage 1.0", "input_hash": HASH_A,
                             "output_hash": HASH_B, "body_truncated": False, "attachment_count": 1},
    "STANDARDIZATION_FAILED": {"stage": "message", "source": "GMAIL", "code": "STANDARDIZATION_FAILED",
                               "error_fields": ["sender.id"]},
    "AI_TEMPLATE_SELECTED": {"template_id": "tpl-1", "template_version": 3, "source_template_hash": HASH_A,
                             "confidence": "0.87"},
    "AI_TEMPLATE_NO_MATCH": {"candidates_checked": 4, "reason_code": "BELOW_THRESHOLD"},
    "TEMPLATE_MANUALLY_SELECTED": {"ai_template_id": None, "template_id": "tpl-2", "template_version": "v2",
                                   "source_template_hash": HASH_A},
    "TEMPLATE_REQUESTED": {"prompt_hash": HASH_A},
    "AI_TEMPLATE_DRAFTED": {"template_id": "tpl-3", "template_version": 1, "template_hash": HASH_A,
                            "prompt_hash": HASH_B},
    "TEMPLATE_CREATED": {"template_id": "tpl-3", "template_version": 1, "template_hash": HASH_A,
                         "origin": "AI_DRAFTED"},
    "TEMPLATE_DEACTIVATED": {"template_id": "tpl-3", "template_version": 1, "reason_code": "OUTDATED"},
    "TEMPLATE_INSTANTIATED": {"template_id": "tpl-3", "template_version": 1, "working_copy_id": "wc-1",
                              "revision": 0, "content_hash": HASH_A},
    "EXECUTION_TEMPLATE_MODIFIED": {"working_copy_id": "wc-1", "revision": 1, "previous_hash": HASH_A,
                                    "content_hash": HASH_B, "changed_fields": ["steps.2.recipient"]},
    "GATE1_APPROVED": {"revision": 1, "approved_template_hash": HASH_A},
    "GATE1_REJECTED": {"revision": 1, "comment_hash": HASH_B},
    "GATE2_APPROVED": {"document_hash": HASH_A},
    "GATE2_REJECTED": {"document_hash": HASH_A, "comment_hash": HASH_B},
    "EXECUTION_STARTED": {"approved_template_hash": HASH_A, "executed_template_hash": HASH_A},
    "ATTACHMENT_EXTRACTED": {"attachment_count": 2, "file_hashes": [HASH_A, HASH_B], "extracted_chars": 1200},
    "EXECUTION_CLOSED": {"final_status": "DELIVERED"},
    "INTEGRATION_CONNECTED": {"integration_id": "int-1", "channel": "TELEGRAM", "scope_label": "Ops bot"},
    "INTEGRATION_DISCONNECTED": {"integration_id": "int-1", "channel": "GMAIL", "scope_label": "Inbox"},
    "AUDIT_INTEGRITY_VERIFIED": {"verification_id": "ver-1", "events_checked": 10, "head_seq": 10,
                                 "head_hash": HASH_A},
    "AUDIT_INTEGRITY_FAILED": {"verification_id": "ver-2", "events_checked": 10, "head_seq": 10,
                               "head_hash": HASH_A, "broken_at_seq": 4},
    "PROVENANCE_RECORDED": {"provenance_id": "prov-1", "event_count": 12, "lineage_hash": HASH_A,
                            "record_hash": HASH_B},
}


class TestRequiredDetails:
    @pytest.mark.parametrize("action", sorted(VALID))
    async def test_valid_details_accepted_and_stored_unchanged(self, service, action):
        event = await service.append_event(**event_kwargs(action=action, details=VALID[action]))
        assert event.details == VALID[action]  # no defaults added to the hashed record

    @pytest.mark.parametrize("action", sorted(VALID))
    async def test_each_required_key_is_required(self, service, action):
        from src.audit.catalogue import REQUIRED_DETAILS, AuditAction
        model = REQUIRED_DETAILS[AuditAction(action)]
        for name, field in model.model_fields.items():
            if not field.is_required():
                continue
            key = field.alias or name
            details = {k: v for k, v in VALID[action].items() if k != key}
            error = await _rejected(service, "INVALID_REQUIRED_DETAILS", action=action, details=details)
            assert key in str(error)

    async def test_extra_keys_allowed(self, service):
        await service.append_event(**event_kwargs(action="EXECUTION_CLOSED",
                                                  details={"final_status": "FAILED", "step": "doc_builder"}))

    @pytest.mark.parametrize("action,details", [
        ("AI_TEMPLATE_NO_MATCH", {"candidates_checked": "4", "reason_code": "BELOW_THRESHOLD"}),  # no str -> int
        ("AI_TEMPLATE_NO_MATCH", {"candidates_checked": True, "reason_code": "BELOW_THRESHOLD"}),  # bool is not int
        ("AI_TEMPLATE_NO_MATCH", {"candidates_checked": -1, "reason_code": "BELOW_THRESHOLD"}),
        ("TEMPLATE_REQUESTED", {"prompt_hash": "ABC"}),
        ("TEMPLATE_REQUESTED", {"prompt_hash": HASH_A.upper()}),
        ("EXECUTION_CLOSED", {"final_status": "DONE"}),
        ("TEMPLATE_CREATED", {"template_id": "t", "template_version": 1, "template_hash": HASH_A, "origin": "AI"}),
        ("INTEGRATION_CONNECTED", {"integration_id": "i", "channel": "WEB_FORM", "scope_label": "x"}),
        ("AI_TEMPLATE_SELECTED", {"template_id": "t", "template_version": 1, "source_template_hash": HASH_A,
                                  "confidence": "high"}),
        ("STANDARDIZATION_FAILED", {"stage": "message", "source": "SLACK", "code": "X", "error_fields": []}),
        ("STANDARDIZATION_FAILED", {"stage": "message", "source": "GMAIL", "code": "X",
                                    "error_fields": ["ali@example.com"]}),
        ("MESSAGE_STANDARDIZED", dict(VALID["MESSAGE_STANDARDIZED"], body_truncated="no")),
    ])
    async def test_strict_types(self, service, action, details):
        await _rejected(service, "INVALID_REQUIRED_DETAILS", action=action, details=details)

    async def test_ai_template_id_key_must_be_present_even_if_null(self, service):
        details = {k: v for k, v in VALID["TEMPLATE_MANUALLY_SELECTED"].items() if k != "ai_template_id"}
        await _rejected(service, "INVALID_REQUIRED_DETAILS", action="TEMPLATE_MANUALLY_SELECTED", details=details)

    async def test_error_message_does_not_echo_values(self, service):
        error = await _rejected(service, "INVALID_REQUIRED_DETAILS", action="TEMPLATE_REQUESTED",
                                details={"prompt_hash": "my secret prompt text"})
        assert "my secret prompt text" not in str(error)


class TestDeterminism:
    async def test_same_inputs_same_clock_same_ids_give_identical_chains(self):
        async def run():
            service = AuditService(InMemoryAuditRepository(), clock=StepClock(), new_id=CountingIds())
            return [await service.append_event(**event_kwargs(details={"n": i})) for i in range(3)]

        first, second = await run(), await run()
        assert [e.current_hash for e in first] == [e.current_hash for e in second]
        assert [e.event_id for e in first] == [UUID(int=1), UUID(int=2), UUID(int=3)]

    async def test_naive_clock_is_a_programming_error(self, repo):
        service = AuditService(repo, clock=lambda: datetime(2026, 1, 1))
        with pytest.raises(RuntimeError, match="timezone-aware"):
            await service.append_event(**event_kwargs())

    async def test_first_event_links_to_genesis(self, service):
        event = await service.append_event(**event_kwargs())
        assert (event.seq, event.previous_hash) == (1, GENESIS_HASH)


class TestSession:
    async def test_session_passed_to_the_repository(self, monkeypatch, service, repo):
        seen = {}
        original = repo.append

        async def spy(workspace_id, build, *, session=None):
            seen["session"] = session
            return await original(workspace_id, build, session=session)

        monkeypatch.setattr(repo, "append", spy)
        marker = object()
        await service.log_event(**event_kwargs(), session=marker)
        assert seen["session"] is marker
