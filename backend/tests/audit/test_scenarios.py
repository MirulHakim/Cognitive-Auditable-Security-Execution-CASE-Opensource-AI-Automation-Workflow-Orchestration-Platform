"""Mock scenarios A-E and G, in memory (§10, Phase 4 "done when").

Each one plays a whole request (tests/audit/scenarios.py), seals it, and
checks the lineage. Scenario F (audit failure at approval) needs the
LangGraph graph and is done in Phase 6.
"""

from uuid import UUID

import pytest

from tests.audit.conftest import WS
from tests.audit.scenarios import (TPL_DRAFTED, TPL_LEAVE, TPL_ROOM, scenario_a, scenario_b, scenario_c,
                                   scenario_d, scenario_e, scenario_g)

pytestmark = pytest.mark.anyio


async def seal_and_verify(service, req):
    record = await service.seal_provenance(WS, req.execution_id)
    result = await service.verify_lineage(WS, req.execution_id, actor="u-aud-1", role="AUDITOR")
    return record, result


def actions(req):
    return [e.action for e in req.events]


async def test_a_normal(service):
    req = await scenario_a(service)
    record, result = await seal_and_verify(service, req)
    assert result.is_valid, result.problems
    assert record.decision.template_choice.value == "AI_SUGGESTED"
    assert record.decision.template_id == TPL_LEAVE[0]
    assert [(a.gate, a.decision) for a in record.approvals] == [("GATE1", "APPROVED"), ("GATE2", "APPROVED")]
    assert record.execution.hashes_match is True
    assert record.result.final_status == "DELIVERED"
    # The order the report talks about (§15): attachments read and output made only after Gate 1.
    a = actions(req)
    assert a.index("GATE1_APPROVED") < a.index("ATTACHMENT_EXTRACTED") < a.index("AI_CONTENT_GENERATED") \
        < a.index("GATE2_APPROVED") < a.index("JOB_DELIVERED")


async def test_b_no_match(service):
    req = await scenario_b(service)
    record, result = await seal_and_verify(service, req)
    assert result.is_valid, result.problems
    assert record.decision.classification_outcome.value == "NO_MATCH"
    assert record.decision.ai_suggested_template_id is None
    assert record.approvals == []
    assert record.execution.hashes_match is None          # execution never started
    assert record.result.final_status == "UNSUPPORTED"
    assert "EXECUTION_STARTED" not in actions(req)


async def test_c_operator_switches(service):
    req = await scenario_c(service)
    record, result = await seal_and_verify(service, req)
    assert result.is_valid, result.problems
    assert record.decision.template_choice.value == "OPERATOR_SWITCHED"
    assert record.decision.ai_suggested_template_id == TPL_LEAVE[0]   # X: the AI's choice
    assert record.decision.template_id == TPL_ROOM[0]                 # Y: the operator's choice
    assert record.result.final_status == "DELIVERED"


async def test_d_operator_requests_new_template(service):
    req = await scenario_d(service)
    record, result = await seal_and_verify(service, req)
    assert result.is_valid, result.problems
    assert record.decision.template_choice.value == "OPERATOR_REQUESTED_NEW"
    assert record.decision.template_created_in_request is True
    assert record.decision.template_id == TPL_DRAFTED[0]
    assert [(a.gate, a.decision) for a in record.approvals] == [("GATE1", "APPROVED"), ("GATE2", "APPROVED")]
    # The AI-drafted template still went through both gates (rule 12).
    created = next(e for e in req.events if e.action == "TEMPLATE_CREATED")
    assert created.details["origin"] == "AI_DRAFTED" and created.execution_id == "job-d"


async def test_e_edit_after_gate1_is_refused(service):
    req = await scenario_e(service)
    record, result = await seal_and_verify(service, req)
    assert result.is_valid, result.problems
    assert "EXECUTION_TEMPLATE_MODIFY_REJECTED" in actions(req)
    assert record.decision.working_copy_revision == 2            # the edit before Gate 1 counts
    assert record.decision.final_working_copy_hash == req.copy_hash(2)
    assert record.approvals[0].approved_hash == req.copy_hash(2)
    assert record.execution.approved_template_hash == record.execution.executed_template_hash == req.copy_hash(2)


async def test_g_gate_skipped_is_an_order_violation(service, repo):
    req = await scenario_g(service)
    record, result = await seal_and_verify(service, req)   # sealing does not judge; verifying does
    assert record.result.final_status == "FAILED"
    assert result.status.value == "INVALID"
    (problem,) = result.problems
    document = next(e for e in req.events if e.action == "DOCUMENT_GENERATED")
    assert (problem.reason.value, problem.seq) == ("ORDER_VIOLATION", document.seq)
    logged = (await repo.list_events(UUID(WS)))[-1]
    assert logged.action == "LINEAGE_VERIFICATION_FAILED"


async def test_all_scenarios_in_one_workspace(service, repo):
    # Like the demo: several requests interleaved in one chain, each sealed and valid on its own.
    requests = [await make(service) for make in (scenario_a, scenario_b, scenario_c, scenario_d, scenario_e)]
    for req in requests:
        _, result = await seal_and_verify(service, req)
        assert result.is_valid, (req.execution_id, result.problems)
    chain = await service.verify_chain(WS, actor="u-aud-1", role="AUDITOR")
    assert chain.is_verified
