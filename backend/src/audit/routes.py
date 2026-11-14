"""
CASE — Audit & Transparency Layer
Read API (AUDIT_MODULE_PLAN.md §9), prefix /api/v1/audit

Location: src/audit/routes.py

| Method | Path                                   | Permission    |
|--------|----------------------------------------|---------------|
| GET    | /events                                | audit:read    |
| GET    | /events/{event_id}                     | audit:read    |
| GET    | /executions                            | audit:read    |
| GET    | /executions/{execution_id}             | audit:read    |
| POST   | /verify                                | audit:verify  |
| GET    | /verifications                         | audit:read    |
| POST   | /executions/{execution_id}/verify-lineage | audit:verify |
| POST   | /export                                | audit:export  |

Every endpoint takes the workspace from the logged-in user, never from the
URL, so a caller can only ever see their own workspace. JSON answers use the
shared envelope {success, data, error, metadata}; /export answers with the
file itself.

Wiring (server.py):
    app = FastAPI(..., lifespan=audit_lifespan)   # creates the AuditService
    app.include_router(audit_router)
    register_error_handlers(app)
"""

# routes.py - Understanding Notes
#
# Each endpoint is the same 3 steps:
#   1. guard   : require_permission(...) -> who you are + are you allowed (auth.py)
#   2. work    : queries.py (read) / AuditService (verify) / export.py (export)
#   3. answer  : _ok(data) wraps it in the envelope
#
# Errors are turned into the envelope too (register_error_handlers):
#   400 bad input (AuditValidationError) · 401/503 auth · 403 no permission
#   404 not in your workspace · 409 request not sealed yet (verify-lineage)

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Iterator, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Body, Depends, FastAPI, Query, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from . import queries
from .auth import AUDIT_EXPORT, AUDIT_READ, AUDIT_VERIFY, AuditAPIError, CurrentUser, require_permission
from .catalogue import AuditAction
from .errors import AuditValidationError, ProvenanceError
from .export import Exporter, create_export
from .repository import InMemoryAuditRepository, PostgresAuditRepository
from .schemas import ActorRoleEnum, EventFilter, ExportRequest, OutcomeEnum, VerifyChainRequest
from .service import AuditService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/audit", tags=["audit"])

MAX_PAGE = 500
MAX_EXECUTION_PAGE = 100  # each row reads that request's events, so keep pages smaller


# ---------------------------------------------------------------------------
# Wiring and envelope
# ---------------------------------------------------------------------------

def configure_audit(app: FastAPI, service: AuditService) -> None:
    """Give the app the AuditService the endpoints (and ACCESS_FORBIDDEN logging) use."""
    app.state.audit_service = service


def get_service(request: Request) -> AuditService:
    service = getattr(request.app.state, "audit_service", None)
    if service is None:
        raise AuditAPIError(503, "AUDIT_NOT_CONFIGURED", "the audit service is not configured")
    return service


@asynccontextmanager
async def audit_lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Startup: Postgres if DATABASE_URL is set (the real thing), otherwise in-memory (demo only).

    Windows note: psycopg's async mode needs a SelectorEventLoop; in Docker/Linux it just works."""
    if os.environ.get("DATABASE_URL"):
        from ..storage.database import Database  # only needed with a database
        async with Database() as database:
            configure_audit(app, AuditService(PostgresAuditRepository(database)))
            yield
    else:
        logger.warning("DATABASE_URL is not set: the audit API uses in-memory storage (lost on restart)")
        configure_audit(app, AuditService(InMemoryAuditRepository()))
        yield


def _metadata(**extra: Any) -> dict[str, Any]:
    return {"request_id": str(uuid4()), "timestamp": datetime.now(timezone.utc).isoformat(), **extra}


def _ok(data: Any, **metadata: Any) -> dict[str, Any]:
    return {"success": True, "data": jsonable_encoder(data), "error": None, "metadata": _metadata(**metadata)}


def register_error_handlers(app: FastAPI) -> None:
    async def handle(_request: Request, exc: AuditAPIError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={
            "success": False, "data": None, "error": {"code": exc.code, "message": exc.message},
            "metadata": _metadata()})

    app.add_exception_handler(AuditAPIError, handle)


@contextmanager
def _service_errors() -> Iterator[None]:
    """Audit's own errors -> HTTP errors. Messages name fields, never values."""
    try:
        yield
    except AuditValidationError as exc:
        raise AuditAPIError(400, exc.code, str(exc)) from None
    except ProvenanceError as exc:
        raise AuditAPIError(409, exc.code, str(exc)) from None


def _not_found(what: str) -> AuditAPIError:
    return AuditAPIError(404, "NOT_FOUND", f"{what} not found in your workspace")


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------

@router.get("/events")
async def list_events(
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    action: Optional[AuditAction] = None,
    actor: Optional[str] = Query(default=None, min_length=1, max_length=128),
    role: Optional[ActorRoleEnum] = None,
    outcome: Optional[OutcomeEnum] = None,
    execution_id: Optional[str] = Query(default=None, min_length=1, max_length=128),
    limit: int = Query(default=50, ge=1, le=MAX_PAGE),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(require_permission(AUDIT_READ)),
    service: AuditService = Depends(get_service),
) -> dict[str, Any]:
    """Flat timeline, newest first."""
    filters = EventFilter(date_from=date_from, date_to=date_to, action=action.value if action else None,
                          actor_id=actor, actor_role=role, outcome=outcome, execution_id=execution_id)
    events, total = await queries.list_events(service.repository, user.workspace_id, filters,
                                              limit=limit, offset=offset)
    return _ok(events, total=total, limit=limit, offset=offset)


@router.get("/events/{event_id}")
async def get_event(event_id: UUID, user: CurrentUser = Depends(require_permission(AUDIT_READ)),
                    service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """One event + previous/next hashes (chain view)."""
    view = await queries.get_event_view(service.repository, user.workspace_id, event_id)
    if view is None:
        raise _not_found("event")
    return _ok(view)


# ---------------------------------------------------------------------------
# Requests
# ---------------------------------------------------------------------------

@router.get("/executions")
async def list_executions(limit: int = Query(default=20, ge=1, le=MAX_EXECUTION_PAGE),
                          offset: int = Query(default=0, ge=0),
                          user: CurrentUser = Depends(require_permission(AUDIT_READ)),
                          service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """One row per request: lineage summary, record count, integrity status."""
    rows, total = await queries.list_executions(service.repository, user.workspace_id, limit=limit, offset=offset)
    return _ok(rows, total=total, limit=limit, offset=offset)


@router.get("/executions/{execution_id}")
async def get_execution(execution_id: str, user: CurrentUser = Depends(require_permission(AUDIT_READ)),
                        service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """All events of one request + its provenance record."""
    detail = await queries.get_execution(service.repository, user.workspace_id, execution_id)
    if detail is None:
        raise _not_found("request")
    return _ok(detail)


@router.post("/executions/{execution_id}/verify-lineage")
async def verify_lineage(execution_id: str, user: CurrentUser = Depends(require_permission(AUDIT_VERIFY)),
                         service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """Run verify_lineage (§8.5); logged as LINEAGE_VERIFIED / LINEAGE_VERIFICATION_FAILED."""
    with _service_errors():
        result = await service.verify_lineage(str(user.workspace_id), execution_id,
                                              actor=user.user_id, role=user.role.value)
    return _ok(result)


# ---------------------------------------------------------------------------
# Chain verification
# ---------------------------------------------------------------------------

@router.post("/verify")
async def verify_chain(body: Optional[VerifyChainRequest] = Body(default=None),
                       user: CurrentUser = Depends(require_permission(AUDIT_VERIFY)),
                       service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """Run verify_chain (§8.3). The result always has the four head fields (§5.5)."""
    body = body or VerifyChainRequest()
    with _service_errors():
        result = await service.verify_chain(str(user.workspace_id), actor=user.user_id, role=user.role.value,
                                            from_seq=body.from_seq, to_seq=body.to_seq)
    return _ok(result)


@router.get("/verifications")
async def list_verifications(limit: int = Query(default=20, ge=1, le=100),
                             user: CurrentUser = Depends(require_permission(AUDIT_READ)),
                             service: AuditService = Depends(get_service)) -> dict[str, Any]:
    """Past chain verification results, newest first."""
    results = await service.repository.list_verifications(user.workspace_id, limit=limit)
    return _ok(results, limit=limit)


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

@router.post("/export")
async def export(body: ExportRequest, user: CurrentUser = Depends(require_permission(AUDIT_EXPORT)),
                 service: AuditService = Depends(get_service)) -> Response:
    """JSON or PDF (§8.6). Logged as AUDIT_EXPORTED before the file is returned."""
    exporter = Exporter(user_id=user.user_id, role=user.role, workspace_id=user.workspace_id)
    with _service_errors():
        file = await create_export(service, exporter, body)
    return Response(content=file.content, media_type=file.media_type, headers={
        "Content-Disposition": f'attachment; filename="{file.filename}"',
        "X-Export-Id": str(file.record.export_id),
        "X-File-SHA256": file.record.file_hash,
        "X-Chain-Head-Seq": str(file.record.head_seq),
        "X-Chain-Head-Hash": file.record.head_hash,
    })


__all__ = ["router", "configure_audit", "get_service", "audit_lifespan", "register_error_handlers"]
