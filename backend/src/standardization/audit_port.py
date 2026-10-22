"""
CASE — Data Standardization & Normalization Layer
Audit port (Step 4)

Location: src/standardization/audit_port.py

The Audit module is built separately (Ain's module 3). This module must not
import its internals - it defines a small interface here and takes an
implementation as a parameter instead, so standardization can be used (and
tested) before the real Audit module exists.

The interface is async and takes an optional `session` (AUDIT_MODULE_PLAN.md
§8.1) so the real AuditService can join a caller's database transaction.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    # psycopg is added in Audit Phase 3; only needed for the type hint.
    from psycopg import AsyncConnection


class AuditLogger(Protocol):
    async def log_event(self, *, workspace_id: str, actor: str, role: str, action: str,
                        target: str, source: str, outcome: str, details: dict[str, Any],
                        execution_id: str | None = None,
                        session: AsyncConnection | None = None) -> None: ...


class NullAuditLogger:
    """Default: does nothing. Used in unit tests and before the Audit module exists."""

    async def log_event(self, **kwargs: Any) -> None:
        ...


class MemoryAuditLogger:
    """For tests: stores events in a list so tests can assert on them."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    async def log_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)


__all__ = ["AuditLogger", "NullAuditLogger", "MemoryAuditLogger"]
