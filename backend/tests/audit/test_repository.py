import asyncio
from uuid import UUID

import pytest

from src.audit.canonical import GENESIS_HASH, compute_event_hash
from src.audit.repository import InMemoryAuditRepository
from tests.audit.conftest import WS, WS_OTHER, event_kwargs

pytestmark = pytest.mark.anyio


def assert_valid_chain(events, workspace_id=WS):
    """Phase 1 stand-in for verify_chain: seq 1..n, links, recomputed hashes."""
    assert [e.seq for e in events] == list(range(1, len(events) + 1))
    previous = GENESIS_HASH
    for event in events:
        assert event.workspace_id == UUID(workspace_id)
        assert event.previous_hash == previous
        assert compute_event_hash(event) == event.current_hash
        previous = event.current_hash
    timestamps = [e.event_timestamp for e in events]
    assert timestamps == sorted(timestamps)


class TestChainBuilding:
    async def test_empty_workspace(self, repo):
        assert await repo.get_head(UUID(WS)) is None
        assert await repo.list_events(UUID(WS)) == ()

    async def test_genesis(self, service):
        event = await service.append_event(**event_kwargs())
        assert event.seq == 1
        assert event.previous_hash == "0" * 64

    async def test_sequential_events_link_and_head_follows(self, service, repo):
        appended = [await service.append_event(**event_kwargs(details={"n": i})) for i in range(5)]
        events = await repo.list_events(UUID(WS))
        assert_valid_chain(events)
        assert [e.current_hash for e in events] == [e.current_hash for e in appended]
        head = await repo.get_head(UUID(WS))
        assert (head.last_seq, head.last_hash) == (5, events[-1].current_hash)
        assert head.updated_at == events[-1].event_timestamp

    async def test_list_events_seq_range(self, service, repo):
        for i in range(5):
            await service.append_event(**event_kwargs(details={"n": i}))
        assert [e.seq for e in await repo.list_events(UUID(WS), from_seq=2, to_seq=4)] == [2, 3, 4]
        assert [e.seq for e in await repo.list_events(UUID(WS), from_seq=4)] == [4, 5]
        assert [e.seq for e in await repo.list_events(UUID(WS), to_seq=1)] == [1]

    async def test_list_events_limit(self, service, repo):
        for i in range(5):
            await service.append_event(**event_kwargs(details={"n": i}))
        assert [e.seq for e in await repo.list_events(UUID(WS), limit=2)] == [1, 2]
        assert [e.seq for e in await repo.list_events(UUID(WS), from_seq=4, limit=10)] == [4, 5]

    async def test_list_events_ordered_by_seq_not_storage_order(self, service, repo):
        for i in range(3):
            await service.append_event(**event_kwargs(details={"n": i}))
        repo._events[UUID(WS)].reverse()
        assert [e.seq for e in await repo.list_events(UUID(WS))] == [1, 2, 3]

    async def test_builder_that_breaks_the_chain_is_refused(self, service, repo):
        event = await service.append_event(**event_kwargs())
        with pytest.raises(RuntimeError, match="does not continue the chain"):
            await repo.append(UUID(WS), lambda head: event)  # replays seq 1 on top of seq 1
        assert len(await repo.list_events(UUID(WS))) == 1


class TestReadsAreCopies:
    async def test_list_events_returns_a_tuple_of_copies(self, service, repo):
        await service.append_event(**event_kwargs(details={"items": [1]}))
        first = await repo.list_events(UUID(WS))
        assert isinstance(first, tuple)
        first[0].details["items"].append(2)
        first[0].details["added"] = True
        (again,) = await repo.list_events(UUID(WS))
        assert again.details == {"items": [1]}
        assert compute_event_hash(again) == again.current_hash

    async def test_returned_event_is_a_copy(self, service, repo):
        returned = await service.append_event(**event_kwargs(details={"items": [1]}))
        returned.details["items"].append(2)
        (stored,) = await repo.list_events(UUID(WS))
        assert stored.details == {"items": [1]}

    async def test_events_are_frozen(self, service):
        event = await service.append_event(**event_kwargs())
        with pytest.raises(Exception):
            event.seq = 99


class TestConcurrency:
    async def test_50_parallel_log_event_calls_build_one_chain(self, service, repo):
        await asyncio.gather(*(service.log_event(**event_kwargs(details={"n": i})) for i in range(50)))
        events = await repo.list_events(UUID(WS))
        assert len(events) == 50
        assert len({e.current_hash for e in events}) == 50
        assert sorted(e.details["n"] for e in events) == list(range(50))
        assert_valid_chain(events)
        assert (await repo.get_head(UUID(WS))).last_seq == 50

    async def test_without_the_lock_the_chain_forks(self, monkeypatch, service, repo):
        # Shows the test above can fail: with a fresh lock per call, every task
        # reads the same head during the yield and they all build seq 1.
        monkeypatch.setattr(repo, "_lock", lambda workspace_id: asyncio.Lock())
        await asyncio.gather(*(service.log_event(**event_kwargs(details={"n": i})) for i in range(5)))
        seqs = [e.seq for e in await repo.list_events(UUID(WS))]
        assert len(seqs) != len(set(seqs))

    async def test_workspaces_have_independent_chains(self, service, repo):
        calls = []
        for i in range(10):
            calls.append(service.log_event(**event_kwargs(details={"n": i})))
            calls.append(service.log_event(**event_kwargs(workspace_id=WS_OTHER, details={"n": i})))
        await asyncio.gather(*calls)
        ours, theirs = await repo.list_events(UUID(WS)), await repo.list_events(UUID(WS_OTHER))
        assert_valid_chain(ours, WS)
        assert_valid_chain(theirs, WS_OTHER)
        assert len(ours) == len(theirs) == 10
        assert ours[0].previous_hash == theirs[0].previous_hash == GENESIS_HASH

    async def test_one_workspace_cannot_read_another(self, service, repo):
        await service.append_event(**event_kwargs())
        assert await repo.list_events(UUID(WS_OTHER)) == ()
        assert await repo.get_head(UUID(WS_OTHER)) is None


class TestSession:
    async def test_in_memory_repository_accepts_and_ignores_session(self, service, repo):
        await service.log_event(**event_kwargs(), session=object())
        assert len(await repo.list_events(UUID(WS))) == 1


def test_repository_is_usable_without_a_running_loop():
    # Locks are created lazily inside append, so constructing outside a loop is fine.
    InMemoryAuditRepository()
