"""
CASE — Audit & Transparency Layer
Auth for the audit read API (AUDIT_MODULE_PLAN.md §3 rule 9, §9)

Location: src/audit/auth.py

TEMPORARY. The real `get_current_user` / `require_permission` belong to the
auth/RBAC owner (Amirul, §12.2 #6). Until they exist, this file provides the
same two dependencies with a mock user, and only when AUTH_MODE=mock.
Phase 6 swaps them for the real ones; routes.py does not change.

Mock mode reads the user from three request headers:
    X-Mock-User       actor id, e.g. u-aud-1     (default "mock-user")
    X-Mock-Role       ADMIN | OPERATOR | AUDITOR (required)
    X-Mock-Workspace  workspace UUID             (required)

Any other AUTH_MODE (or none) -> every request gets 503: fail closed, the
audit trail is never readable without some form of auth configured.
"""

# auth.py - Understanding Notes
#
# Two "guards" stand in front of every endpoint:
#   1. get_current_user   : WHO are you? (user id, role, workspace)
#   2. require_permission : are you ALLOWED to do this? (look up the role's list)
#
# ROLE_PERMISSIONS is a list per role, NOT a ranking (rule 9):
#   AUDITOR has export, ADMIN does not - even though ADMIN is "higher" elsewhere.
#
# When the answer is "no" (403), we log ACCESS_FORBIDDEN, best-effort (pattern C):
# if the log write fails, the 403 is still returned. Refusing must never depend
# on the audit log being up.

from __future__ import annotations

import logging
import os
from typing import Any, Callable, Mapping
from uuid import UUID

from fastapi import Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from .catalogue import AuditAction
from .schemas import ActorRoleEnum, OutcomeEnum

logger = logging.getLogger(__name__)

AUTH_MODE_ENV = "AUTH_MODE"

AUDIT_READ = "audit:read"
AUDIT_VERIFY = "audit:verify"
AUDIT_EXPORT = "audit:export"

# §3 rule 9. Must match the central role -> permission table once Amirul's exists.
ROLE_PERMISSIONS: Mapping[ActorRoleEnum, frozenset[str]] = {
    ActorRoleEnum.ADMIN: frozenset({AUDIT_READ, AUDIT_VERIFY}),
    ActorRoleEnum.OPERATOR: frozenset({AUDIT_READ, AUDIT_VERIFY}),
    ActorRoleEnum.AUDITOR: frozenset({AUDIT_READ, AUDIT_VERIFY, AUDIT_EXPORT}),
}
# Roles a person can log in with (SYSTEM and AI are not people).
HUMAN_ROLES = frozenset(ROLE_PERMISSIONS)


class CurrentUser(BaseModel):
    model_config = ConfigDict(frozen=True)

    user_id: str = Field(min_length=1, max_length=128)
    role: ActorRoleEnum
    workspace_id: UUID


class AuditAPIError(Exception):
    """An error the audit API returns in the shared envelope (routes.register_error_handlers)."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


def has_permission(role: ActorRoleEnum, permission: str) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, frozenset())


def _mock_user(request: Request) -> CurrentUser:
    role_text = request.headers.get("X-Mock-Role")
    workspace_text = request.headers.get("X-Mock-Workspace")
    if not role_text or not workspace_text:
        raise AuditAPIError(401, "AUTH_REQUIRED", "mock auth: send the X-Mock-Role and X-Mock-Workspace headers")
    try:
        role = ActorRoleEnum(role_text.upper())
        workspace_id = UUID(workspace_text)
    except ValueError:
        raise AuditAPIError(401, "AUTH_INVALID", "mock auth: unknown role or workspace is not a UUID") from None
    if role not in HUMAN_ROLES:
        raise AuditAPIError(401, "AUTH_INVALID", "mock auth: role must be ADMIN, OPERATOR or AUDITOR")
    user_id = request.headers.get("X-Mock-User") or "mock-user"
    try:
        return CurrentUser(user_id=user_id, role=role, workspace_id=workspace_id)
    except ValueError:
        raise AuditAPIError(401, "AUTH_INVALID", "mock auth: user id must be 1-128 characters") from None


async def get_current_user(request: Request) -> CurrentUser:
    """WHO is calling. Mock only for now (see the module docstring)."""
    if os.environ.get(AUTH_MODE_ENV, "").strip().lower() == "mock":
        return _mock_user(request)
    raise AuditAPIError(503, "AUTH_NOT_CONFIGURED",
                        "no auth provider is configured for the audit API (set AUTH_MODE=mock for development)")


def get_audit_logger(request: Request) -> Any:
    """The AuditService used to log ACCESS_FORBIDDEN; set by routes.configure_audit."""
    return getattr(request.app.state, "audit_service", None)


def require_permission(permission: str) -> Callable[..., Any]:
    """Dependency factory: `user = Depends(require_permission(AUDIT_EXPORT))`."""

    async def check(request: Request, user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if has_permission(user.role, permission):
            return user
        await _log_forbidden(get_audit_logger(request), user, permission, request.method)
        raise AuditAPIError(403, "FORBIDDEN", f"role {user.role.value} does not have permission {permission}")

    return check


async def _log_forbidden(audit: Any, user: CurrentUser, permission: str, method: str) -> None:
    """Pattern C (§8.2): best-effort. A failure is written to the app log, never raised."""
    if audit is None:
        logger.warning("ACCESS_FORBIDDEN not logged: no audit service configured")
        return
    try:
        await audit.log_event(
            workspace_id=str(user.workspace_id), actor=user.user_id, role=user.role.value,
            action=AuditAction.ACCESS_FORBIDDEN.value, target=f"permission:{permission}",
            source="WEB_APP", outcome=OutcomeEnum.FAILURE.value,
            details={"permission": permission, "method": method})
    except Exception as exc:  # noqa: BLE001 - pattern C: the 403 must still be returned
        # Error type only: the message could name user input.
        logger.warning("ACCESS_FORBIDDEN could not be logged (%s)", type(exc).__name__)


__all__ = [
    "AUTH_MODE_ENV", "AUDIT_READ", "AUDIT_VERIFY", "AUDIT_EXPORT", "ROLE_PERMISSIONS", "HUMAN_ROLES",
    "CurrentUser", "AuditAPIError", "has_permission", "get_current_user", "require_permission",
]
