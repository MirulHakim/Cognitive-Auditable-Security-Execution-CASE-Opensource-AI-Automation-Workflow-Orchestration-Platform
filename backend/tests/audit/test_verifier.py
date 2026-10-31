import time
from datetime import timezone
from uuid import UUID, uuid4

import pytest

from src.audit import verifier
from src.audit.canonical import GENESIS_HASH, compute_event_hash
from src.audit.errors import AuditValidationError
from src.audit.repository import ChainHead
from src.audit.verifier import verify_chain
from tests.audit.conftest import WS, WS_OTHER, event_kwargs

pytestmark = pytest.mark.anyio


# ---------------------------------------------------------------------------
# Helpers: build a chain through AuditService, then tamper with the stored
# rows directly, the way someone with database access would.
# ---------------------------------------------------------------------------

async def build_chain(service, n=10, workspace_id=WS):
    return [await service.append_event(**event_kwargs(workspace_id=workspace_id, details={"n": i}))
            for i in range(n)]


def stored(repo, workspace_id=WS):
    return repo._events[UUID(workspace_id)]


def index_of(repo, seq):
    return next(i for i, e in enumerate(stored(repo)) if e.seq == seq)


def rehashed(event):
    return event.model_copy(update={"current_hash": compute_event_hash(event)})


def edit(repo, seq, *, rehash=False, **changes):
    i = index_of(repo, seq)
    event = stored(repo)[i].model_copy(update=changes)
    stored(repo)[i] = rehashed(event) if rehash else event


def delete(repo, seq):
    del stored(repo)[index_of(repo, seq)]


async def verify(repo, **kwargs):
    return await verify_chain(repo, UUID(WS), **kwargs)


def assert_broken(result, seq, reason):
    assert result.status.value == "BROKEN"
    assert (result.broken_at_seq, result.reason.value) == (seq, reason)


# ---------------------------------------------------------------------------
# Intact chains
# ---------------------------------------------------------------------------

class TestIntactChain:
    async def test_empty_workspace_is_verified_with_genesis_head(self, repo):
        result = await verify(repo)
        assert result.status.value == "VERIFIED"
        assert result.events_checked == 0
        assert (result.head_seq, result.head_hash) == (0, GENESIS_HASH)
        assert (result.last_found_seq, result.last_found_hash) == (0, GENESIS_HASH)

    async def test_verified_result_has_head_fields_and_no_break(self, service, repo):
        events = await build_chain(service)
        result = await verify(repo)
        assert result.status.value == "VERIFIED" and result.is_verified
        assert result.events_checked == 10
        assert (result.head_seq, result.head_hash) == (10, events[-1].current_hash)
        assert (result.last_found_seq, result.last_found_hash) == (result.head_seq, result.head_hash)
        assert (result.broken_at_seq, result.reason, result.unverifiable_after) == (None, None, None)

    async def test_result_metadata(self, service, repo):
        await build_chain(service, 1)
        result = await verify(repo, verified_by="u-9", verified_role="AUDITOR")
        assert (result.workspace_id, result.verified_by, result.verified_role.value) == (UUID(WS), "u-9", "AUDITOR")
        assert result.verified_at.tzinfo == timezone.utc
        assert (result.from_seq, result.to_seq) == (1, None)
        assert result.duration_ms >= 0

    async def test_verification_only_reads(self, service, repo):
        await build_chain(service)
        before = (list(stored(repo)), await repo.get_head(UUID(WS)))
        await verify(repo)
        assert (list(stored(repo)), await repo.get_head(UUID(WS))) == before

    async def test_other_workspace_is_not_affected(self, service, repo):
        await build_chain(service)
        await build_chain(service, 3, workspace_id=WS_OTHER)
        edit(repo, 2, details={"n": 99})
        assert (await verify_chain(repo, UUID(WS_OTHER))).status.value == "VERIFIED"


# ---------------------------------------------------------------------------
# Tamper detection (O2, §10)
# ---------------------------------------------------------------------------

class TestTamperDetection:
    async def test_edit_without_rehash_is_record_modified_at_that_seq(self, service, repo):
        await build_chain(service)
        edit(repo, 5, details={"n": 99})
        result = await verify(repo)
        assert_broken(result, 5, "RECORD_MODIFIED")
        assert result.events_checked == 5
        assert result.unverifiable_after == 5  # seq 6..10

    @pytest.mark.parametrize("change", [
        {"actor_id": "u-999"}, {"outcome": "FAILURE"}, {"execution_id": "job-2"}, {"target_id": "job-2"},
    ])
    async def test_any_hashed_field_change_is_detected(self, service, repo, change):
        await build_chain(service)
        edit(repo, 3, **change)
        assert_broken(await verify(repo), 3, "RECORD_MODIFIED")

    async def test_event_id_is_not_hashed(self, service, repo):
        # §5.2: event_id is random and not part of the hash, so changing it is not a break.
        await build_chain(service)
        edit(repo, 3, event_id=uuid4())
        assert (await verify(repo)).status.value == "VERIFIED"

    async def test_edit_with_rehash_is_link_broken_at_next_seq(self, service, repo):
        await build_chain(service)
        edit(repo, 5, rehash=True, details={"n": 99})
        result = await verify(repo)
        assert_broken(result, 6, "LINK_BROKEN")
        assert result.events_checked == 6

    async def test_edit_with_rehash_of_last_record_is_head_mismatch(self, service, repo):
        events = await build_chain(service)
        edit(repo, 10, rehash=True, details={"n": 99})
        result = await verify(repo)
        assert_broken(result, 10, "HEAD_MISMATCH")
        assert result.head_hash == events[-1].current_hash
        assert result.last_found_hash != result.head_hash

    async def test_rebuilding_the_rest_of_the_chain_is_caught_by_the_head(self, service, repo):
        # Edit seq 5 and re-hash every later record so all links match again.
        await build_chain(service)
        edit(repo, 5, rehash=True, details={"n": 99})
        for seq in range(6, 11):
            previous = stored(repo)[index_of(repo, seq - 1)].current_hash
            edit(repo, seq, rehash=True, previous_hash=previous)
        assert_broken(await verify(repo), 10, "HEAD_MISMATCH")

    async def test_delete_middle_is_gap_at_the_missing_seq(self, service, repo):
        await build_chain(service)
        delete(repo, 5)
        result = await verify(repo)
        assert_broken(result, 5, "GAP")
        assert result.events_checked == 4
        assert result.unverifiable_after == 5  # seq 6..10
        assert (result.last_found_seq, result.head_seq) == (10, 10)

    async def test_delete_first_is_gap_at_seq_1(self, service, repo):
        await build_chain(service)
        delete(repo, 1)
        assert_broken(await verify(repo), 1, "GAP")

    async def test_delete_last_is_tail_truncated_with_both_heads(self, service, repo):
        events = await build_chain(service)
        delete(repo, 10)
        result = await verify(repo)
        assert_broken(result, 10, "TAIL_TRUNCATED")
        assert (result.head_seq, result.head_hash) == (10, events[9].current_hash)
        assert (result.last_found_seq, result.last_found_hash) == (9, events[8].current_hash)
        assert result.last_found_seq < result.head_seq
        assert result.events_checked == 9
        assert result.unverifiable_after == 0

    async def test_delete_last_three(self, service, repo):
        await build_chain(service)
        for seq in (8, 9, 10):
            delete(repo, seq)
        result = await verify(repo)
        assert_broken(result, 8, "TAIL_TRUNCATED")
        assert (result.last_found_seq, result.head_seq) == (7, 10)

    async def test_delete_every_record(self, service, repo):
        await build_chain(service, 3)
        stored(repo).clear()
        result = await verify(repo)
        assert_broken(result, 1, "TAIL_TRUNCATED")
        assert (result.last_found_seq, result.last_found_hash, result.head_seq) == (0, GENESIS_HASH, 3)

    async def test_reorder_by_swapping_seq_is_detected(self, service, repo):
        await build_chain(service)
        a, b = index_of(repo, 4), index_of(repo, 5)
        stored(repo)[a] = stored(repo)[a].model_copy(update={"seq": 5})
        stored(repo)[b] = stored(repo)[b].model_copy(update={"seq": 4})
        result = await verify(repo)
        assert result.status.value == "BROKEN"
        assert result.broken_at_seq == 4

    async def test_reorder_with_rehash_is_still_detected(self, service, repo):
        await build_chain(service)
        a, b = index_of(repo, 4), index_of(repo, 5)
        stored(repo)[a], stored(repo)[b] = (rehashed(stored(repo)[a].model_copy(update={"seq": 5})),
                                            rehashed(stored(repo)[b].model_copy(update={"seq": 4})))
        result = await verify(repo)
        assert_broken(result, 4, "LINK_BROKEN")

    async def test_storage_order_alone_does_not_matter(self, service, repo):
        # Rows have no inherent order (Postgres reads ORDER BY seq); only seq counts.
        await build_chain(service)
        stored(repo).reverse()
        assert (await verify(repo)).status.value == "VERIFIED"

    async def test_row_inserted_bypassing_log_event(self, service, repo):
        events = await build_chain(service)
        forged = rehashed(events[-1].model_copy(update={
            "event_id": uuid4(), "seq": 11, "previous_hash": events[-1].current_hash, "details": {"n": 11},
        }))
        stored(repo).append(forged)  # head not advanced
        result = await verify(repo)
        assert_broken(result, 11, "INSERTED_OUTSIDE_LOG_EVENT")
        assert (result.head_seq, result.last_found_seq) == (10, 11)

    async def test_events_without_a_head_are_inserted_outside_log_event(self, service, repo):
        await build_chain(service, 2)
        del repo._heads[UUID(WS)]
        assert_broken(await verify(repo), 1, "INSERTED_OUTSIDE_LOG_EVENT")

    async def test_head_moved_back_is_inserted_outside_log_event(self, service, repo):
        events = await build_chain(service)
        repo._heads[UUID(WS)] = ChainHead(UUID(WS), 8, events[7].current_hash, events[7].event_timestamp)
        assert_broken(await verify(repo), 9, "INSERTED_OUTSIDE_LOG_EVENT")

    async def test_duplicate_seq(self, service, repo):
        events = await build_chain(service)
        stored(repo).append(events[2].model_copy(update={"event_id": uuid4()}))
        assert_broken(await verify(repo), 3, "DUPLICATE_SEQ")

    async def test_stops_at_the_first_break(self, service, repo):
        await build_chain(service)
        edit(repo, 3, details={"n": 99})
        delete(repo, 7)
        result = await verify(repo)
        assert_broken(result, 3, "RECORD_MODIFIED")
        assert result.unverifiable_after == 6  # 4, 5, 6, 8, 9, 10 were found but not checked
        assert result.last_found_seq == 10


# ---------------------------------------------------------------------------
# Seq ranges and batching
# ---------------------------------------------------------------------------

class TestRange:
    async def test_middle_range(self, service, repo):
        await build_chain(service)
        result = await verify(repo, from_seq=3, to_seq=6)
        assert result.status.value == "VERIFIED"
        assert result.events_checked == 4
        assert (result.from_seq, result.to_seq, result.last_found_seq) == (3, 6, 6)

    async def test_range_does_not_look_past_to_seq(self, service, repo):
        await build_chain(service)
        edit(repo, 9, details={"n": 99})
        assert (await verify(repo, to_seq=6)).status.value == "VERIFIED"

    async def test_tamper_inside_the_range(self, service, repo):
        await build_chain(service)
        edit(repo, 4, details={"n": 99})
        assert_broken(await verify(repo, from_seq=3, to_seq=6), 4, "RECORD_MODIFIED")

    async def test_range_links_to_the_record_before_it(self, service, repo):
        await build_chain(service)
        edit(repo, 2, rehash=True, details={"n": 99})
        assert_broken(await verify(repo, from_seq=3), 3, "LINK_BROKEN")

    async def test_missing_record_before_the_range(self, service, repo):
        await build_chain(service)
        delete(repo, 2)
        result = await verify(repo, from_seq=3)
        assert_broken(result, 2, "GAP")
        assert result.events_checked == 0

    async def test_missing_end_of_a_range_below_the_head_is_a_gap(self, service, repo):
        await build_chain(service)
        delete(repo, 6)
        assert_broken(await verify(repo, from_seq=3, to_seq=6), 6, "GAP")

    async def test_range_reaching_the_head_compares_it(self, service, repo):
        await build_chain(service)
        delete(repo, 10)
        assert_broken(await verify(repo, from_seq=5, to_seq=20), 10, "TAIL_TRUNCATED")

    @pytest.mark.parametrize("kwargs", [
        {"from_seq": 0}, {"to_seq": 0}, {"from_seq": 5, "to_seq": 4}, {"from_seq": True}, {"to_seq": "3"},
    ])
    async def test_invalid_range_rejected(self, repo, kwargs):
        with pytest.raises(AuditValidationError) as exc_info:
            await verify(repo, **kwargs)
        assert exc_info.value.code == "INVALID_RANGE"


class TestBatching:
    async def test_reads_in_batches(self, monkeypatch, service, repo):
        monkeypatch.setattr(verifier, "BATCH_SIZE", 3)
        calls = []
        original = repo.list_events

        async def counting(*args, **kwargs):
            calls.append(kwargs)
            return await original(*args, **kwargs)

        monkeypatch.setattr(repo, "list_events", counting)
        await build_chain(service)
        result = await verify(repo)
        assert result.status.value == "VERIFIED" and result.events_checked == 10
        assert [c["from_seq"] for c in calls] == [1, 4, 7, 10]
        assert all(c["limit"] == 3 for c in calls)

    @pytest.mark.parametrize("seq", [3, 4, 9])  # last of a batch, first of a batch, middle
    async def test_breaks_across_batch_boundaries(self, monkeypatch, service, repo, seq):
        monkeypatch.setattr(verifier, "BATCH_SIZE", 3)
        await build_chain(service)
        edit(repo, seq, rehash=True, details={"n": 99})
        assert_broken(await verify(repo), seq + 1, "LINK_BROKEN" if seq < 10 else "HEAD_MISMATCH")

    async def test_gap_on_batch_boundary(self, monkeypatch, service, repo):
        monkeypatch.setattr(verifier, "BATCH_SIZE", 3)
        await build_chain(service)
        delete(repo, 4)
        result = await verify(repo)
        assert_broken(result, 4, "GAP")
        assert result.unverifiable_after == 6


# ---------------------------------------------------------------------------
# AuditService.verify_chain: runs the verifier and logs the result (§5.5)
# ---------------------------------------------------------------------------

class TestServiceVerify:
    async def test_verified_is_logged(self, service, repo):
        events = await build_chain(service, 3)
        result = await service.verify_chain(WS, actor="u-7", role="OPERATOR")
        assert result.is_verified
        logged = (await repo.list_events(UUID(WS)))[-1]
        assert (logged.seq, logged.action, logged.event_type.value) == (4, "AUDIT_INTEGRITY_VERIFIED", "INTEGRITY_EVENT")
        assert (logged.actor_id, logged.actor_role.value, logged.outcome.value) == ("u-7", "OPERATOR", "SUCCESS")
        assert (logged.target_type, logged.target_id, logged.source.value) == ("workspace", WS, "WEB_APP")
        assert logged.execution_id is None
        assert logged.details == {
            "verification_id": str(result.verification_id), "events_checked": 3,
            "head_seq": 3, "head_hash": events[-1].current_hash,
        }

    async def test_broken_is_logged_as_failed(self, service, repo):
        await build_chain(service)
        delete(repo, 10)
        result = await service.verify_chain(WS, actor="u-7", role="AUDITOR")
        logged = (await repo.list_events(UUID(WS)))[-1]
        assert (logged.action, logged.outcome.value) == ("AUDIT_INTEGRITY_FAILED", "FAILURE")
        assert logged.details["broken_at_seq"] == result.broken_at_seq == 10
        assert logged.details["reason"] == "TAIL_TRUNCATED"

    async def test_result_describes_the_chain_before_the_log_event(self, service, repo):
        await build_chain(service, 2)
        result = await service.verify_chain(WS, actor="u-7", role="ADMIN")
        assert (result.head_seq, result.events_checked) == (2, 2)
        assert (await repo.get_head(UUID(WS))).last_seq == 3

    async def test_logged_verification_events_keep_the_chain_valid(self, service, repo):
        await build_chain(service, 2)
        for _ in range(3):
            assert (await service.verify_chain(WS, actor="u-7", role="AUDITOR")).is_verified
        assert (await verify(repo)).events_checked == 5

    async def test_results_are_stored_newest_first(self, service, repo):
        await build_chain(service, 3)
        first = await service.verify_chain(WS, actor="u-7", role="AUDITOR")
        delete(repo, 2)
        second = await service.verify_chain(WS, actor="u-8", role="OPERATOR")
        assert await repo.list_verifications(UUID(WS)) == (second, first)
        assert await repo.list_verifications(UUID(WS), limit=1) == (second,)
        assert await repo.list_verifications(UUID(WS_OTHER)) == ()

    async def test_bad_input_is_not_stored(self, service, repo):
        with pytest.raises(AuditValidationError):
            await service.verify_chain(WS, actor="u-7", role="ROOT")
        assert await repo.list_verifications(UUID(WS)) == ()

    async def test_system_caller(self, service, repo):
        await service.verify_chain(WS, actor="system", role="SYSTEM", source="SYSTEM")
        logged = (await repo.list_events(UUID(WS)))[-1]
        assert (logged.actor_type.value, logged.source.value) == ("SYSTEM", "SYSTEM")

    async def test_range_is_passed_through(self, service):
        await build_chain(service)
        result = await service.verify_chain(WS, actor="u-7", role="AUDITOR", from_seq=2, to_seq=4)
        assert (result.from_seq, result.to_seq, result.events_checked) == (2, 4, 3)

    @pytest.mark.parametrize("kwargs,code", [
        ({"role": "ROOT"}, "INVALID_ROLE"),
        ({"actor": "ain@example.com"}, "INVALID_ACTOR"),
        ({"actor": ""}, "INVALID_ACTOR"),
        ({"source": "FAX"}, "INVALID_SOURCE"),
        ({"workspace_id": "not-a-uuid"}, "INVALID_WORKSPACE"),
        ({"from_seq": 0}, "INVALID_RANGE"),
    ])
    async def test_bad_input_rejected_without_logging(self, service, repo, kwargs, code):
        call = {"workspace_id": WS, "actor": "u-7", "role": "AUDITOR", **kwargs}
        with pytest.raises(AuditValidationError) as exc_info:
            await service.verify_chain(call.pop("workspace_id"), **call)
        assert exc_info.value.code == code
        assert await repo.list_events(UUID(WS)) == ()


# ---------------------------------------------------------------------------
# Performance (§8.3 target: 10,000 events < 2 s)
# ---------------------------------------------------------------------------

async def test_verify_10000_events_under_2_seconds(service, repo):
    await build_chain(service, 10_000)
    started = time.perf_counter()
    result = await verify(repo)
    elapsed = time.perf_counter() - started
    assert result.is_verified and result.events_checked == 10_000
    assert elapsed < 2.0, f"verify_chain took {elapsed:.2f}s for 10,000 events"
