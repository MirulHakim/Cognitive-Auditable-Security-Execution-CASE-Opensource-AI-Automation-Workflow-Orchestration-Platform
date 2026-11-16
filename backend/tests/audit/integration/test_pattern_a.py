"""Pattern A: shared transaction (§8.2).

The caller (here a stand-in for Amirul's whitelist) opens a transaction,
makes its change, calls log_event(..., session=tx) as the last step, then
commits. The change and its audit event are saved together or not at all.
"""

import asyncio
from datetime import datetime
from uuid import UUID, uuid4

import psycopg
import pytest

from src.audit.errors import AuditValidationError
from src.audit.repository import PostgresAuditRepository
from src.audit.service import AuditService
from tests.audit.conftest import HASH_A, event_kwargs
from tests.audit.integration.conftest import run_sql

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


async def add_to_whitelist(tx, ws, audit, details=None):
    """What the whitelist code would do: change first, audit event last."""
    entry_id = uuid4()
    await tx.execute("INSERT INTO whitelist_entries VALUES (%s, %s, %s)", (entry_id, UUID(ws), HASH_A))
    await audit.log_event(workspace_id=ws, actor="u-1", role="ADMIN", action="WHITELIST_ADDED",
                          target=f"whitelist:{entry_id}", source="WEB_APP", outcome="SUCCESS",
                          details=details or {"sender_hash": HASH_A}, session=tx)


def whitelist_count(pg_urls, ws):
    return run_sql(pg_urls.app, "SELECT count(*) FROM whitelist_entries WHERE workspace_id = %s", (UUID(ws),))[0][0]


async def test_change_and_event_are_committed_together(db, pg_service, pg_repo, pg_urls, ws):
    async with db.transaction() as tx:
        await add_to_whitelist(tx, ws, pg_service)
    assert whitelist_count(pg_urls, ws) == 1
    (event,) = await pg_repo.list_events(UUID(ws))
    assert (event.seq, event.action) == (1, "WHITELIST_ADDED")


async def test_audit_does_not_commit_the_callers_transaction(db, pg_service, pg_repo, pg_urls, ws):
    async with db.transaction() as tx:
        await add_to_whitelist(tx, ws, pg_service)
        # Other connections cannot see either write until the caller commits.
        assert await pg_repo.list_events(UUID(ws)) == ()
        assert whitelist_count(pg_urls, ws) == 0
    assert len(await pg_repo.list_events(UUID(ws))) == 1
    assert whitelist_count(pg_urls, ws) == 1


async def test_rejected_event_rolls_back_the_change(db, pg_service, pg_repo, pg_urls, ws):
    with pytest.raises(AuditValidationError):
        async with db.transaction() as tx:
            await add_to_whitelist(tx, ws, pg_service, details={"token": "secret"})  # forbidden key
    assert whitelist_count(pg_urls, ws) == 0
    assert await pg_repo.list_events(UUID(ws)) == ()


async def test_audit_failure_inside_the_database_rolls_back_the_change(db, pg_urls, ws):
    # The naive clock fails inside append, after the advisory lock was taken.
    broken = AuditService(PostgresAuditRepository(db), clock=lambda: datetime(2026, 10, 31))
    with pytest.raises(RuntimeError, match="timezone-aware"):
        async with db.transaction() as tx:
            await add_to_whitelist(tx, ws, broken)
    assert whitelist_count(pg_urls, ws) == 0
    # The lock was released by the rollback and no seq was used up.
    event = await AuditService(PostgresAuditRepository(db)).append_event(**event_kwargs(workspace_id=ws))
    assert event.seq == 1


async def test_failure_after_log_event_rolls_back_both(db, pg_service, pg_repo, pg_urls, ws):
    with pytest.raises(RuntimeError, match="later step failed"):
        async with db.transaction() as tx:
            await add_to_whitelist(tx, ws, pg_service)
            raise RuntimeError("later step failed")
    assert whitelist_count(pg_urls, ws) == 0
    assert await pg_repo.list_events(UUID(ws)) == ()
    assert await pg_repo.get_head(UUID(ws)) is None


async def test_chain_lock_is_held_until_the_caller_commits(db, pg_service, pg_urls, ws):
    # Why log_event should be the LAST step: other writers to this workspace wait meanwhile.
    async with db.transaction() as tx:
        await add_to_whitelist(tx, ws, pg_service)
        waiting = asyncio.create_task(pg_service.append_event(**event_kwargs(workspace_id=ws)))
        await asyncio.sleep(0.3)
        assert not waiting.done()
    assert (await asyncio.wait_for(waiting, timeout=5)).seq == 2


async def test_autocommit_session_is_refused(pg_service, pg_repo, pg_urls, ws):
    async with await psycopg.AsyncConnection.connect(pg_urls.app, autocommit=True) as conn:
        with pytest.raises(RuntimeError, match="autocommit"):
            await pg_service.log_event(**event_kwargs(workspace_id=ws), session=conn)
    assert await pg_repo.list_events(UUID(ws)) == ()
