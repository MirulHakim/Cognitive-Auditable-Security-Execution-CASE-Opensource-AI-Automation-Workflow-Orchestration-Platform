"""
CASE — Audit & Transparency Layer
Repository: where events and chain heads are stored

Location: src/audit/repository.py

AuditRepository is the interface; InMemoryAuditRepository is used until the
Postgres repository (Phase 3) and in tests.

`append` owns the critical section: it reads the chain head, calls the
service's `build(head)` (a pure step that assigns seq/previous_hash and
computes the hash), stores the event and advances the head, all under one
per-workspace lock. The Postgres version does the same inside one
transaction with the advisory lock and `SELECT ... FOR UPDATE` (§8.1).
"""

# repository.py - Understanding Notes
#
# ChainHead:
# Tracks the last sequence number and hash for each workspace.
# Helps detect tail truncation during integrity verification.
#
# AuditRepository:
# Defines the repository interface (append, get_head, list_events).
# Allows different storage implementations using the same contract.
#
# InMemoryAuditRepository.append():
# 1. Acquire the workspace lock.
# 2. Read the latest chain head.
# 3. Yield to the event loop (simulates database latency).
# 4. Call build(head) to construct the next audit event.
# 5. Validate sequence and previous_hash using check_links().
# 6. Store the event.
# 7. Update the chain head.
# 8. Release the lock and return a deep copy.
#
# Why lock?
# Prevents concurrent requests from creating duplicate sequence
# numbers or building events from the same previous hash.
#
# Why deep copy?
# Prevents callers from accidentally modifying stored events.

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Callable, Optional, Protocol
from uuid import UUID

from .canonical import GENESIS_HASH
from .schemas import AuditEvent

if TYPE_CHECKING:
    # psycopg is added in Audit Phase 3; only needed for the type hint.
    from psycopg import AsyncConnection

@dataclass(frozen=True)
class ChainHead:
    """Last event of a workspace chain (§5.3)."""
    workspace_id: UUID
    last_seq: int
    last_hash: str
    updated_at: datetime


EventBuilder = Callable[[Optional[ChainHead]], AuditEvent]


class AuditRepository(Protocol):
    async def append(self, workspace_id: UUID, build: EventBuilder, *,
                     session: AsyncConnection | None = None) -> AuditEvent: ...

    async def get_head(self, workspace_id: UUID) -> Optional[ChainHead]: ...

    async def list_events(self, workspace_id: UUID, *, from_seq: int | None = None,
                          to_seq: int | None = None) -> tuple[AuditEvent, ...]: ...

#nak validate that a newly built audit event correctly
#continues the current workspace hash chain.
def check_links(workspace_id: UUID, 
                head: Optional[ChainHead], 
                event: AuditEvent
                ) -> None:
    """Guard against a builder that does not continue the chain from `head`."""
    expected_seq = 1 if head is None else head.last_seq + 1
    expected_previous = GENESIS_HASH if head is None else head.last_hash
    if event.workspace_id != workspace_id or event.seq != expected_seq or event.previous_hash != expected_previous:
        raise RuntimeError(
            f"built event does not continue the chain (expected seq {expected_seq} in workspace {workspace_id})"
        )


class InMemoryAuditRepository:
    """In-process storage with one asyncio.Lock per workspace.

    Reads return deep copies, never the internal lists, so nothing outside
    this class can change a stored event by accident. (Phase 2 tamper tests
    reach the internal storage explicitly.)

    `session` is accepted for interface compatibility and ignored: there are
    no transactions here. Commit/rollback behaviour is tested against
    Postgres in Phase 3.
    """

    def __init__(self) -> None:
        self._events: dict[UUID, list[AuditEvent]] = {}
        self._heads: dict[UUID, ChainHead] = {}
        self._locks: dict[UUID, asyncio.Lock] = {}

    def _lock(self, workspace_id: UUID) -> asyncio.Lock:
        # No await between the lookup and the insert, so two tasks cannot create two locks.
        lock = self._locks.get(workspace_id)
        if lock is None:
            lock = self._locks[workspace_id] = asyncio.Lock()
        return lock

    async def append(self, workspace_id: UUID, build: EventBuilder, *,
                     session: AsyncConnection | None = None) -> AuditEvent:
        async with self._lock(workspace_id): #lock workspace_id, request lain untuk same workspace kena tunggu
            head = self._heads.get(workspace_id)
            # Stands in for the database round trips between reading the head and
            # inserting: other tasks get to run here, so the lock is what keeps the
            # chain from forking (exercised by the 50-parallel test).
            await asyncio.sleep(0)
            event = build(head) #panggil function builder from Audit Service, untuk build event baru. event baru ni akan ada seq dan previous_hash yang betul
            check_links(workspace_id, head, event) #make sure event baru ni betul betul connect to chain
            self._events.setdefault(workspace_id, []).append(event) #store event baru ke dalam list of events for that workspace
            self._heads[workspace_id] = ChainHead(workspace_id=workspace_id, last_seq=event.seq, #store new head for the workspave
                                                  last_hash=event.current_hash, updated_at=event.event_timestamp)
        return event.model_copy(deep=True) #caller hanya dapat salinan copy, bukan original. so caller tak boleh ubah event yang dah disimpan

    async def get_head(self, workspace_id: UUID) -> Optional[ChainHead]:
        return self._heads.get(workspace_id)

    async def list_events(self, workspace_id: UUID, *, from_seq: int | None = None,
                          to_seq: int | None = None) -> tuple[AuditEvent, ...]:
        return tuple(
            event.model_copy(deep=True)
            for event in self._events.get(workspace_id, ())
            if (from_seq is None or event.seq >= from_seq) and (to_seq is None or event.seq <= to_seq)
        )


__all__ = ["ChainHead", "EventBuilder", "AuditRepository", "InMemoryAuditRepository"]
