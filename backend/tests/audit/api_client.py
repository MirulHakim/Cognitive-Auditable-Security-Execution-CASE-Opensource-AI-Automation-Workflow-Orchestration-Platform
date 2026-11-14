"""
Helpers for the Phase 5 API tests: a small FastAPI app holding only the audit
router (no LangGraph / Ollama from server.py), and the mock-auth headers.
"""

from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI

from src.audit.routes import configure_audit, register_error_handlers, router
from tests.audit.conftest import WS

AUDITOR = "u-aud-1"


def make_app(service) -> FastAPI:
    app = FastAPI()
    app.include_router(router)
    register_error_handlers(app)
    configure_audit(app, service)
    return app


@asynccontextmanager
async def api_client(service):
    transport = httpx.ASGITransport(app=make_app(service))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


def as_role(role: str, workspace_id: str = WS, user: str | None = None) -> dict[str, str]:
    """Mock-auth headers (src/audit/auth.py) for one caller."""
    return {"X-Mock-Role": role, "X-Mock-Workspace": workspace_id,
            "X-Mock-User": user or f"u-{role.lower()}-1"}
