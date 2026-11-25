"""Identity and authorisation.

The identity is the ``x-operator-id`` header the dashboard sends: a member id
(``ops-admin``) or a whitelisted email (``aisyah@workspace.local``). The server
resolves it on every request and never trusts a role sent by the browser.
"""

from __future__ import annotations

from typing import Any, Callable

from fastapi import Request

from .errors import forbidden, unauthorized
from .repos import OperatorRepo

PERMISSIONS = (
    "template:read",
    "template:create",
    "template:generate",
    "template:edit",
    "template:deactivate",
    "template:approve",
    "workflow:read",
    "workflow:start",
    "workflow:respond",
    "workflow:cancel",
    "users:manage",
    "audit:read",
)

READ_ONLY = ("template:read", "workflow:read", "audit:read")

ROLE_PERMISSIONS: dict[str, tuple[str, ...]] = {
    "auditor": READ_ONLY,
    "operator": READ_ONLY
    + (
        "template:create",
        "template:generate",
        "template:edit",
        "template:deactivate",
        "template:approve",
        "workflow:start",
        "workflow:respond",
        "workflow:cancel",
    ),
    "admin": PERMISSIONS,
}


def permissions_for(role: str) -> tuple[str, ...]:
    return ROLE_PERMISSIONS.get(role, ())


def has_permission(role: str, permission: str) -> bool:
    return permission in permissions_for(role)


class CurrentOperator:
    def __init__(self, operator: dict[str, Any]) -> None:
        self.operator = operator

    @property
    def id(self) -> str:
        return str(self.operator["id"])

    @property
    def role(self) -> str:
        return str(self.operator["role"])

    @property
    def permissions(self) -> tuple[str, ...]:
        return permissions_for(self.role)

    def can(self, permission: str) -> bool:
        return has_permission(self.role, permission)


def _repo(request: Request) -> OperatorRepo:
    return request.app.state.operators


def current_operator(request: Request) -> CurrentOperator:
    """FastAPI dependency: resolve the header, refuse unknown or revoked people."""
    header = request.headers.get("x-operator-id") or ""
    identifier = header.strip()
    if not identifier:
        raise unauthorized("Sign in to continue.")

    operator = _repo(request).resolve(identifier)
    if operator is None or operator.get("revokedAt"):
        raise unauthorized("That identity is not recognised or has been revoked.")
    return CurrentOperator(operator)


def require(permission: str) -> Callable[[Request], CurrentOperator]:
    def dependency(request: Request) -> CurrentOperator:
        actor = current_operator(request)
        if not actor.can(permission):
            raise forbidden(permission)
        return actor

    return dependency
