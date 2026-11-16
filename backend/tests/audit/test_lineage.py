"""verify_lineage (§8.5, §10 "Provenance"): checks 1-7, every problem reported.

Tampering is done the way someone with database access would: by editing
the stored rows directly (repo._events / repo._provenance).
"""

from uuid import UUID, uuid4

import pytest

from src.audit.canonical import compute_lineage_hash, compute_record_hash
from src.audit.errors import AuditValidationError, ProvenanceError
from src.audit.repository import ChainHead
from src.audit.schemas import TemplateChoiceEnum
from src.audit.verifier import find_gate_order_violations, verify_lineage
from tests.audit.conftest import WS
from tests.audit.scenarios import Request, h, scenario_a
from tests.audit.test_verifier import delete, edit

pytestmark = pytest.mark.anyio


async def sealed_a(service):
    req = await scenario_a(service)
    record = await service.seal_provenance(WS, "job-a")
    return req, record


async def check(repo, execution_id="job-a"):
    return await verify_lineage(repo, UUID(WS), execution_id)


def reasons(result):
    return [p.reason.value for p in result.problems]


def replace_record(repo, record, *, rehash=False, **changes):
    """Overwrite the stored provenance record (rehash=True also fixes record_hash)."""
    changed = record.model_copy(update=changes)
    if rehash:
        changed = changed.model_copy(update={"record_hash": compute_record_hash(changed)})
    repo._provenance[(UUID(WS), record.execution_id)] = changed
    return changed


# ---------------------------------------------------------------------------
# Untouched
# ---------------------------------------------------------------------------

class TestValid:
    async def test_sealed_request_verifies(self, service, repo):
        req, record = await sealed_a(service)
        result = await check(repo)
        assert result.status.value == "VALID" and result.is_valid
        assert result.problems == []
        assert result.events_checked == len(req.events)
        assert (result.workspace_id, result.execution_id, result.provenance_id) == (UUID(WS), "job-a",
                                                                                   record.provenance_id)

    async def test_events_logged_after_sealing_do_not_matter(self, service, repo):
        await sealed_a(service)
        await Request(service, "job-a").log("JOB_DELIVERED", {"note_code": "LATE"})
        await scenario_a(service, "job-next")
        assert (await check(repo)).is_valid

    async def test_not_sealed_is_refused(self, service, repo):
        await scenario_a(service)
        with pytest.raises(ProvenanceError) as exc:
            await check(repo)
        assert exc.value.code == "NOT_SEALED"


# ---------------------------------------------------------------------------
# Checks 1-5: the record and its events
# ---------------------------------------------------------------------------

class TestTamper:
    async def test_changed_provenance_field_gives_record_hash_mismatch(self, service, repo):
        _, record = await sealed_a(service)
        replace_record(repo, record, result=record.result.model_copy(update={"final_status": "REJECTED_GATE2"}))
        result = await check(repo)
        assert reasons(result) == ["RECORD_HASH_MISMATCH"]

    async def test_changed_field_with_new_record_hash_is_caught_by_provenance_recorded(self, service, repo):
        # Attacker fixes record_hash too; the PROVENANCE_RECORDED event (in the chain) still has the old one.
        _, record = await sealed_a(service)
        replace_record(repo, record, rehash=True,
                       decision=record.decision.model_copy(
                           update={"template_choice": TemplateChoiceEnum.OPERATOR_SWITCHED}))
        assert reasons(await check(repo)) == ["PROVENANCE_EVENT_MISMATCH"]

    async def test_included_event_edited_without_rehash(self, service, repo):
        req, _ = await sealed_a(service)
        target = req.events[4]
        edit(repo, target.seq, actor_id="someone-else")
        result = await check(repo)
        assert reasons(result) == ["EVENT_MODIFIED", "CHAIN_BROKEN"]
        modified, broken = result.problems
        assert (modified.seq, modified.event_id) == (target.seq, target.event_id)
        assert (broken.seq, broken.detail) == (target.seq, "RECORD_MODIFIED")

    async def test_included_event_edited_and_rehashed(self, service, repo):
        req, _ = await sealed_a(service)
        target = req.events[4]
        edit(repo, target.seq, rehash=True, details={**target.details, "comment_hash": h("changed")})
        result = await check(repo)
        assert reasons(result) == ["EVENT_MODIFIED", "CHAIN_BROKEN"]
        assert result.problems[0].seq == target.seq
        assert (result.problems[1].seq, result.problems[1].detail) == (target.seq + 1, "LINK_BROKEN")

    async def test_missing_event_is_reported(self, service, repo):
        req, _ = await sealed_a(service)
        target = next(e for e in req.events if e.action == "GATE1_SUBMITTED")
        delete(repo, target.seq)
        result = await check(repo)
        assert reasons(result) == ["EVENT_MISSING", "CHAIN_BROKEN"]
        assert result.problems[0].event_id == target.event_id
        assert (result.problems[1].seq, result.problems[1].detail) == (target.seq, "GAP")
        assert result.events_checked == len(req.events) - 1

    async def test_deleting_the_gate1_approval_also_shows_order_violations(self, service, repo):
        # Hiding the approval does not make the request look clean: every step after it now
        # appears to have run without Gate 1.
        req, _ = await sealed_a(service)
        approval = next(e for e in req.events if e.action == "GATE1_APPROVED")
        delete(repo, approval.seq)
        result = await check(repo)
        assert reasons(result) == ["EVENT_MISSING", "CHAIN_BROKEN"] + ["ORDER_VIOLATION"] * 4

    async def test_changed_event_hash_list_gives_lineage_hash_mismatch(self, service, repo):
        _, record = await sealed_a(service)
        hashes = list(record.event_hashes)
        hashes[0] = h("forged")
        replace_record(repo, record, rehash=True, event_hashes=hashes)
        result = await check(repo)
        # The listed hash no longer matches the event, the list no longer matches lineage_hash,
        # and PROVENANCE_RECORDED still holds the original record_hash.
        assert reasons(result) == ["EVENT_MODIFIED", "LINEAGE_HASH_MISMATCH", "PROVENANCE_EVENT_MISMATCH"]

    async def test_dropping_an_event_from_the_record_is_caught(self, service, repo):
        # Hide an event from the record and redo both hashes: the chain event still disagrees.
        _, record = await sealed_a(service)
        ids, hashes = list(record.event_ids[1:]), list(record.event_hashes[1:])
        replace_record(repo, record, rehash=True, event_ids=ids, event_hashes=hashes,
                       lineage_hash=compute_lineage_hash(hashes))
        assert reasons(await check(repo)) == ["PROVENANCE_EVENT_MISMATCH"]

    async def test_provenance_recorded_deleted(self, service, repo):
        await sealed_a(service)
        marker_seq = (await repo.get_head(UUID(WS))).last_seq
        delete(repo, marker_seq)
        # A careful attacker also moves the head back, so the chain itself still verifies.
        last = repo._events[UUID(WS)][-1]
        repo._heads[UUID(WS)] = ChainHead(workspace_id=UUID(WS), last_seq=last.seq, last_hash=last.current_hash,
                                          updated_at=last.event_timestamp)
        assert reasons(await check(repo)) == ["PROVENANCE_EVENT_MISSING"]

    async def test_every_problem_is_reported_not_only_the_first(self, service, repo):
        req, record = await sealed_a(service)
        delete(repo, req.events[2].seq)
        edit(repo, req.events[6].seq, actor_id="someone-else")
        replace_record(repo, record, sealed_at=record.sealed_at.replace(year=2030))
        result = await check(repo)
        assert set(reasons(result)) >= {"RECORD_HASH_MISMATCH", "EVENT_MISSING", "EVENT_MODIFIED", "CHAIN_BROKEN"}
        assert result.status.value == "INVALID"


# ---------------------------------------------------------------------------
# Check 6: approved vs executed template
# ---------------------------------------------------------------------------

async def test_approved_not_equal_executed_is_reported(service, repo):
    req = Request(service, "job-x")
    await req.received()
    await req.ai_selected()
    await req.instantiated()
    await req.gate1_approved()
    started = await req.execution_started(approved=req.copy_hash(1), executed=h("swapped template"))
    await req.closed("FAILED")
    await service.seal_provenance(WS, "job-x")
    result = await check(repo, "job-x")
    assert reasons(result) == ["TEMPLATE_HASH_MISMATCH"]
    assert (result.problems[0].seq, result.problems[0].event_id) == (started.seq, started.event_id)


# ---------------------------------------------------------------------------
# Check 7: gate order
# ---------------------------------------------------------------------------

class TestGateOrder:
    async def test_document_generated_before_gate1_approved(self, service, repo):
        req = Request(service, "job-g")
        await req.ai_selected()
        doc = await req.document_generated()
        await req.gate1_approved()
        await req.closed("FAILED")
        await service.seal_provenance(WS, "job-g")
        result = await check(repo, "job-g")
        assert reasons(result) == ["ORDER_VIOLATION"]
        assert result.problems[0].seq == doc.seq
        assert result.problems[0].detail == "DOCUMENT_GENERATED before GATE1_APPROVED"

    async def test_job_delivered_without_gate2_approved(self, service, repo):
        req = Request(service, "job-nog2")
        await req.gate1_approved()
        await req.document_generated()
        await req.gate2_rejected()            # a rejection is not an approval
        delivered = await req.delivered()
        await req.closed("DELIVERED")
        await service.seal_provenance(WS, "job-nog2")
        result = await check(repo, "job-nog2")
        assert reasons(result) == ["ORDER_VIOLATION"]
        assert result.problems[0].seq == delivered.seq
        assert result.problems[0].detail == "JOB_DELIVERED before GATE2_APPROVED"

    async def test_every_step_needing_gate1_is_checked(self, service):
        req = Request(service, "job-all")
        for step in (req.execution_started, req.attachment_extracted, req.content_generated, req.document_generated):
            await step()
        problems = find_gate_order_violations(req.events)
        assert [p.detail.split()[0] for p in problems] == [
            "EXECUTION_STARTED", "ATTACHMENT_EXTRACTED", "AI_CONTENT_GENERATED", "DOCUMENT_GENERATED"]

    async def test_order_is_by_seq_not_by_list_position(self, service):
        req = Request(service, "job-order")
        await req.gate1_approved()
        await req.document_generated()
        assert find_gate_order_violations(list(reversed(req.events))) == []

    async def test_gate_from_another_request_does_not_count(self, service, repo):
        other = Request(service, "job-other")
        await other.gate1_approved()
        req = Request(service, "job-alone")
        await req.document_generated()
        await req.closed("FAILED")
        await service.seal_provenance(WS, "job-alone")
        assert reasons(await check(repo, "job-alone")) == ["ORDER_VIOLATION"]


# ---------------------------------------------------------------------------
# AuditService.verify_lineage: logs the result
# ---------------------------------------------------------------------------

class TestServiceLogging:
    async def test_valid_logs_lineage_verified(self, service, repo):
        _, record = await sealed_a(service)
        result = await service.verify_lineage(WS, "job-a", actor="u-aud-1", role="AUDITOR")
        assert result.is_valid
        logged = (await repo.list_events(UUID(WS)))[-1]
        assert (logged.action, logged.outcome.value, logged.actor_id) == ("LINEAGE_VERIFIED", "SUCCESS", "u-aud-1")
        assert logged.execution_id == "job-a"
        assert logged.details == {"verification_id": str(result.verification_id),
                                  "provenance_id": str(record.provenance_id),
                                  "events_checked": result.events_checked, "problem_count": 0, "problems": []}

    async def test_invalid_logs_lineage_verification_failed_with_codes_only(self, service, repo):
        req, _ = await sealed_a(service)
        edit(repo, req.events[4].seq, actor_id="someone-else")
        result = await service.verify_lineage(WS, "job-a", actor="u-op-1", role="OPERATOR")
        assert not result.is_valid
        logged = (await repo.list_events(UUID(WS)))[-1]
        assert (logged.action, logged.outcome.value) == ("LINEAGE_VERIFICATION_FAILED", "FAILURE")
        assert logged.details["problem_count"] == 2
        assert logged.details["problems"] == [{"reason": "EVENT_MODIFIED", "seq": req.events[4].seq},
                                              {"reason": "CHAIN_BROKEN", "seq": req.events[4].seq}]

    async def test_verifying_twice_stays_valid(self, service):
        # The LINEAGE_VERIFIED event of the first run is after PROVENANCE_RECORDED: not in the lineage.
        await sealed_a(service)
        assert (await service.verify_lineage(WS, "job-a", actor="u-1", role="ADMIN")).is_valid
        assert (await service.verify_lineage(WS, "job-a", actor="u-1", role="ADMIN")).is_valid

    async def test_not_sealed_logs_nothing(self, service, repo):
        await scenario_a(service)
        count = len(await repo.list_events(UUID(WS)))
        with pytest.raises(ProvenanceError):
            await service.verify_lineage(WS, "job-a", actor="u-1", role="ADMIN")
        assert len(await repo.list_events(UUID(WS))) == count

    @pytest.mark.parametrize("overrides,code", [
        ({"role": "BOSS"}, "INVALID_ROLE"),
        ({"actor": "me@example.com"}, "INVALID_ACTOR"),
        ({"source": "FAX"}, "INVALID_SOURCE"),
        ({"execution_id": "bad id"}, "INVALID_EXECUTION_ID"),
    ])
    async def test_bad_arguments_rejected(self, service, overrides, code):
        kwargs = {"workspace_id": WS, "execution_id": "job-a", "actor": "u-1", "role": "ADMIN", **overrides}
        with pytest.raises(AuditValidationError) as exc:
            await service.verify_lineage(**kwargs)
        assert exc.value.code == code


async def test_unknown_provenance_id_marker_is_not_used(service, repo):
    # A PROVENANCE_RECORDED for some other record id does not satisfy check 5.
    _, record = await sealed_a(service)
    replace_record(repo, record, rehash=True, provenance_id=uuid4())
    assert reasons(await check(repo)) == ["PROVENANCE_EVENT_MISSING"]
