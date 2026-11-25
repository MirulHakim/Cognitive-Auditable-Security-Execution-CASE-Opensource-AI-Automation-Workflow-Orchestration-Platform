"""Contract tests for the FastAPI runtime.

They lock the two things a rewrite can silently break:

* the audit digest formula (a hash the Node server produced must verify here),
* the node vocabulary and business rules the editor relies on.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.audit import compute_audit_hash  # noqa: E402
from app.execution.handlers import StepFailed, evaluate_condition  # noqa: E402
from app.rules import validate_business_rules  # noqa: E402
from app.schemas import (  # noqa: E402
    NODE_CATALOGUE,
    WorkflowStep,
    normalise_steps,
    step_to_json,
)

PAYLOAD = {
    "sequence": 7,
    "recordedAt": "2026-11-19T01:02:03.004Z",
    "actorId": "ops-admin",
    "actorRole": "admin",
    "action": "TEMPLATE_CREATED",
    "targetType": "template",
    "targetId": "abc",
    "outcome": "SUCCESS",
    "details": {"z": 1, "a": [True, None, "x"], "nested": {"b": 2, "a": 1}},
}

# Produced by the Node implementation (dist/audit/auditLog.js) for PAYLOAD.
NODE_HASH_TAIL_F = "42726d5b3f9e0cb6dc84a777c01b42d408db9b99362af701254b908591ad0710"
NODE_HASH_GENESIS = "c990c6a1d2bb5cc62ac2a9504b0d1d8722af050dd5eee9da23e1ef0d09ad563b"


def test_audit_hash_matches_the_node_server():
    assert compute_audit_hash(PAYLOAD, "f" * 64) == NODE_HASH_TAIL_F
    assert compute_audit_hash(PAYLOAD, "0" * 64) == NODE_HASH_GENESIS


def test_canonicalisation_ignores_key_order():
    shuffled = dict(PAYLOAD)
    shuffled["details"] = {"nested": {"a": 1, "b": 2}, "a": [True, None, "x"], "z": 1}
    assert compute_audit_hash(shuffled, "f" * 64) == NODE_HASH_TAIL_F


def _step(type_: str, step_id: str = "s1", **extra) -> WorkflowStep:
    return WorkflowStep(
        id=step_id,
        name=extra.pop("name", type_),
        type=type_,  # type: ignore[arg-type]
        description="",
        **extra,
    )


def test_catalogue_has_one_entry_per_step_type():
    types = [node.type for node in NODE_CATALOGUE]
    assert len(types) == len(set(types))
    assert {"trigger_webhook", "llm_agent", "document", "document_reader", "db_query"} <= set(types)
    for node in NODE_CATALOGUE:
        assert node.fields is not None
        assert isinstance(node.defaults, dict)


def test_first_step_must_be_a_trigger_or_a_review():
    issues = validate_business_rules("Flow", [_step("validation")])
    assert any(issue["rule"] == "review-first" for issue in issues)

    trigger_first = validate_business_rules("Flow", [_step("trigger_cron"), _step("validation", "s2")])
    assert trigger_first == []


def test_trigger_must_be_unique_and_first():
    duplicated = validate_business_rules(
        "Flow", [_step("review"), _step("trigger_cron", "s2")]
    )
    assert any(issue["rule"] == "trigger-first" for issue in duplicated)

    twice = validate_business_rules(
        "Flow", [_step("trigger_cron"), _step("trigger_email", "s2")]
    )
    assert any(issue["rule"] == "single-trigger" for issue in twice)


def test_approval_needs_a_validation_before_it():
    issues = validate_business_rules("Flow", [_step("review"), _step("approval", "s2")])
    assert any(issue["rule"] == "approval-after-validation" for issue in issues)

    ok = validate_business_rules(
        "Flow", [_step("review"), _step("validation", "s2"), _step("approval", "s3")]
    )
    assert ok == []


def test_terminal_connectors_close_the_chain():
    issues = validate_business_rules(
        "Flow", [_step("review"), _step("gmail", "s2"), _step("document", "s3")]
    )
    assert any(issue["rule"] == "terminal-last" for issue in issues)


def test_db_query_table_must_be_allowlisted():
    step = _step("db_query", config={"table": "pg_shadow"})
    issues = validate_business_rules("Flow", [_step("review"), step])
    assert any(issue["rule"] == "query-table" for issue in issues)


def test_step_round_trip_keeps_config():
    step = _step(
        "llm_agent",
        name="Reason",
        config={"model": "qwen3.5:9b", "instruction": "Summarise"},
    )
    stored = step_to_json(step)
    assert stored["type"] == "llm_agent"
    assert stored["config"]["model"] == "qwen3.5:9b"
    assert normalise_steps([step])[0]["config"]["instruction"] == "Summarise"


@pytest.mark.parametrize(
    ("expression", "expected"),
    [
        ("amount > 400", True),
        ("amount < 400", False),
        ("complainant != ''", True),
        ("status == 'approved'", True),
        ("email contains '@'", True),
    ],
)
def test_condition_evaluator(expression, expected):
    case = {
        "amount": "450",
        "complainant": "Ahmad",
        "status": "approved",
        "email": "a@b.co",
    }
    matched, _key = evaluate_condition(expression, case)
    assert matched is expected


def test_condition_evaluator_rejects_nonsense():
    with pytest.raises(StepFailed):
        evaluate_condition("this is not a comparison", {})
