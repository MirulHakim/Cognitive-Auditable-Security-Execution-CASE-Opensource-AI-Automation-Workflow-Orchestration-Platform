"""PostgresAuditRepository against a real database (§8.1, §10)."""

import asyncio
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from src.audit.canonical import compute_event_hash, format_timestamp
from src.audit.repository import PostgresAuditRepository
from src.audit.service import AuditService
from src.audit.verifier import verify_chain
from src.storage.database import Database
from tests.audit.conftest import event_kwargs
from tests.audit.integration.conftest import run_sql
from tests.audit.test_repository import assert_valid_chain

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def build_chain(service, workspace_id, n=10):
    return [await service.append_event(**event_kwargs(workspace_id=workspace_id, details={"n": i}))
            for i in range(n)]


class TestChainBuilding:
    async def test_empty_workspace(self, pg_repo, ws):
        assert await pg_repo.get_head(UUID(ws)) is None
        assert await pg_repo.list_events(UUID(ws)) == ()

    async def test_stored_events_read_back_unchanged_and_head_follows(self, pg_service, pg_repo, ws):
        appended = await build_chain(pg_service, ws, 5)
        events = await pg_repo.list_events(UUID(ws))
        assert events == tuple(appended)
        assert_valid_chain(events, ws)
        head = await pg_repo.get_head(UUID(ws))
        assert (head.workspace_id, head.last_seq, head.last_hash) == (UUID(ws), 5, events[-1].current_hash)
        assert head.updated_at == events[-1].event_timestamp

    async def test_list_events_seq_range_and_limit(self, pg_service, pg_repo, ws):
        await build_chain(pg_service, ws, 5)
        assert [e.seq for e in await pg_repo.list_events(UUID(ws), from_seq=2, to_seq=4)] == [2, 3, 4]
        assert [e.seq for e in await pg_repo.list_events(UUID(ws), from_seq=4)] == [4, 5]
        assert [e.seq for e in await pg_repo.list_events(UUID(ws), to_seq=1)] == [1]
        assert [e.seq for e in await pg_repo.list_events(UUID(ws), limit=2)] == [1, 2]

    async def test_builder_that_breaks_the_chain_is_rolled_back(self, pg_service, pg_repo, ws):
        event = await pg_service.append_event(**event_kwargs(workspace_id=ws))
        with pytest.raises(RuntimeError, match="does not continue the chain"):
            await pg_repo.append(UUID(ws), lambda head: event)  # replays seq 1 on top of seq 1
        assert len(await pg_repo.list_events(UUID(ws))) == 1
        assert (await pg_repo.get_head(UUID(ws))).last_seq == 1

    async def test_chain_verifies(self, pg_service, pg_repo, ws):
        await build_chain(pg_service, ws)
        result = await verify_chain(pg_repo, UUID(ws))
        assert result.is_verified and result.events_checked == 10 and result.head_seq == 10


class TestRoundTrip:
    """§5.2: a value read back from Postgres must hash to the same value."""

    async def test_hash_is_the_same_after_reading_back_in_another_time_zone(self, pg_urls, ws):
        malaysia = timezone(timedelta(hours=8))
        clock = lambda: datetime(2026, 10, 31, 23, 59, 59, 999999, tzinfo=malaysia)  # noqa: E731
        details = {
            "label": "Permohonan bilik — ✓ 日本",
            "amount": Decimal("12.50"),
            "big": 2**63 + 1,
            "flags": [True, False, None],
            "nested": {"b": 1, "a": {"z": [], "y": {}}},
        }
        async with Database(pg_urls.app, options="-c TimeZone=Asia/Kuala_Lumpur") as kl_db:
            repo = PostgresAuditRepository(kl_db)
            stored = await AuditService(repo, clock=clock).append_event(
                **event_kwargs(workspace_id=ws, details=details))
            (read,) = await repo.list_events(UUID(ws))
            async with kl_db.connection() as conn:
                raw = await (await conn.execute("SELECT event_timestamp FROM audit_events WHERE workspace_id = %s",
                                                (UUID(ws),))).fetchone()

        assert raw[0].utcoffset() == timedelta(hours=8)  # Postgres really answered in Malaysian time
        assert format_timestamp(read.event_timestamp) == "2026-10-31T15:59:59.999999Z"
        assert read.details == stored.details
        assert compute_event_hash(read) == read.current_hash == stored.current_hash


class TestConcurrency:
    async def test_50_parallel_log_event_calls_build_one_chain(self, pg_service, pg_repo, ws):
        await asyncio.gather(*(pg_service.log_event(**event_kwargs(workspace_id=ws, details={"n": i}))
                               for i in range(50)))
        events = await pg_repo.list_events(UUID(ws))
        assert [e.seq for e in events] == list(range(1, 51))
        assert sorted(e.details["n"] for e in events) == list(range(50))
        assert_valid_chain(events, ws)
        assert (await verify_chain(pg_repo, UUID(ws))).is_verified

    async def test_two_separate_pools_still_build_one_chain(self, pg_urls, ws):
        # Like two copies of the app: no shared Python lock, only the advisory lock.
        async with Database(pg_urls.app) as db_a, Database(pg_urls.app) as db_b:
            service_a = AuditService(PostgresAuditRepository(db_a))
            service_b = AuditService(PostgresAuditRepository(db_b))
            await asyncio.gather(*(service.log_event(**event_kwargs(workspace_id=ws, details={"n": i}))
                                   for i in range(20) for service in (service_a, service_b)))
            repo = PostgresAuditRepository(db_a)
            events = await repo.list_events(UUID(ws))
            assert [e.seq for e in events] == list(range(1, 41))
            assert (await verify_chain(repo, UUID(ws))).is_verified

    async def test_workspaces_have_independent_chains(self, pg_service, pg_repo, ws):
        other = str(uuid4())
        await asyncio.gather(*(pg_service.log_event(**event_kwargs(workspace_id=w, details={"n": i}))
                               for i in range(10) for w in (ws, other)))
        for w in (ws, other):
            events = await pg_repo.list_events(UUID(w))
            assert len(events) == 10
            assert_valid_chain(events, w)

    async def test_one_workspace_cannot_read_another(self, pg_service, pg_repo, ws):
        await pg_service.append_event(**event_kwargs(workspace_id=ws))
        other = UUID(str(uuid4()))
        assert await pg_repo.list_events(other) == ()
        assert await pg_repo.get_head(other) is None


class TestVerificationStorage:
    async def test_result_is_stored_with_its_log_event(self, pg_service, pg_repo, ws):
        await build_chain(pg_service, ws, 3)
        result = await pg_service.verify_chain(ws, actor="u-7", role="AUDITOR")
        assert await pg_repo.list_verifications(UUID(ws)) == (result,)
        logged = (await pg_repo.list_events(UUID(ws)))[-1]
        assert logged.action == "AUDIT_INTEGRITY_VERIFIED"
        assert logged.details["verification_id"] == str(result.verification_id)

    async def test_broken_result_is_stored(self, pg_service, pg_repo, pg_urls, ws):
        await build_chain(pg_service, ws, 3)
        run_sql(pg_urls.admin, "DELETE FROM audit_events WHERE workspace_id = %s AND seq = 3", (UUID(ws),),
                bypass_triggers=True)
        await pg_service.verify_chain(ws, actor="u-7", role="AUDITOR")
        (stored,) = await pg_repo.list_verifications(UUID(ws))
        assert (stored.status.value, stored.broken_at_seq, stored.reason.value) == ("BROKEN", 3, "TAIL_TRUNCATED")
        assert (stored.head_seq, stored.last_found_seq) == (3, 2)

    async def test_failed_log_event_means_no_stored_result(self, monkeypatch, pg_service, pg_repo, ws):
        async def failing_log_event(**kwargs):
            raise RuntimeError("audit write failed")

        monkeypatch.setattr(pg_service, "log_event", failing_log_event)
        with pytest.raises(RuntimeError, match="audit write failed"):
            await pg_service.verify_chain(ws, actor="u-7", role="AUDITOR")
        assert await pg_repo.list_verifications(UUID(ws)) == ()


class TestTamperDetection:
    """O2 on real storage: change rows directly in the database, then verify."""

    async def test_edit_without_rehash_is_record_modified(self, pg_service, pg_repo, pg_urls, ws):
        await build_chain(pg_service, ws)
        run_sql(pg_urls.admin, """UPDATE audit_events SET details = '{"n": 99}'
                                  WHERE workspace_id = %s AND seq = 5""", (UUID(ws),), bypass_triggers=True)
        result = await verify_chain(pg_repo, UUID(ws))
        assert (result.status.value, result.broken_at_seq, result.reason.value) == ("BROKEN", 5, "RECORD_MODIFIED")

    async def test_deleted_last_record_is_tail_truncated(self, pg_service, pg_repo, pg_urls, ws):
        await build_chain(pg_service, ws)
        run_sql(pg_urls.admin, "DELETE FROM audit_events WHERE workspace_id = %s AND seq = 10", (UUID(ws),),
                bypass_triggers=True)
        result = await verify_chain(pg_repo, UUID(ws))
        assert (result.broken_at_seq, result.reason.value) == (10, "TAIL_TRUNCATED")
        assert (result.head_seq, result.last_found_seq) == (10, 9)

    async def test_row_inserted_by_the_app_role_outside_log_event(self, pg_service, pg_repo, pg_urls, ws):
        # INSERT is allowed for case_app, so no trigger stops this; the chain head catches it.
        events = await build_chain(pg_service, ws, 3)
        forged = events[-1].model_copy(update={"event_id": uuid4(), "seq": 4,
                                               "previous_hash": events[-1].current_hash})
        forged = forged.model_copy(update={"current_hash": compute_event_hash(forged)})
        run_sql(pg_urls.app,
                "INSERT INTO audit_events SELECT * FROM jsonb_populate_record(NULL::audit_events, %s::jsonb)",
                (forged.model_dump_json(),))
        result = await verify_chain(pg_repo, UUID(ws))
        assert (result.broken_at_seq, result.reason.value) == (4, "INSERTED_OUTSIDE_LOG_EVENT")
