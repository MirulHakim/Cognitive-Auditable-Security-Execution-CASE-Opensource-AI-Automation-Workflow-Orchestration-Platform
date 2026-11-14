"""
Read API + export against PostgreSQL (Phase 5).

The SQL in PostgresAuditRepository (filters, paging, audit_exports) must give
the same answers as the in-memory version the unit tests use.
"""

import json
from uuid import UUID, uuid4

import pytest

from src.audit.export import Exporter, create_export
from src.audit.offline_verify import verify_export
from src.audit.schemas import ActorRoleEnum, EventFilter, ExportFormatEnum, ExportRequest, OutcomeEnum
from tests.audit.api_client import api_client, as_role
from tests.audit.integration.conftest import run_sql
from tests.audit.scenarios import scenario_a, scenario_b

pytestmark = [pytest.mark.anyio, pytest.mark.integration]


@pytest.fixture(autouse=True)
def mock_auth(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "mock")


async def test_query_events_filters_and_paging(pg_service, pg_repo, ws):
    a = await scenario_a(pg_service, workspace_id=ws)
    await scenario_b(pg_service, workspace_id=ws)
    w = UUID(ws)

    page, total = await pg_repo.query_events(w, EventFilter(), limit=3, offset=1)
    assert total == len(a.events) + 5
    assert [e.seq for e in page] == [total - 1, total - 2, total - 3]

    only_b, total_b = await pg_repo.query_events(w, EventFilter(execution_id="job-b"), limit=None,
                                                 newest_first=False)
    assert total_b == 5 and [e.action for e in only_b][-1] == "EXECUTION_CLOSED"

    ai, _ = await pg_repo.query_events(w, EventFilter(actor_role=ActorRoleEnum.AI), limit=100)
    assert ai and all(e.actor_role is ActorRoleEnum.AI for e in ai)

    failures, n = await pg_repo.query_events(w, EventFilter(outcome=OutcomeEnum.FAILURE), limit=100)
    assert (failures, n) == ((), 0)

    window, _ = await pg_repo.query_events(w, EventFilter(date_from=a.events[2].event_timestamp,
                                                          date_to=a.events[4].event_timestamp), limit=100)
    assert [e.seq for e in window] == [5, 4, 3]

    capped, total_capped = await pg_repo.query_events(w, EventFilter(), limit=None, to_seq=4, newest_first=False)
    assert [e.seq for e in capped] == [1, 2, 3, 4] and total_capped == 4


async def test_get_event_and_execution_ids(pg_service, pg_repo, ws):
    a = await scenario_a(pg_service, workspace_id=ws)
    await scenario_b(pg_service, workspace_id=ws)
    w = UUID(ws)
    assert await pg_repo.get_event(w, a.events[3].event_id) == a.events[3]
    assert await pg_repo.get_event(w, uuid4()) is None
    assert await pg_repo.get_event(uuid4(), a.events[3].event_id) is None     # other workspace
    assert await pg_repo.list_execution_ids(w, limit=10) == (("job-b", "job-a"), 2)
    assert await pg_repo.list_execution_ids(w, limit=1, offset=1) == (("job-a",), 2)


async def test_export_row_and_offline_check(pg_service, pg_repo, pg_urls, ws):
    await scenario_a(pg_service, workspace_id=ws)
    await pg_service.seal_provenance(ws, "job-a")
    exporter = Exporter(user_id="u-aud-1", role=ActorRoleEnum.AUDITOR, workspace_id=UUID(ws))
    file = await create_export(pg_service, exporter, ExportRequest(format=ExportFormatEnum.JSON))

    doc = json.loads(file.content)
    report = verify_export(doc)
    assert report.ok, report.problems
    assert report.records_checked == 1

    assert await pg_repo.list_exports(UUID(ws)) == (file.record,)
    rows = run_sql(pg_urls.admin, "SELECT format, record_count, head_seq, file_hash FROM audit_exports "
                                  "WHERE workspace_id = %s", (ws,))
    assert rows == [("JSON", len(doc["events"]), file.record.head_seq, file.record.file_hash)]
    last = (await pg_repo.list_events(UUID(ws)))[-1]
    assert last.action == "AUDIT_EXPORTED" and last.details["export_id"] == str(file.record.export_id)


async def test_api_over_postgres(pg_service, ws):
    await scenario_a(pg_service, workspace_id=ws)
    await pg_service.seal_provenance(ws, "job-a")
    async with api_client(pg_service) as client:
        rows = (await client.get("/api/v1/audit/executions", headers=as_role("ADMIN", ws))).json()["data"]
        assert [r["execution_id"] for r in rows] == ["job-a"]
        assert rows[0]["integrity_status"] == "NOT_VERIFIED"

        lineage = await client.post("/api/v1/audit/executions/job-a/verify-lineage", headers=as_role("ADMIN", ws))
        assert lineage.json()["data"]["status"] == "VALID"

        denied = await client.post("/api/v1/audit/export", json={"format": "PDF"}, headers=as_role("OPERATOR", ws))
        assert denied.status_code == 403
        pdf = await client.post("/api/v1/audit/export", json={"format": "PDF"}, headers=as_role("AUDITOR", ws))
        assert pdf.status_code == 200 and pdf.content.startswith(b"%PDF")

        timeline = (await client.get("/api/v1/audit/events", params={"limit": 3},
                                     headers=as_role("AUDITOR", ws))).json()["data"]
        assert [e["action"] for e in timeline] == ["AUDIT_EXPORTED", "ACCESS_FORBIDDEN", "LINEAGE_VERIFIED"]
