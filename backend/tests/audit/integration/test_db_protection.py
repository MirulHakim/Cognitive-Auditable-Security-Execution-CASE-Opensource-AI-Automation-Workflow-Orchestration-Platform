"""Database protection: append-only triggers, head trigger, role split (§3 rule 1, §6, §10).

Two walls in front of the evidence:
  1. case_app has no UPDATE/DELETE/TRUNCATE privilege -> "permission denied"
  2. the 002 triggers refuse the change even for the table owner -> "append-only"
"""

from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.errors import InsufficientPrivilege, RaiseException

from src.audit.verifier import verify_chain
from tests.audit.conftest import event_kwargs
from tests.audit.integration.conftest import run_sql

pytestmark = [pytest.mark.anyio, pytest.mark.integration]

EVIDENCE_TABLES = ["audit_events", "provenance_records"]


@pytest.fixture
async def chain(pg_service, pg_urls, ws):
    """Three events plus one provenance row (written by the owner; sealing comes in Phase 4)."""
    for i in range(3):
        await pg_service.append_event(**event_kwargs(workspace_id=ws, details={"n": i}))
    run_sql(pg_urls.owner, """
        INSERT INTO provenance_records VALUES (%s, %s, 'job-1', '{}', '{}', '[]', '{}', '{}', '[]', '[]',
                                               repeat('a', 64), repeat('b', 64), now())""",
            (uuid4(), UUID(ws)))
    return ws


def changes(table):
    return [f"UPDATE {table} SET workspace_id = workspace_id WHERE workspace_id = %s",
            f"DELETE FROM {table} WHERE workspace_id = %s"]


class TestAppRoleHasNoPrivilege:
    @pytest.mark.parametrize("table", EVIDENCE_TABLES)
    async def test_update_and_delete_denied(self, pg_urls, chain, table):
        for query in changes(table):
            with pytest.raises(InsufficientPrivilege):
                run_sql(pg_urls.app, query, (UUID(chain),))

    @pytest.mark.parametrize("table", EVIDENCE_TABLES + ["audit_chain_heads"])
    async def test_truncate_denied(self, pg_urls, chain, table):
        with pytest.raises(InsufficientPrivilege):
            run_sql(pg_urls.app, f"TRUNCATE {table}")

    async def test_head_delete_denied(self, pg_urls, chain):
        with pytest.raises(InsufficientPrivilege):
            run_sql(pg_urls.app, "DELETE FROM audit_chain_heads WHERE workspace_id = %s", (UUID(chain),))


class TestTriggersStopEvenTheOwner:
    @pytest.mark.parametrize("table", EVIDENCE_TABLES)
    async def test_update_and_delete_raise(self, pg_urls, chain, table):
        for query in changes(table):
            with pytest.raises(RaiseException, match="append-only"):
                run_sql(pg_urls.owner, query, (UUID(chain),))

    @pytest.mark.parametrize("table", EVIDENCE_TABLES + ["audit_chain_heads"])
    async def test_truncate_raises(self, pg_urls, chain, table):
        with pytest.raises(RaiseException, match="append-only"):
            run_sql(pg_urls.owner, f"TRUNCATE {table}")

    async def test_head_delete_raises(self, pg_urls, chain):
        with pytest.raises(RaiseException, match="append-only"):
            run_sql(pg_urls.owner, "DELETE FROM audit_chain_heads WHERE workspace_id = %s", (UUID(chain),))


class TestHeadCanOnlyAdvanceByOne:
    """case_app may UPDATE the head (log_event needs to), but only to the next existing event."""

    @pytest.mark.parametrize("new_seq,message", [
        ("last_seq + 2", "advance by one"),
        ("last_seq - 1", "advance by one"),
        ("last_seq", "advance by one"),           # same seq, e.g. to point at a re-hashed record
        ("last_seq + 1", "existing event"),       # seq 4 does not exist yet
    ])
    async def test_invalid_moves_raise(self, pg_urls, chain, new_seq, message):
        with pytest.raises(RaiseException, match=message):
            run_sql(pg_urls.app, f"UPDATE audit_chain_heads SET last_seq = {new_seq}, last_hash = repeat('c', 64) "
                                 "WHERE workspace_id = %s", (UUID(chain),))

    async def test_new_head_must_start_at_seq_1(self, pg_urls):
        with pytest.raises(RaiseException, match="start at seq 1"):
            run_sql(pg_urls.app, "INSERT INTO audit_chain_heads VALUES (%s, 5, repeat('c', 64), now())", (uuid4(),))

    async def test_new_head_must_point_to_an_existing_event(self, pg_urls):
        with pytest.raises(RaiseException, match="existing event"):
            run_sql(pg_urls.app, "INSERT INTO audit_chain_heads VALUES (%s, 1, repeat('c', 64), now())", (uuid4(),))


class TestAppCannotSwitchOffTheProtection:
    @pytest.mark.parametrize("query", [
        "ALTER TABLE audit_events DISABLE TRIGGER ALL",
        "DROP TRIGGER audit_events_no_update_delete ON audit_events",
        "DROP TABLE audit_events",
        "SET session_replication_role = replica",   # superuser-only way to skip triggers
    ])
    async def test_denied(self, pg_urls, query):
        with pytest.raises(InsufficientPrivilege):
            run_sql(pg_urls.app, query)


async def test_chain_still_verifies_after_every_refused_attempt(pg_urls, pg_repo, chain):
    for table in EVIDENCE_TABLES:
        for url in (pg_urls.app, pg_urls.owner):
            for query in changes(table):
                with pytest.raises(psycopg.Error):
                    run_sql(url, query, (UUID(chain),))
    result = await verify_chain(pg_repo, UUID(chain))
    assert result.is_verified and result.events_checked == 3
