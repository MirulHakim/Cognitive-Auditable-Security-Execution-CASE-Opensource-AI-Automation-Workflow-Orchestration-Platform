"""
Audit read API (Phase 5, AUDIT_MODULE_PLAN.md §9, §10 "API RBAC").

In-memory storage, mock auth (AUTH_MODE=mock). Requests are played with the
Phase 4 scenarios (tests/audit/scenarios.py).
"""

from datetime import timedelta
from uuid import UUID, uuid4

import pytest

from src.audit.auth import AUDIT_EXPORT, AUDIT_READ, AUDIT_VERIFY, ROLE_PERMISSIONS
from src.audit.canonical import GENESIS_HASH
from src.audit.schemas import ActorRoleEnum
from tests.audit.api_client import api_client, as_role
from tests.audit.conftest import WS, WS_OTHER
from tests.audit.scenarios import scenario_a, scenario_b, scenario_g

pytestmark = pytest.mark.anyio

ROLES = ["ADMIN", "OPERATOR", "AUDITOR"]


@pytest.fixture(autouse=True)
def mock_auth(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "mock")


@pytest.fixture
async def client(service):
    async with api_client(service) as c:
        yield c


def stored(repo, ws=WS):
    return repo._events[UUID(ws)]


# ---------------------------------------------------------------------------
# Auth (mock) and the envelope
# ---------------------------------------------------------------------------

class TestAuth:
    async def test_no_auth_mode_fails_closed(self, client, monkeypatch):
        monkeypatch.delenv("AUTH_MODE")
        r = await client.get("/api/v1/audit/events", headers=as_role("AUDITOR"))
        assert r.status_code == 503
        assert r.json() == {"success": False, "data": None, "error": {
            "code": "AUTH_NOT_CONFIGURED", "message": r.json()["error"]["message"]}, "metadata": r.json()["metadata"]}

    async def test_missing_headers(self, client):
        r = await client.get("/api/v1/audit/events")
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "AUTH_REQUIRED"

    @pytest.mark.parametrize("role, ws", [("BOSS", WS), ("SYSTEM", WS), ("AI", WS), ("AUDITOR", "not-a-uuid")])
    async def test_bad_role_or_workspace(self, client, role, ws):
        r = await client.get("/api/v1/audit/events", headers=as_role(role, ws))
        assert r.status_code == 401
        assert r.json()["error"]["code"] == "AUTH_INVALID"

    async def test_success_envelope(self, client):
        r = await client.get("/api/v1/audit/events", headers=as_role("ADMIN"))
        body = r.json()
        assert r.status_code == 200
        assert body["success"] is True and body["error"] is None and body["data"] == []
        assert {"request_id", "timestamp", "total", "limit", "offset"} <= set(body["metadata"])


# ---------------------------------------------------------------------------
# RBAC (§3 rule 9, §10)
# ---------------------------------------------------------------------------

class TestRBAC:
    def test_permission_table_matches_the_plan(self):
        assert ROLE_PERMISSIONS == {
            ActorRoleEnum.ADMIN: {AUDIT_READ, AUDIT_VERIFY},
            ActorRoleEnum.OPERATOR: {AUDIT_READ, AUDIT_VERIFY},
            ActorRoleEnum.AUDITOR: {AUDIT_READ, AUDIT_VERIFY, AUDIT_EXPORT},
        }

    @pytest.mark.parametrize("role", ROLES)
    async def test_every_role_can_read_and_verify(self, client, service, role):
        req = await scenario_a(service)
        await service.seal_provenance(WS, "job-a")
        h = as_role(role)
        for path in ("/events", f"/events/{req.events[0].event_id}", "/executions", "/executions/job-a",
                     "/verifications"):
            assert (await client.get(f"/api/v1/audit{path}", headers=h)).status_code == 200, path
        assert (await client.post("/api/v1/audit/verify", headers=h)).status_code == 200
        assert (await client.post("/api/v1/audit/executions/job-a/verify-lineage", headers=h)).status_code == 200

    @pytest.mark.parametrize("role", ["ADMIN", "OPERATOR"])
    async def test_only_auditor_can_export_and_denial_is_logged(self, client, repo, role):
        r = await client.post("/api/v1/audit/export", json={"format": "JSON"},
                              headers=as_role(role, user="u-x-9"))
        assert r.status_code == 403
        assert r.json()["error"]["code"] == "FORBIDDEN"
        [denied] = stored(repo)
        assert (denied.action, denied.actor_id, denied.actor_role.value, denied.outcome.value) == \
            ("ACCESS_FORBIDDEN", "u-x-9", role, "FAILURE")
        assert (denied.target_type, denied.target_id) == ("permission", "audit:export")
        assert denied.details == {"permission": "audit:export", "method": "POST"}
        assert repo._exports == {}

    async def test_auditor_can_export(self, client):
        r = await client.post("/api/v1/audit/export", json={"format": "JSON"}, headers=as_role("AUDITOR"))
        assert r.status_code == 200

    async def test_denial_still_403_when_audit_log_fails(self, client, service, monkeypatch):
        """Pattern C: refusing must not depend on the audit log being up."""
        async def broken(**_):
            raise ConnectionError("database down")
        monkeypatch.setattr(service, "log_event", broken)
        r = await client.post("/api/v1/audit/export", json={"format": "PDF"}, headers=as_role("OPERATOR"))
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# GET /events and /events/{id}
# ---------------------------------------------------------------------------

class TestEvents:
    async def test_timeline_newest_first_and_paginated(self, client, service):
        req = await scenario_a(service)
        r = await client.get("/api/v1/audit/events", params={"limit": 5, "offset": 2}, headers=as_role("ADMIN"))
        body = r.json()
        n = len(req.events)
        assert body["metadata"]["total"] == n
        assert [e["seq"] for e in body["data"]] == [n - 2, n - 3, n - 4, n - 5, n - 6]

    @pytest.mark.parametrize("params, expected", [
        ({"execution_id": "job-b"}, {"job-b"}),
        ({"action": "EXECUTION_CLOSED"}, {"job-a", "job-b"}),
        ({"role": "AI"}, {"job-a", "job-b"}),
        ({"actor": "u-op-1", "execution_id": "job-a"}, {"job-a"}),
        ({"outcome": "FAILURE"}, set()),
    ])
    async def test_filters(self, client, service, params, expected):
        await scenario_a(service)
        await scenario_b(service)
        body = (await client.get("/api/v1/audit/events", params=params, headers=as_role("AUDITOR"))).json()
        assert {e["execution_id"] for e in body["data"]} == expected
        for key, value in params.items():
            field = {"role": "actor_role", "actor": "actor_id"}.get(key, key)
            assert all(e[field] == value for e in body["data"])

    async def test_date_range_is_inclusive(self, client, service):
        req = await scenario_a(service)
        third, fifth = req.events[2].event_timestamp, req.events[4].event_timestamp
        params = {"date_from": third.isoformat(), "date_to": fifth.isoformat()}
        body = (await client.get("/api/v1/audit/events", params=params, headers=as_role("ADMIN"))).json()
        assert [e["seq"] for e in body["data"]] == [5, 4, 3]

    async def test_date_without_time_zone_is_utc(self, client, service):
        req = await scenario_a(service)
        later = (req.events[-1].event_timestamp + timedelta(seconds=1)).replace(tzinfo=None)
        body = (await client.get("/api/v1/audit/events", params={"date_from": later.isoformat()},
                                 headers=as_role("ADMIN"))).json()
        assert body["metadata"]["total"] == 0

    async def test_unknown_action_is_rejected(self, client):
        r = await client.get("/api/v1/audit/events", params={"action": "DROP_TABLE"}, headers=as_role("ADMIN"))
        assert r.status_code == 422

    async def test_workspace_isolation(self, client, service):
        req = await scenario_a(service)
        other = as_role("AUDITOR", WS_OTHER)
        assert (await client.get("/api/v1/audit/events", headers=other)).json()["data"] == []
        assert (await client.get(f"/api/v1/audit/events/{req.events[0].event_id}", headers=other)).status_code == 404
        assert (await client.get("/api/v1/audit/executions", headers=other)).json()["data"] == []
        assert (await client.get("/api/v1/audit/executions/job-a", headers=other)).status_code == 404

    async def test_chain_view_of_a_middle_event(self, client, service):
        req = await scenario_a(service)
        before, event, after = req.events[3:6]
        view = (await client.get(f"/api/v1/audit/events/{event.event_id}", headers=as_role("ADMIN"))).json()["data"]
        assert view["event"]["seq"] == event.seq
        assert view["previous_event_hash"] == before.current_hash == event.previous_hash
        assert view["next_event_previous_hash"] == after.previous_hash == event.current_hash
        assert view["hash_matches"] is True and view["linked_to_previous"] is True and view["linked_to_next"] is True

    async def test_chain_view_first_and_last(self, client, service):
        req = await scenario_a(service)
        first = (await client.get(f"/api/v1/audit/events/{req.events[0].event_id}",
                                  headers=as_role("ADMIN"))).json()["data"]
        assert first["previous_event_hash"] == GENESIS_HASH and first["linked_to_previous"] is True
        last = (await client.get(f"/api/v1/audit/events/{req.events[-1].event_id}",
                                 headers=as_role("ADMIN"))).json()["data"]
        assert last["next_event_previous_hash"] is None and last["linked_to_next"] is None

    async def test_chain_view_shows_tampering(self, client, service, repo):
        req = await scenario_a(service)
        stored(repo)[4] = stored(repo)[4].model_copy(update={"details": {"forged": True}})
        view = (await client.get(f"/api/v1/audit/events/{req.events[4].event_id}",
                                 headers=as_role("ADMIN"))).json()["data"]
        assert view["hash_matches"] is False

    async def test_chain_view_neighbour_deleted(self, client, service, repo):
        req = await scenario_a(service)
        del stored(repo)[3]
        view = (await client.get(f"/api/v1/audit/events/{req.events[4].event_id}",
                                 headers=as_role("ADMIN"))).json()["data"]
        assert view["previous_event_hash"] is None and view["linked_to_previous"] is None

    async def test_unknown_event(self, client):
        r = await client.get(f"/api/v1/audit/events/{uuid4()}", headers=as_role("ADMIN"))
        assert r.status_code == 404
        assert r.json()["error"]["code"] == "NOT_FOUND"


# ---------------------------------------------------------------------------
# GET /executions, /executions/{id}, POST verify-lineage
# ---------------------------------------------------------------------------

class TestExecutions:
    async def test_list_with_summary_and_integrity(self, client, service):
        a = await scenario_a(service)
        await service.seal_provenance(WS, "job-a")
        b = await scenario_b(service)                      # closed but not sealed
        body = (await client.get("/api/v1/audit/executions", headers=as_role("OPERATOR"))).json()
        assert body["metadata"]["total"] == 2
        row_b, row_a = body["data"]                         # newest request first
        assert row_b["execution_id"] == "job-b" and row_b["integrity_status"] == "NOT_SEALED"
        assert row_b["summary"] is None and row_b["event_count"] == len(b.events)
        assert row_a["integrity_status"] == "NOT_VERIFIED"
        assert row_a["event_count"] == len(a.events) + 1   # + PROVENANCE_RECORDED
        assert row_a["last_action"] == "PROVENANCE_RECORDED"
        assert row_a["summary"] == {
            "objective": "leave application (via GMAIL)",
            "decision": "AI suggested tpl-leave v3, operator accepted",
            "approvals": ["GATE1 APPROVED by u-op-1", "GATE2 APPROVED by u-op-1"],
            "result": "DELIVERED",
        }

    async def test_integrity_follows_the_last_lineage_check(self, client, service):
        await scenario_a(service)
        await service.seal_provenance(WS, "job-a")
        await scenario_g(service)
        await service.seal_provenance(WS, "job-g")
        h = as_role("AUDITOR")
        ok = (await client.post("/api/v1/audit/executions/job-a/verify-lineage", headers=h)).json()["data"]
        bad = (await client.post("/api/v1/audit/executions/job-g/verify-lineage", headers=h)).json()["data"]
        assert ok["status"] == "VALID" and ok["verified_by"] == "u-auditor-1"
        assert bad["status"] == "INVALID"
        assert [p["reason"] for p in bad["problems"]] == ["ORDER_VIOLATION"]
        rows = {r["execution_id"]: r for r in
                (await client.get("/api/v1/audit/executions", headers=h)).json()["data"]}
        assert rows["job-a"]["integrity_status"] == "LINEAGE_VALID"
        assert rows["job-g"]["integrity_status"] == "LINEAGE_INVALID"
        assert rows["job-a"]["last_lineage_check_at"] is not None

    async def test_pagination(self, client, service):
        for i in range(3):
            await scenario_b(service, execution_id=f"job-{i}")
        body = (await client.get("/api/v1/audit/executions", params={"limit": 2, "offset": 1},
                                 headers=as_role("ADMIN"))).json()
        assert [r["execution_id"] for r in body["data"]] == ["job-1", "job-0"]
        assert body["metadata"]["total"] == 3

    async def test_detail(self, client, service):
        a = await scenario_a(service)
        record = await service.seal_provenance(WS, "job-a")
        data = (await client.get("/api/v1/audit/executions/job-a", headers=as_role("ADMIN"))).json()["data"]
        assert [e["seq"] for e in data["events"]] == [e.seq for e in a.events] + [len(a.events) + 1]
        assert data["provenance"]["record_hash"] == record.record_hash
        assert data["execution"]["provenance_id"] == str(record.provenance_id)

    async def test_detail_not_sealed_and_unknown(self, client, service):
        await scenario_b(service)
        data = (await client.get("/api/v1/audit/executions/job-b", headers=as_role("ADMIN"))).json()["data"]
        assert data["provenance"] is None
        assert (await client.get("/api/v1/audit/executions/nope", headers=as_role("ADMIN"))).status_code == 404

    async def test_verify_lineage_not_sealed(self, client, service):
        await scenario_b(service)
        r = await client.post("/api/v1/audit/executions/job-b/verify-lineage", headers=as_role("ADMIN"))
        assert r.status_code == 409
        assert r.json()["error"]["code"] == "NOT_SEALED"

    async def test_verify_lineage_bad_execution_id(self, client):
        r = await client.post("/api/v1/audit/executions/bad id!/verify-lineage", headers=as_role("ADMIN"))
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "INVALID_EXECUTION_ID"


# ---------------------------------------------------------------------------
# POST /verify, GET /verifications
# ---------------------------------------------------------------------------

class TestVerify:
    async def test_verified_with_head_fields(self, client, service):
        req = await scenario_a(service)
        r = await client.post("/api/v1/audit/verify", headers=as_role("OPERATOR", user="u-op-7"))
        data = r.json()["data"]
        n = len(req.events)
        assert data["status"] == "VERIFIED" and data["verified_by"] == "u-op-7"
        assert (data["head_seq"], data["last_found_seq"]) == (n, n)
        assert data["head_hash"] == data["last_found_hash"] == req.events[-1].current_hash

    async def test_tail_truncated_shows_both_heads(self, client, service, repo):
        req = await scenario_a(service)
        del stored(repo)[-1]
        data = (await client.post("/api/v1/audit/verify", headers=as_role("AUDITOR"))).json()["data"]
        n = len(req.events)
        assert (data["status"], data["reason"]) == ("BROKEN", "TAIL_TRUNCATED")
        assert (data["head_seq"], data["last_found_seq"]) == (n, n - 1)

    async def test_range(self, client, service):
        await scenario_a(service)
        data = (await client.post("/api/v1/audit/verify", json={"from_seq": 3, "to_seq": 6},
                                  headers=as_role("ADMIN"))).json()["data"]
        assert (data["status"], data["from_seq"], data["to_seq"], data["events_checked"]) == ("VERIFIED", 3, 6, 4)

    async def test_bad_range(self, client, service):
        await scenario_a(service)
        r = await client.post("/api/v1/audit/verify", json={"from_seq": 6, "to_seq": 3}, headers=as_role("ADMIN"))
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "INVALID_RANGE"

    async def test_verify_is_logged_and_listed(self, client, service, repo):
        await scenario_b(service)
        first = (await client.post("/api/v1/audit/verify", headers=as_role("ADMIN"))).json()["data"]
        second = (await client.post("/api/v1/audit/verify", headers=as_role("AUDITOR"))).json()["data"]
        assert stored(repo)[-1].action == "AUDIT_INTEGRITY_VERIFIED"
        listed = (await client.get("/api/v1/audit/verifications", headers=as_role("OPERATOR"))).json()["data"]
        assert [v["verification_id"] for v in listed] == [second["verification_id"], first["verification_id"]]
        other = (await client.get("/api/v1/audit/verifications", headers=as_role("ADMIN", WS_OTHER))).json()
        assert other["data"] == []


async def test_audit_not_configured(monkeypatch):
    """An app without configure_audit answers 503 in the envelope, not a crash."""
    import httpx
    from fastapi import FastAPI

    from src.audit.routes import register_error_handlers, router

    monkeypatch.setenv("AUTH_MODE", "mock")
    app = FastAPI()
    app.include_router(router)
    register_error_handlers(app)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/v1/audit/events", headers=as_role("ADMIN"))
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "AUDIT_NOT_CONFIGURED"
