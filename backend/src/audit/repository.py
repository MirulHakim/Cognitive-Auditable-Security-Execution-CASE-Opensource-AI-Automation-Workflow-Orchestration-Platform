"""
CASE — Audit & Transparency Layer
Repository: where events and chain heads are stored

Location: src/audit/repository.py

AuditRepository is the interface. PostgresAuditRepository is the real
storage (Phase 3); InMemoryAuditRepository is used in unit tests.

`append` owns the critical section: it reads the chain head, calls the
service's `build(head)` (a pure step that assigns seq/previous_hash and
computes the hash), stores the event and advances the head, all under one
per-workspace lock. In memory the lock is an asyncio.Lock; in Postgres it is
the advisory lock plus `SELECT ... FOR UPDATE`, inside one transaction (§8.1).
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
#
# PostgresAuditRepository.append() (Phase 3) - same steps, in the database:
# 1. Use the caller's transaction (session) or open a new one.
# 2. pg_advisory_xact_lock(workspace): the database version of the workspace
#    lock. Other transactions for the same workspace wait here until this one
#    commits or rolls back. Works across processes, not only inside one Python.
# 3. SELECT the head ... FOR UPDATE (also locks the head row).
# 4. build(head) + check_links(), exactly like in memory.
# 5. INSERT the event, then INSERT/UPDATE the head (002 trigger checks it).
# 6. Commit only if step 1 opened the transaction; with a session the caller
#    commits, so the event and the caller's change are saved together (pattern A).

from __future__ import annotations

import asyncio
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import TYPE_CHECKING, Any, AsyncIterator, Callable, Optional, Protocol
from uuid import UUID

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from pydantic import BaseModel

from .canonical import GENESIS_HASH
from .schemas import AuditEvent, ChainVerificationResult

if TYPE_CHECKING:
    from psycopg import AsyncConnection

    from ..storage.database import Database

@dataclass(frozen=True)
class ChainHead:
    """Last event of a workspace chain (§5.3)."""
    workspace_id: UUID
    last_seq: int
    last_hash: str
    updated_at: datetime


EventBuilder = Callable[[Optional[ChainHead]], AuditEvent]


class AuditRepository(Protocol):
    def transaction(self) -> AbstractAsyncContextManager[AsyncConnection | None]:
        """A transaction owned by Audit: pass what it yields as `session` to several
        writes so they are saved together (e.g. a verification result and its log event)."""
        ...

    async def append(self, workspace_id: UUID, build: EventBuilder, *,
                     session: AsyncConnection | None = None) -> AuditEvent: ...

    async def get_head(self, workspace_id: UUID) -> Optional[ChainHead]: ...

    async def list_events(self, workspace_id: UUID, *, from_seq: int | None = None,
                          to_seq: int | None = None, limit: int | None = None) -> tuple[AuditEvent, ...]:
        """Events with from_seq <= seq <= to_seq, ordered by seq, at most `limit`
        of them (the verifier reads in batches of 1,000)."""
        ...

    async def save_verification(self, result: ChainVerificationResult, *,
                                session: AsyncConnection | None = None) -> None:
        """Store one verify_chain result (hash_chain_verifications, §5.5)."""
        ...

    async def list_verifications(self, workspace_id: UUID, *,
                                 limit: int | None = None) -> tuple[ChainVerificationResult, ...]:
        """Stored verification results, newest first."""
        ...

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
    this class can change a stored event by accident. (The tamper tests in
    tests/audit/test_verifier.py reach `_events` / `_heads` explicitly.)

    `session` is accepted for interface compatibility and ignored: there are
    no transactions here, and `transaction()` yields None. Commit/rollback
    behaviour is tested against Postgres (tests/audit/integration/).
    """

    def __init__(self) -> None:
        self._events: dict[UUID, list[AuditEvent]] = {}
        self._heads: dict[UUID, ChainHead] = {}
        self._locks: dict[UUID, asyncio.Lock] = {}
        self._verifications: dict[UUID, list[ChainVerificationResult]] = {}

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield None

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
                          to_seq: int | None = None, limit: int | None = None) -> tuple[AuditEvent, ...]:
        # Sorted by seq like the Postgres query (ORDER BY seq): storage order is not
        # evidence, so a tamper test that swaps rows has to change their seq values.
        selected = sorted(
            (event for event in self._events.get(workspace_id, ())
             if (from_seq is None or event.seq >= from_seq) and (to_seq is None or event.seq <= to_seq)),
            key=lambda event: event.seq,
        )
        if limit is not None:
            selected = selected[:limit]
        return tuple(event.model_copy(deep=True) for event in selected)

    async def save_verification(self, result: ChainVerificationResult, *,
                                session: AsyncConnection | None = None) -> None:
        self._verifications.setdefault(result.workspace_id, []).append(result)  # frozen model, safe to keep

    async def list_verifications(self, workspace_id: UUID, *,
                                 limit: int | None = None) -> tuple[ChainVerificationResult, ...]:
        newest_first = list(reversed(self._verifications.get(workspace_id, ())))
        return tuple(newest_first if limit is None else newest_first[:limit])


# ============================================================================
# PostgreSQL (Phase 3)
# ============================================================================

# Column names = model field names, in the same order. Built from the models so
# the SQL cannot drift from them; never from user input, so the f-strings are safe.
_EVENT_COLUMNS = tuple(AuditEvent.model_fields)
_VERIFICATION_COLUMNS = tuple(ChainVerificationResult.model_fields)


def _insert_sql(table: str, columns: tuple[str, ...]) -> str:
    return (f"INSERT INTO {table} ({', '.join(columns)}) "
            f"VALUES ({', '.join(f'%({c})s' for c in columns)})")


_INSERT_EVENT = _insert_sql("audit_events", _EVENT_COLUMNS)
_INSERT_VERIFICATION = _insert_sql("hash_chain_verifications", _VERIFICATION_COLUMNS)


def _row_values(model: BaseModel) -> dict[str, Any]:
    """Model -> query parameters: enums as their text value, dicts as jsonb."""
    values = dict(model)
    for name, value in values.items():
        if isinstance(value, Enum):
            values[name] = value.value
        elif isinstance(value, dict):
            values[name] = Jsonb(value)
    return values


async def _fetch_all(conn: AsyncConnection, query: str, params: Any = None) -> list[dict[str, Any]]:
    async with conn.cursor(row_factory=dict_row) as cur:
        await cur.execute(query, params)
        return await cur.fetchall()


def _require_open_transaction(session: Any) -> None:
    # In autocommit mode every statement commits on its own: the advisory lock
    # would be released at once and the event could be saved without its head.
    if getattr(session, "autocommit", True):
        raise RuntimeError("session must be a psycopg connection inside a transaction (autocommit off), "
                           "e.g. from Database.transaction()")


class PostgresAuditRepository:
    """Audit storage in PostgreSQL, through the shared Database pool.

    The app connects as case_app; the tables and their protection triggers
    come from backend/migrations/ (§6).
    """

    def __init__(self, database: Database) -> None:
        self._db = database

    def transaction(self) -> AbstractAsyncContextManager[AsyncConnection]:
        return self._db.transaction()

    @asynccontextmanager
    async def _use(self, session: AsyncConnection | None) -> AsyncIterator[AsyncConnection]:
        """The caller's transaction if given (never committed here), otherwise our own."""
        if session is None:
            async with self._db.transaction() as conn:
                yield conn
        else:
            _require_open_transaction(session)
            yield session

    async def append(self, workspace_id: UUID, build: EventBuilder, *,
                     session: AsyncConnection | None = None) -> AuditEvent:
        async with self._use(session) as conn:
            # Lock key = a 64-bit hash of the workspace id. Two workspaces sharing
            # a key would only wait for each other; they still get separate chains.
            # The lock is released automatically at COMMIT or ROLLBACK.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s::text, 0))",
                               (str(workspace_id),))
            # The advisory lock is what serialises writers, including the very first
            # event (there is no head row to lock yet). FOR UPDATE also locks the head
            # row against anything that does not take the advisory lock.
            rows = await _fetch_all(conn, "SELECT workspace_id, last_seq, last_hash, updated_at "
                                          "FROM audit_chain_heads WHERE workspace_id = %s FOR UPDATE",
                                    (workspace_id,))
            head = ChainHead(**rows[0]) if rows else None

            event = build(head)
            check_links(workspace_id, head, event)

            # Event first, then head: the head trigger checks that the event exists.
            await conn.execute(_INSERT_EVENT, _row_values(event))
            head_values = {"workspace_id": workspace_id, "last_seq": event.seq,
                           "last_hash": event.current_hash, "updated_at": event.event_timestamp}
            if head is None:
                await conn.execute("INSERT INTO audit_chain_heads (workspace_id, last_seq, last_hash, updated_at) "
                                   "VALUES (%(workspace_id)s, %(last_seq)s, %(last_hash)s, %(updated_at)s)",
                                   head_values)
            else:
                await conn.execute("UPDATE audit_chain_heads SET last_seq = %(last_seq)s, "
                                   "last_hash = %(last_hash)s, updated_at = %(updated_at)s "
                                   "WHERE workspace_id = %(workspace_id)s", head_values)
        return event

    async def get_head(self, workspace_id: UUID) -> Optional[ChainHead]:
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, "SELECT workspace_id, last_seq, last_hash, updated_at "
                                          "FROM audit_chain_heads WHERE workspace_id = %s", (workspace_id,))
        return ChainHead(**rows[0]) if rows else None

    async def list_events(self, workspace_id: UUID, *, from_seq: int | None = None,
                          to_seq: int | None = None, limit: int | None = None) -> tuple[AuditEvent, ...]:
        conditions = ["workspace_id = %(workspace_id)s"]
        if from_seq is not None:
            conditions.append("seq >= %(from_seq)s")
        if to_seq is not None:
            conditions.append("seq <= %(to_seq)s")
        query = f"SELECT {', '.join(_EVENT_COLUMNS)} FROM audit_events WHERE {' AND '.join(conditions)} ORDER BY seq"
        if limit is not None:
            query += " LIMIT %(limit)s"
        params = {"workspace_id": workspace_id, "from_seq": from_seq, "to_seq": to_seq, "limit": limit}
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, params)
        return tuple(AuditEvent(**row) for row in rows)

    async def save_verification(self, result: ChainVerificationResult, *,
                                session: AsyncConnection | None = None) -> None:
        async with self._use(session) as conn:
            await conn.execute(_INSERT_VERIFICATION, _row_values(result))

    async def list_verifications(self, workspace_id: UUID, *,
                                 limit: int | None = None) -> tuple[ChainVerificationResult, ...]:
        query = (f"SELECT {', '.join(_VERIFICATION_COLUMNS)} FROM hash_chain_verifications "
                 "WHERE workspace_id = %(workspace_id)s ORDER BY verified_at DESC, verification_id")
        if limit is not None:
            query += " LIMIT %(limit)s"
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, {"workspace_id": workspace_id, "limit": limit})
        return tuple(ChainVerificationResult(**row) for row in rows)


__all__ = ["ChainHead", "EventBuilder", "AuditRepository", "InMemoryAuditRepository", "PostgresAuditRepository"]
