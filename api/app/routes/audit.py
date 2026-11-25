"""Audit trail: list, read one record, re-verify the hash chain."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from ..auth import CurrentOperator, require
from ..deps import audit
from ..errors import not_found

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("")
def list_events(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    action: str | None = Query(default=None),
    outcome: str | None = Query(default=None),
    actor: str | None = Query(default=None),
    actor_ctx: CurrentOperator = Depends(require("audit:read")),
) -> dict[str, Any]:
    events, total = audit.list(
        limit=limit, offset=offset, action=action, outcome=outcome, actor_id=actor
    )
    return {"events": events, "total": total, "limit": limit, "offset": offset}


@router.get("/events/{audit_id}")
def get_event(
    audit_id: str,
    actor_ctx: CurrentOperator = Depends(require("audit:read")),
) -> dict[str, Any]:
    event = audit.get(audit_id)
    if event is None:
        raise not_found("Audit event not found.")
    return {"event": event}


@router.post("/verify")
def verify_chain(
    actor_ctx: CurrentOperator = Depends(require("audit:read")),
) -> dict[str, Any]:
    return audit.verify()
