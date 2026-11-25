"""Who you are, and (for admins) who else may sign in."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request

from ..auth import CurrentOperator, current_operator, permissions_for, require
from ..deps import audit, operators
from ..errors import bad_request, conflict, not_found
from ..schemas import InviteRequest, RoleRequest

router = APIRouter(prefix="/api/operators", tags=["operators"])


@router.get("/me")
def me(actor: CurrentOperator = Depends(current_operator)) -> dict[str, Any]:
    """Identity plus the permission list the UI mirrors."""
    return {"operator": actor.operator, "permissions": list(permissions_for(actor.role))}


@router.get("")
def list_members(
    actor: CurrentOperator = Depends(require("template:read")),
) -> dict[str, Any]:
    items = operators.list()
    return {"operators": items, "count": len(items)}


@router.post("", status_code=201)
def invite_member(
    body: InviteRequest,
    actor: CurrentOperator = Depends(require("users:manage")),
) -> dict[str, Any]:
    email = body.email.strip().lower()
    display_name = (body.displayName or email.split("@")[0]).strip() or email

    existing = operators.find_by_email(email)
    if existing is not None:
        if existing["revokedAt"] is None:
            raise conflict("That email already has access.", {"email": email})
        restored = operators.restore(
            existing["id"], display_name=display_name, email=email, role=body.role
        )
        audit.record(
            actor_id=actor.id,
            actor_role=actor.role,
            action="MEMBER_RESTORED",
            target_type="operator",
            target_id=restored["id"],
            details={"email": email, "role": body.role},
        )
        return {"operator": restored}

    created = operators.create(email=email, display_name=display_name, role=body.role)
    audit.record(
        actor_id=actor.id,
        actor_role=actor.role,
        action="MEMBER_INVITED",
        target_type="operator",
        target_id=created["id"],
        details={"email": email, "role": body.role},
    )
    return {"operator": created}


@router.patch("/{operator_id}/role")
def set_role(
    operator_id: str,
    body: RoleRequest,
    actor: CurrentOperator = Depends(require("users:manage")),
) -> dict[str, Any]:
    target = operators.find(operator_id)
    if target is None:
        raise not_found(f"Member {operator_id} not found.")
    if target["role"] == "admin":
        raise conflict("An admin's role cannot be changed here.", {"role": target["role"]})
    updated = operators.set_role(operator_id, body.role)
    if updated is None:
        raise not_found(f"Member {operator_id} not found.")
    audit.record(
        actor_id=actor.id,
        actor_role=actor.role,
        action="MEMBER_ROLE_CHANGED",
        target_type="operator",
        target_id=operator_id,
        details={"from": target["role"], "to": body.role},
    )
    return {"operator": updated}


@router.delete("/{operator_id}")
def revoke_member(
    operator_id: str,
    actor: CurrentOperator = Depends(require("users:manage")),
) -> dict[str, Any]:
    if operator_id == actor.id:
        raise bad_request("You cannot revoke your own access.")
    target = operators.find(operator_id)
    if target is None:
        raise not_found(f"Member {operator_id} not found.")
    revoked = operators.revoke(operator_id)
    if revoked is None:
        raise not_found(f"Member {operator_id} not found.")
    audit.record(
        actor_id=actor.id,
        actor_role=actor.role,
        action="MEMBER_REVOKED",
        target_type="operator",
        target_id=operator_id,
        details={"email": target["email"]},
    )
    return {"operator": revoked}
