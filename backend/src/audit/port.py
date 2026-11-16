"""
CASE — Audit & Transparency Layer
Audit port: the interface every module uses to record actions

Location: src/audit/port.py

Other modules (Standardization, Workflow Engine, AI, Ingress, Integrations)
import AuditLogger from here for their type hints and take an implementation
as a parameter. At runtime that implementation is AuditService
(src/audit/service.py); in tests it can be MemoryAuditLogger.

The Workflow Engine also needs ProvenanceSealer, to seal a request after it
logs EXECUTION_CLOSED. AuditService implements both, so the app passes the
same object for both parameters. MemoryAuditLogger and NullAuditLogger
implement both too, for tests.

This file is only the contract (AUDIT_MODULE_PLAN.md §8.1). It has no logic
and no imports from the rest of the Audit module, so depending on it does not
mean depending on Audit's internals.

The interface is async and takes an optional `session` so the real
AuditService can join a caller's database transaction (pattern A, §8.2).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    # Only needed for the type hint; port.py stays free of runtime imports.
    from psycopg import AsyncConnection

# AuditLogger is a protocol so that any class with a log_event method can be used as an AuditLogger.
# any action that needs log will take call log_event method of AuditLogger.
class AuditLogger(Protocol):
    async def log_event(self,
                        *,
                        workspace_id: str,
                        actor: str,
                        role: str,
                        action: str,
                        target: str,
                        source: str,
                        outcome: str,
                        details: dict[str, Any],
                        execution_id: str | None = None,
                        session: AsyncConnection | None = None) -> None: ...

# ProvenanceSealer: separate from AuditLogger because only the Workflow Engine seals requests.
# Keeping it apart means modules that only log (Standardization, Ingress) don't have to implement it.
class ProvenanceSealer(Protocol):
    async def seal_provenance(self, workspace_id: str, execution_id: str) -> Any:
        """Seal one closed request (AUDIT_MODULE_PLAN.md §8.4). Call it right after
        logging EXECUTION_CLOSED. The real AuditService returns the ProvenanceRecord
        and raises ProvenanceError (NOT_CLOSED / CHAIN_BROKEN) if it refuses."""
        ...

#used for actions that don't need to log events, such as in unit tests or before the Audit module exists.
class NullAuditLogger:
    """Default: does nothing. Used in unit tests and before the Audit module is connected."""

    async def log_event(self, **kwargs: Any) -> None:
        ...

    async def seal_provenance(self, workspace_id: str, execution_id: str) -> None:
        ...

#for testing purpose, we can use MemoryAuditLogger to store events in a list so that tests can assert on them.
class MemoryAuditLogger:
    """For tests: stores events and seal calls in lists so tests can assert on them.

    It does not check anything (no hashing, no NOT_CLOSED check). Use the real
    AuditService with InMemoryAuditRepository when a test needs that."""

    def __init__(self) -> None:
        self.events: list[dict] = []
        self.sealed: list[tuple[str, str]] = []   # (workspace_id, execution_id), in call order

    async def log_event(self, **kwargs: Any) -> None:
        self.events.append(kwargs)

    async def seal_provenance(self, workspace_id: str, execution_id: str) -> None:
        self.sealed.append((workspace_id, execution_id))


__all__ = ["AuditLogger", "ProvenanceSealer", "NullAuditLogger", "MemoryAuditLogger"]
