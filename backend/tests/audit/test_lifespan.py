"""audit_lifespan puts the shared objects on app.state, so other modules reuse them
instead of opening a second pool or building a second AuditService."""

import pytest
from fastapi import FastAPI

from src.audit import AuditService
from src.audit.routes import audit_lifespan

pytestmark = pytest.mark.anyio


async def test_memory_mode_sets_audit_service_and_no_database(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    app = FastAPI()
    async with audit_lifespan(app):
        assert isinstance(app.state.audit_service, AuditService)
        assert app.state.database is None
