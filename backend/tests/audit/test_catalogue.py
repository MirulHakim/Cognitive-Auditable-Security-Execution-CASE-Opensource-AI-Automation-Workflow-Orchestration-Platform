import typing

import pytest

from src.audit.catalogue import (
    EVENT_TYPES, FINAL_STATUSES, REQUIRED_DETAILS, REQUIRED_PRIOR_GATE, AuditAction, SourceName,
    find_forbidden_keys, is_forbidden_key,
)
from src.audit.schemas import AuditEventTypeEnum, AuditSourceEnum

# §7 action table, copied from the plan (plus the two Standardization rows added in Phase 1).
PLAN_ACTIONS = {
    "JOB_RECEIVED": "SYSTEM_ACTION",
    "INGRESS_REJECTED_NOT_WHITELISTED": "SECURITY_EVENT", "INGRESS_REJECTED_DKIM_FAIL": "SECURITY_EVENT",
    "MESSAGE_STANDARDIZED": "SYSTEM_ACTION", "STANDARDIZATION_FAILED": "SYSTEM_ACTION",
    "DATA_STANDARDIZED": "SYSTEM_ACTION",
    "AI_TEMPLATE_SELECTED": "AI_DECISION", "AI_TEMPLATE_NO_MATCH": "AI_DECISION",
    "AI_TEMPLATE_DRAFTED": "AI_DECISION", "AI_CONTENT_GENERATED": "AI_DECISION",
    "TEMPLATE_MANUALLY_SELECTED": "USER_ACTION", "TEMPLATE_REQUESTED": "USER_ACTION",
    "TEMPLATE_CREATED": "USER_ACTION", "TEMPLATE_DEACTIVATED": "USER_ACTION",
    "EXECUTION_TEMPLATE_MODIFIED": "USER_ACTION", "REQUEST_UNSUPPORTED": "USER_ACTION",
    "TEMPLATE_INSTANTIATED": "SYSTEM_ACTION", "EXECUTION_TEMPLATE_MODIFY_REJECTED": "SECURITY_EVENT",
    "GATE1_SUBMITTED": "STATE_CHANGE",
    "GATE1_APPROVED": "APPROVAL_GATE", "GATE1_REJECTED": "APPROVAL_GATE",
    "GATE2_APPROVED": "APPROVAL_GATE", "GATE2_REJECTED": "APPROVAL_GATE",
    "EXECUTION_STARTED": "STATE_CHANGE", "EXECUTION_FAILED": "STATE_CHANGE", "EXECUTION_CLOSED": "STATE_CHANGE",
    "ATTACHMENT_EXTRACTED": "SYSTEM_ACTION",
    "DOCUMENT_GENERATED": "SYSTEM_ACTION", "JOB_DELIVERED": "SYSTEM_ACTION",
    "INTEGRATION_CONNECTED": "USER_ACTION", "INTEGRATION_DISCONNECTED": "USER_ACTION",
    "ACCESS_FORBIDDEN": "SECURITY_EVENT", "AUTH_FAILED": "SECURITY_EVENT",
    "WHITELIST_ADDED": "SECURITY_EVENT", "WHITELIST_REMOVED": "SECURITY_EVENT",
    "AUDIT_INTEGRITY_VERIFIED": "INTEGRITY_EVENT", "AUDIT_INTEGRITY_FAILED": "INTEGRITY_EVENT",
    "LINEAGE_VERIFIED": "INTEGRITY_EVENT", "LINEAGE_VERIFICATION_FAILED": "INTEGRITY_EVENT",
    "AUDIT_EXPORTED": "INTEGRITY_EVENT", "PROVENANCE_RECORDED": "INTEGRITY_EVENT",
}

PLAN_REQUIRED_KEYS = {
    "MESSAGE_STANDARDIZED": {"adapter", "schema", "input_hash", "output_hash", "body_truncated", "attachment_count"},
    "STANDARDIZATION_FAILED": {"stage", "source", "code", "error_fields"},
    "AI_TEMPLATE_SELECTED": {"template_id", "template_version", "source_template_hash", "confidence"},
    "AI_TEMPLATE_NO_MATCH": {"candidates_checked", "reason_code"},
    "TEMPLATE_MANUALLY_SELECTED": {"ai_template_id", "template_id", "template_version", "source_template_hash"},
    "TEMPLATE_REQUESTED": {"prompt_hash"},
    "AI_TEMPLATE_DRAFTED": {"template_id", "template_version", "template_hash", "prompt_hash"},
    "TEMPLATE_CREATED": {"template_id", "template_version", "template_hash", "origin"},
    "TEMPLATE_DEACTIVATED": {"template_id", "template_version", "reason_code"},
    "TEMPLATE_INSTANTIATED": {"template_id", "template_version", "working_copy_id", "revision", "content_hash"},
    "EXECUTION_TEMPLATE_MODIFIED": {"working_copy_id", "revision", "previous_hash", "content_hash", "changed_fields"},
    "GATE1_APPROVED": {"revision", "approved_template_hash"},
    "GATE1_REJECTED": {"revision"},
    "GATE2_APPROVED": {"document_hash"},
    "GATE2_REJECTED": {"document_hash"},
    "EXECUTION_STARTED": {"approved_template_hash", "executed_template_hash"},
    "ATTACHMENT_EXTRACTED": {"attachment_count", "file_hashes", "extracted_chars"},
    "EXECUTION_CLOSED": {"final_status"},
    "INTEGRATION_CONNECTED": {"integration_id", "channel", "scope_label"},
    "INTEGRATION_DISCONNECTED": {"integration_id", "channel", "scope_label"},
    "AUDIT_INTEGRITY_VERIFIED": {"verification_id", "events_checked", "head_seq", "head_hash"},
    "AUDIT_INTEGRITY_FAILED": {"verification_id", "events_checked", "head_seq", "head_hash", "broken_at_seq"},
    "PROVENANCE_RECORDED": {"provenance_id", "event_count", "lineage_hash", "record_hash"},
}


class TestActions:
    def test_actions_match_the_plan(self):
        assert {a.value for a in AuditAction} == set(PLAN_ACTIONS)
        assert len(AuditAction) == 41

    def test_every_action_has_the_planned_event_type(self):
        assert set(EVENT_TYPES) == set(AuditAction)
        assert {a.value: t.value for a, t in EVENT_TYPES.items()} == PLAN_ACTIONS

    def test_event_types_are_the_seven_from_5_1(self):
        assert {t.value for t in AuditEventTypeEnum} == {
            "USER_ACTION", "AI_DECISION", "SYSTEM_ACTION", "APPROVAL_GATE",
            "STATE_CHANGE", "SECURITY_EVENT", "INTEGRITY_EVENT",
        }


class TestRequiredDetails:
    def test_required_details_models_belong_to_real_actions(self):
        assert set(REQUIRED_DETAILS) <= set(AuditAction)

    def test_required_keys_match_the_plan(self):
        actual = {
            action.value: {f.alias or name for name, f in model.model_fields.items() if f.is_required()}
            for action, model in REQUIRED_DETAILS.items()
        }
        assert actual == PLAN_REQUIRED_KEYS

    def test_source_literal_matches_the_source_enum(self):
        assert set(typing.get_args(SourceName)) == {s.value for s in AuditSourceEnum}


class TestForbiddenKeys:
    @pytest.mark.parametrize("key", [
        "body", "body_text", "content", "raw", "prompt", "prompt_text",
        "password", "token", "secret", "api_key", "credentials",
        "BODY", "Prompt", "API_KEY",
        "bot_token", "access_token", "Refresh_Token", "client_secret", "db_password",
        "openai_api_key", "gmail_credentials",
    ])
    def test_forbidden(self, key):
        assert is_forbidden_key(key)

    @pytest.mark.parametrize("key", [
        "content_hash", "prompt_hash", "body_truncated", "token_count", "raw_hash",
        "template_hash", "tokens", "secretary", "attachment_count",
    ])
    def test_allowed(self, key):
        assert not is_forbidden_key(key)

    def test_found_recursively_in_dicts_and_lists(self):
        details = {"ok": 1, "meta": {"Prompt": "x", "items": [{"fine": 1}, {"bot_token": "y"}]}}
        assert find_forbidden_keys(details) == ["$.meta.Prompt", "$.meta.items[1].bot_token"]


class TestLifecycleConstants:
    def test_final_statuses(self):
        assert FINAL_STATUSES == ("DELIVERED", "REJECTED_GATE1", "REJECTED_GATE2", "UNSUPPORTED", "FAILED")

    def test_gate_order_rules(self):
        assert {a.value: g.value for a, g in REQUIRED_PRIOR_GATE.items()} == {
            "EXECUTION_STARTED": "GATE1_APPROVED",
            "ATTACHMENT_EXTRACTED": "GATE1_APPROVED",
            "AI_CONTENT_GENERATED": "GATE1_APPROVED",
            "DOCUMENT_GENERATED": "GATE1_APPROVED",
            "JOB_DELIVERED": "GATE2_APPROVED",
        }
