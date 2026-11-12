"""seal_provenance / verify_lineage against a real database (§8.4, §8.5).

The in-memory tests cover the logic; these cover what only Postgres can show:
the jsonb round trip keeps record_hash valid, the UNIQUE constraint makes
sealing idempotent even under concurrency, and the record + PROVENANCE_RECORDED
are committed together or not at all.
"""

import asyncio
from uuid import UUID

import psycopg
import pytest

from src.audit.canonical import compute_record_hash
from tests.audit.integration.conftest import run_sql
from tests.audit.scenarios import scenario_a, scenario_b, scenario_c, scenario_d, scenario_e, scenario_g

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


def provenance_rows(pg_urls, ws):
    return run_sql(pg_urls.app, "SELECT execution_id FROM provenance_records WHERE workspace_id = %s", (UUID(ws),))


async def count_action(pg_repo, ws, action):
    return sum(e.action == action for e in await pg_repo.list_events(UUID(ws)))


async def test_record_reads_back_unchanged_and_still_hashes_the_same(pg_service, pg_repo, ws):
    await scenario_a(pg_service, workspace_id=ws)
    record = await pg_service.seal_provenance(ws, "job-a")
    stored = await pg_repo.get_provenance(UUID(ws), "job-a")
    assert stored == record
    assert compute_record_hash(stored) == stored.record_hash
    result = await pg_service.verify_lineage(ws, "job-a", actor="u-aud-1", role="AUDITOR")
    assert result.is_valid, result.problems


async def test_all_scenarios_seal_and_verify(pg_service, ws):
    for make in (scenario_a, scenario_b, scenario_c, scenario_d, scenario_e):
        req = await make(pg_service, workspace_id=ws)
        await pg_service.seal_provenance(ws, req.execution_id)
        result = await pg_service.verify_lineage(ws, req.execution_id, actor="u-aud-1", role="AUDITOR")
        assert result.is_valid, (req.execution_id, result.problems)
    req = await scenario_g(pg_service, workspace_id=ws)
    await pg_service.seal_provenance(ws, req.execution_id)
    result = await pg_service.verify_lineage(ws, req.execution_id, actor="u-aud-1", role="AUDITOR")
    assert [p.reason.value for p in result.problems] == ["ORDER_VIOLATION"]


async def test_sealing_twice_returns_the_first_record(pg_service, pg_repo, pg_urls, ws):
    await scenario_b(pg_service, workspace_id=ws)
    first = await pg_service.seal_provenance(ws, "job-b")
    second = await pg_service.seal_provenance(ws, "job-b")
    assert second == first
    assert len(provenance_rows(pg_urls, ws)) == 1
    assert await count_action(pg_repo, ws, "PROVENANCE_RECORDED") == 1


async def test_parallel_seals_store_one_record(pg_service, pg_repo, pg_urls, ws):
    # All five pass the "already sealed?" check before any of them commits;
    # the UNIQUE constraint lets only one insert through.
    await scenario_a(pg_service, workspace_id=ws)
    records = await asyncio.gather(*(pg_service.seal_provenance(ws, "job-a") for _ in range(5)))
    assert len({r.provenance_id for r in records}) == 1
    assert len(provenance_rows(pg_urls, ws)) == 1
    assert await count_action(pg_repo, ws, "PROVENANCE_RECORDED") == 1
    assert (await pg_service.verify_lineage(ws, "job-a", actor="u-1", role="ADMIN")).is_valid


async def test_failed_log_event_rolls_back_the_record(pg_service, pg_repo, pg_urls, ws, monkeypatch):
    await scenario_b(pg_service, workspace_id=ws)
    original = pg_service.log_event

    async def failing_log_event(**kwargs):
        if kwargs["action"] == "PROVENANCE_RECORDED":
            raise RuntimeError("audit write failed")
        return await original(**kwargs)

    monkeypatch.setattr(pg_service, "log_event", failing_log_event)
    with pytest.raises(RuntimeError, match="audit write failed"):
        await pg_service.seal_provenance(ws, "job-b")
    assert provenance_rows(pg_urls, ws) == []          # step 6: both or neither
    monkeypatch.undo()
    await pg_service.seal_provenance(ws, "job-b")       # and it can be sealed afterwards
    assert len(provenance_rows(pg_urls, ws)) == 1


async def test_app_role_cannot_change_a_sealed_record(pg_service, pg_urls, ws):
    await scenario_b(pg_service, workspace_id=ws)
    await pg_service.seal_provenance(ws, "job-b")
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        run_sql(pg_urls.app, "UPDATE provenance_records SET sealed_at = now() WHERE workspace_id = %s", (UUID(ws),))


async def test_superuser_edit_is_caught_by_verify_lineage(pg_service, pg_urls, ws):
    # Someone with full database access gets past the triggers; the hashes still catch it.
    await scenario_a(pg_service, workspace_id=ws)
    await pg_service.seal_provenance(ws, "job-a")
    run_sql(pg_urls.admin, "UPDATE provenance_records SET result = jsonb_set(result, '{final_status}', '\"FAILED\"') "
                           "WHERE workspace_id = %s", (UUID(ws),), bypass_triggers=True)
    result = await pg_service.verify_lineage(ws, "job-a", actor="u-aud-1", role="AUDITOR")
    assert [p.reason.value for p in result.problems] == ["RECORD_HASH_MISMATCH"]

