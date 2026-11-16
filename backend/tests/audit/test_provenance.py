"""seal_provenance and the provenance record (§5.4, §8.4, §10 "Provenance")."""

from datetime import datetime, timezone
from uuid import UUID

import pytest

from src.audit.canonical import (RECORD_HASH_FIELDS, canonical_json, compute_lineage_hash, compute_record_hash,
                                 normalize, sha256_hex)
from src.audit.errors import AuditValidationError, ProvenanceError
from src.audit.provenance import derive_template_choice, select_lineage_events
from src.audit.schemas import ProvenanceRecord
from tests.audit.conftest import WS, WS_OTHER
from tests.audit.scenarios import (TPL_DRAFTED, TPL_LEAVE, TPL_ROOM, Request, h, scenario_a, scenario_b,
                                   scenario_c, scenario_d)
from tests.audit.test_verifier import edit

pytestmark = pytest.mark.anyio


async def seal(service, execution_id, workspace_id=WS):
    return await service.seal_provenance(workspace_id, execution_id)


async def all_events(repo, workspace_id=WS):
    return await repo.list_events(UUID(workspace_id))


# ---------------------------------------------------------------------------
# The two hashes (canonical.py)
# ---------------------------------------------------------------------------

class TestHashes:
    def test_lineage_hash_is_sha256_of_the_canonical_list(self):
        hashes = [h("one"), h("two")]
        assert compute_lineage_hash(hashes) == sha256_hex(f'["{hashes[0]}","{hashes[1]}"]')

    def test_lineage_hash_changes_with_order_and_content(self):
        one, two = h("one"), h("two")
        assert compute_lineage_hash([one, two]) != compute_lineage_hash([two, one])
        assert compute_lineage_hash([one, two]) != compute_lineage_hash([one])
        assert compute_lineage_hash((one, two)) == compute_lineage_hash([one, two])

    async def test_record_hash_covers_every_field_except_itself(self, service):
        await scenario_a(service)
        record = await seal(service, "job-a")
        assert set(RECORD_HASH_FIELDS) == set(ProvenanceRecord.model_fields) - {"record_hash"}
        data = record.model_dump()
        assert record.record_hash == sha256_hex(canonical_json({k: data[k] for k in RECORD_HASH_FIELDS}))

    async def test_record_hash_works_on_a_plain_json_copy(self, service):
        # What an auditor holding a JSON export has: plain strings, no models.
        await scenario_a(service)
        record = await seal(service, "job-a")
        exported = normalize(record.model_dump())
        assert compute_record_hash(exported) == record.record_hash
        exported["result"]["final_status"] = "FAILED"
        assert compute_record_hash(exported) != record.record_hash


# ---------------------------------------------------------------------------
# Sealing rules (§8.4)
# ---------------------------------------------------------------------------

class TestSeal:
    async def test_seal_stores_the_record_and_logs_provenance_recorded(self, service, repo):
        req = await scenario_a(service)
        record = await seal(service, "job-a")

        assert await repo.get_provenance(UUID(WS), "job-a") == record
        marker = (await all_events(repo))[-1]
        assert marker.action == "PROVENANCE_RECORDED"
        assert (marker.actor_id, marker.actor_role.value, marker.execution_id) == ("system", "SYSTEM", "job-a")
        assert (marker.target_type, marker.target_id) == ("execution", "job-a")
        assert marker.details == {"provenance_id": str(record.provenance_id), "event_count": len(req.events),
                                  "lineage_hash": record.lineage_hash, "record_hash": record.record_hash}

    async def test_record_lists_every_event_of_the_request_in_seq_order(self, service):
        req = await scenario_a(service)
        record = await seal(service, "job-a")
        assert record.event_ids == [e.event_id for e in req.events]
        assert record.event_hashes == [e.current_hash for e in req.events]
        assert record.lineage_hash == compute_lineage_hash(record.event_hashes)
        assert record.record_hash == compute_record_hash(record)
        assert (record.workspace_id, record.execution_id) == (UUID(WS), "job-a")
        assert record.sealed_at.tzinfo is timezone.utc

    async def test_provenance_recorded_is_not_in_its_own_lineage(self, service, repo):
        await scenario_a(service)
        record = await seal(service, "job-a")
        marker = (await all_events(repo))[-1]
        assert marker.event_id not in record.event_ids
        assert marker.current_hash not in record.event_hashes

    async def test_sealed_once_second_call_returns_the_same_record(self, service, repo):
        await scenario_a(service)
        first = await seal(service, "job-a")
        count = len(await all_events(repo))
        second = await seal(service, "job-a")
        assert second == first
        assert len(await all_events(repo)) == count  # no second PROVENANCE_RECORDED

    async def test_refuses_without_execution_closed(self, service, repo):
        req = Request(service, "job-open")
        await req.received()
        await req.ai_selected()
        with pytest.raises(ProvenanceError) as exc:
            await seal(service, "job-open")
        assert exc.value.code == "NOT_CLOSED"
        assert await repo.get_provenance(UUID(WS), "job-open") is None

    async def test_refuses_an_unknown_request(self, service):
        with pytest.raises(ProvenanceError) as exc:
            await seal(service, "job-never-seen")
        assert exc.value.code == "NOT_CLOSED"

    async def test_refuses_two_execution_closed(self, service):
        req = await scenario_b(service)
        await req.closed("UNSUPPORTED")
        with pytest.raises(ProvenanceError) as exc:
            await seal(service, "job-b")
        assert exc.value.code == "NOT_CLOSED" and "2 EXECUTION_CLOSED" in str(exc.value)

    async def test_refuses_on_a_broken_chain_and_logs_integrity_failed(self, service, repo):
        req = await scenario_a(service)
        edit(repo, req.events[3].seq, actor_id="someone-else")  # changed without re-hashing
        with pytest.raises(ProvenanceError) as exc:
            await seal(service, "job-a")
        assert exc.value.code == "CHAIN_BROKEN"
        assert await repo.get_provenance(UUID(WS), "job-a") is None

        failed = (await all_events(repo))[-1]
        assert failed.action == "AUDIT_INTEGRITY_FAILED"
        assert (failed.details["broken_at_seq"], failed.details["reason"]) == (req.events[3].seq, "RECORD_MODIFIED")
        (stored,) = await repo.list_verifications(UUID(WS))
        assert stored.broken_at_seq == req.events[3].seq

    async def test_break_after_execution_closed_does_not_block_sealing(self, service, repo):
        # Only the chain up to EXECUTION_CLOSED has to be intact for this request.
        await scenario_a(service)
        other = await scenario_b(service, "job-later")
        edit(repo, other.events[0].seq, actor_id="someone-else")
        record = await seal(service, "job-a")
        assert record.result.final_status == "DELIVERED"

    async def test_only_events_up_to_execution_closed_are_included(self, service):
        req = await scenario_a(service)
        await req.log("JOB_DELIVERED", {"note_code": "LATE_RETRY"})  # logged after closing
        record = await seal(service, "job-a")
        assert len(record.event_ids) == len(req.events) - 1
        assert record.event_ids[-1] == req.events[-2].event_id  # EXECUTION_CLOSED

    async def test_other_requests_and_workspaces_are_left_out(self, service):
        await scenario_c(service, "job-x")
        req = await scenario_a(service)
        await Request(service, "job-a", workspace_id=WS_OTHER).received()  # same id, other workspace
        record = await seal(service, "job-a")
        assert record.event_ids == [e.event_id for e in req.events]

    async def test_workspaces_are_sealed_separately(self, service):
        await scenario_a(service)
        other = Request(service, "job-a", workspace_id=WS_OTHER)
        await other.received()
        await other.closed("FAILED")
        mine = await seal(service, "job-a")
        theirs = await seal(service, "job-a", workspace_id=WS_OTHER)
        assert mine.provenance_id != theirs.provenance_id
        assert theirs.result.final_status == "FAILED" and len(theirs.event_ids) == 2

    @pytest.mark.parametrize("workspace_id,execution_id,code", [
        ("not-a-uuid", "job-a", "INVALID_WORKSPACE"),
        (WS, "bad id with spaces", "INVALID_EXECUTION_ID"),
        (WS, "", "INVALID_EXECUTION_ID"),
    ])
    async def test_bad_arguments_rejected(self, service, workspace_id, execution_id, code):
        with pytest.raises(AuditValidationError) as exc:
            await service.seal_provenance(workspace_id, execution_id)
        assert exc.value.code == code


# ---------------------------------------------------------------------------
# What goes into the record (§5.4)
# ---------------------------------------------------------------------------

class TestRecordContents:
    async def test_normal_request(self, service):
        req = await scenario_a(service)
        record = await seal(service, "job-a")

        assert record.objective.model_dump() == {
            "source": record.objective.source, "request_ref": "msg-job-a", "intent_label": "leave application",
            "std_message_output_hash": h("std-job-a")}
        assert record.objective.source.value == "GMAIL"

        d = record.decision
        assert (d.classification_outcome.value, d.ai_suggested_template_id) == ("SELECTED", "tpl-leave")
        assert d.template_choice.value == "AI_SUGGESTED"
        assert (d.template_id, d.template_version, d.source_template_hash) == TPL_LEAVE
        assert (d.template_created_in_request, d.ai_confidence) == (False, "0.87")
        assert (d.working_copy_revision, d.final_working_copy_hash) == (1, req.copy_hash(1))

        gate1, gate2 = record.approvals
        assert (gate1.gate, gate1.decision, gate1.by, gate1.role.value) == ("GATE1", "APPROVED", "u-op-1", "OPERATOR")
        assert (gate1.approved_hash, gate1.comment_hash) == (req.copy_hash(1), h("looks fine"))
        assert (gate2.gate, gate2.decision, gate2.approved_hash) == ("GATE2", "APPROVED", req.document_hash)
        assert gate1.at < gate2.at

        assert record.execution.model_dump() == {"approved_template_hash": req.copy_hash(1),
                                                 "executed_template_hash": req.copy_hash(1), "hashes_match": True}
        assert record.result.model_dump() == {"final_status": "DELIVERED", "recipient_hash": h("student@example"),
                                              "document_hash": req.document_hash}

    async def test_no_match_request_has_no_execution(self, service):
        await scenario_b(service)
        record = await seal(service, "job-b")
        d = record.decision
        assert (d.classification_outcome.value, d.ai_suggested_template_id, d.template_id) == ("NO_MATCH", None, None)
        assert d.ai_confidence is None
        assert record.approvals == []
        assert record.execution.model_dump() == {"approved_template_hash": None, "executed_template_hash": None,
                                                 "hashes_match": None}
        assert record.result.final_status == "UNSUPPORTED"
        assert (record.result.recipient_hash, record.result.document_hash) == (None, None)

    async def test_approved_and_executed_hash_differ(self, service):
        req = Request(service, "job-x")
        await req.received()
        await req.ai_selected()
        await req.instantiated()
        await req.gate1_approved()
        await req.execution_started(approved=req.copy_hash(1), executed=h("something else"))
        await req.closed("FAILED")
        record = await seal(service, "job-x")  # sealing records it; verify_lineage reports it
        assert record.execution.hashes_match is False
        assert record.execution.executed_template_hash == h("something else")

    async def test_rejections_are_recorded_with_no_approved_hash(self, service):
        req = Request(service, "job-r")
        await req.received()
        await req.ai_selected()
        await req.instantiated()
        await req.gate1_rejected()
        await req.closed("REJECTED_GATE1")
        record = await seal(service, "job-r")
        (approval,) = record.approvals
        assert (approval.gate, approval.decision, approval.approved_hash) == ("GATE1", "REJECTED", None)
        assert record.result.final_status == "REJECTED_GATE1"

    async def test_minimal_request_seals_with_nulls(self, service):
        # Only the closing event: every optional part is null, nothing crashes.
        req = Request(service, "job-min")
        await req.closed("FAILED")
        record = await seal(service, "job-min")
        assert record.objective.source.value == "SYSTEM"
        assert (record.objective.request_ref, record.objective.std_message_output_hash) == (None, None)
        assert record.decision.classification_outcome is None
        assert len(record.event_ids) == 1

    async def test_odd_free_form_details_are_treated_as_missing(self, service):
        req = Request(service, "job-odd")
        await req.log("JOB_RECEIVED", {"request_ref": 12345}, source="TELEGRAM")
        await req.log("DOCUMENT_GENERATED", {"document_hash": "not-a-hash"})
        await req.closed("FAILED")
        record = await seal(service, "job-odd")
        assert record.objective.request_ref is None and record.objective.source.value == "TELEGRAM"
        assert record.result.document_hash is None

    async def test_no_content_only_ids_labels_and_hashes(self, service):
        await scenario_d(service)
        record = await seal(service, "job-d")
        text = canonical_json(record.model_dump())
        for word in ("prompt", "body", "content\"", "@"):
            assert word not in text


# ---------------------------------------------------------------------------
# template_choice (§5.4)
# ---------------------------------------------------------------------------

class TestTemplateChoice:
    async def test_ai_suggested(self, service):
        await scenario_a(service)
        assert (await seal(service, "job-a")).decision.template_choice.value == "AI_SUGGESTED"

    async def test_operator_switched_records_both_templates(self, service):
        await scenario_c(service)
        d = (await seal(service, "job-c")).decision
        assert d.template_choice.value == "OPERATOR_SWITCHED"
        assert d.ai_suggested_template_id == TPL_LEAVE[0]               # what the AI said (X)
        assert (d.template_id, d.template_version, d.source_template_hash) == TPL_ROOM  # what was used (Y)

    async def test_operator_requested_new(self, service):
        await scenario_d(service)
        d = (await seal(service, "job-d")).decision
        assert d.template_choice.value == "OPERATOR_REQUESTED_NEW"
        assert (d.template_id, d.template_version, d.source_template_hash) == TPL_DRAFTED
        assert d.template_created_in_request is True
        assert d.classification_outcome.value == "NO_MATCH"

    async def test_the_operators_last_choice_counts(self, service):
        req = Request(service, "job-both")
        await req.ai_selected()
        await req.template_requested()
        await req.manually_selected(TPL_ROOM)
        assert derive_template_choice(req.events).value == "OPERATOR_SWITCHED"
        await req.template_requested()
        assert derive_template_choice(req.events).value == "OPERATOR_REQUESTED_NEW"


# ---------------------------------------------------------------------------
# select_lineage_events on its own
# ---------------------------------------------------------------------------

async def test_select_lineage_events_sorts_by_seq(service):
    req = await scenario_b(service)
    shuffled = list(reversed(req.events))
    assert [e.seq for e in select_lineage_events(shuffled)] == [e.seq for e in req.events]
