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
# The "contract": any storage must have append, get_head, list_events, ...
# The service only talks to this contract, so we can swap the storage
# without changing service.py, verifier.py or canonical.py.
#
# Why 2 versions?
#   InMemoryAuditRepository  = unit tests je (fast, no Docker needed)
#   PostgresAuditRepository  = the real system (needs the database)
#
# append() does the SAME 5 steps in both versions:
#   1. Take the key for this workspace (one writer at a time, others wait)
#   2. Read the head (last seq + last hash)
#   3. build(head) -> the new event (next seq, previous hash copied in)
#   4. check_links() -> double-check it links correctly
#   5. Save the event, then move the head
#
# The only difference is the "key":
#   In memory : asyncio.Lock      (works inside one Python program only)
#   Postgres  : pg_advisory_xact_lock + SELECT ... FOR UPDATE
#               (works for every program using the same database;
#                key is given back automatically at COMMIT / ROLLBACK)
#
# Why lock?
# Without it, 2 requests could both read "last = 7" and both write seq 8.
#
# Why deep copy? (in-memory only)
# So the caller cannot accidentally change a stored event.
#
# Pattern A (Postgres only):
# If the caller passes session=tx, append() uses the caller's transaction and
# does NOT commit. The caller commits, so their change + the event are saved together.

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

from .canonical import GENESIS_HASH, normalize
from .schemas import AuditEvent, ChainVerificationResult, EventFilter, ExportRecord, ProvenanceRecord

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
    # transaction() added in Phase 3, to allow PostgresAuditRepository to be used in the service
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
    # save_verification() is added in Phase 3,to store verify_chain results (hash_chain_verifications, §5.5). The service calls it
    async def save_verification(self, result: ChainVerificationResult, *,
                                session: AsyncConnection | None = None) -> None:
        """Store one verify_chain result (hash_chain_verifications, §5.5)."""
        ...
    # list_verification() is added in Phase 3,to read them back (the service shows the last 10 in the workspace audit log). Phase 5 will use it
    async def list_verifications(self, workspace_id: UUID, *,
                                 limit: int | None = None) -> tuple[ChainVerificationResult, ...]:
        """Stored verification results, newest first."""
        ...

    # Phase 4 (provenance, §8.4-8.5)
    async def list_execution_events(self, workspace_id: UUID, execution_id: str) -> tuple[AuditEvent, ...]:
        """All events of one request, ordered by seq."""
        ...

    async def save_provenance(self, record: ProvenanceRecord, *,
                              session: AsyncConnection | None = None) -> bool:
        """Store a sealed record. Returns False (and stores nothing) if the
        request already has one: a request is sealed once (§8.4 step 7)."""
        ...

    async def get_provenance(self, workspace_id: UUID, execution_id: str) -> Optional[ProvenanceRecord]: ...

    # Phase 5 (read API + export, §8.6, §9): reads for the endpoints, plus the export log.
    async def query_events(self, workspace_id: UUID, filters: EventFilter, *, limit: int | None,
                           offset: int = 0, to_seq: int | None = None,
                           newest_first: bool = True) -> tuple[tuple[AuditEvent, ...], int]:
        """One page of the timeline: (events, total number matching the filters).
        to_seq caps the seq (an export reads only up to the head it reported)."""
        ...

    async def get_event(self, workspace_id: UUID, event_id: UUID) -> Optional[AuditEvent]: ...

    async def list_execution_ids(self, workspace_id: UUID, *, limit: int,
                                 offset: int = 0) -> tuple[tuple[str, ...], int]:
        """Request ids in this workspace, newest request first (by its first seq), and how many there are."""
        ...

    async def save_export(self, record: ExportRecord, *, session: AsyncConnection | None = None) -> None: ...

    async def list_exports(self, workspace_id: UUID, *, limit: int | None = None) -> tuple[ExportRecord, ...]:
        """Stored export records, newest first."""
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
        self._provenance: dict[tuple[UUID, str], ProvenanceRecord] = {}
        self._exports: dict[UUID, list[ExportRecord]] = {}

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[None]:
        yield None

    def _lock(self, workspace_id: UUID) -> asyncio.Lock:
        # No await between the lookup and the insert, so two tasks cannot create two locks.
        lock = self._locks.get(workspace_id)
        if lock is None:
            lock = self._locks[workspace_id] = asyncio.Lock()
        return lock

    # added in Phase 3, to allow the service to use the same interface for both InMemory and Postgres repositories
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

    async def list_execution_events(self, workspace_id: UUID, execution_id: str) -> tuple[AuditEvent, ...]:
        selected = sorted((e for e in self._events.get(workspace_id, ()) if e.execution_id == execution_id),
                          key=lambda e: e.seq)
        return tuple(e.model_copy(deep=True) for e in selected)

    async def save_provenance(self, record: ProvenanceRecord, *,
                              session: AsyncConnection | None = None) -> bool:
        key = (record.workspace_id, record.execution_id)
        if key in self._provenance:  # same rule as the UNIQUE constraint in Postgres
            return False
        self._provenance[key] = record  # frozen model, safe to keep
        return True

    async def get_provenance(self, workspace_id: UUID, execution_id: str) -> Optional[ProvenanceRecord]:
        record = self._provenance.get((workspace_id, execution_id))
        return None if record is None else record.model_copy(deep=True)

    async def query_events(self, workspace_id: UUID, filters: EventFilter, *, limit: int | None,
                           offset: int = 0, to_seq: int | None = None,
                           newest_first: bool = True) -> tuple[tuple[AuditEvent, ...], int]:
        selected = sorted((e for e in self._events.get(workspace_id, ())
                           if filters.matches(e) and (to_seq is None or e.seq <= to_seq)),
                          key=lambda e: e.seq, reverse=newest_first)
        page = selected[offset:] if limit is None else selected[offset:offset + limit]
        return tuple(e.model_copy(deep=True) for e in page), len(selected)

    async def get_event(self, workspace_id: UUID, event_id: UUID) -> Optional[AuditEvent]:
        event = next((e for e in self._events.get(workspace_id, ()) if e.event_id == event_id), None)
        return None if event is None else event.model_copy(deep=True)

    async def list_execution_ids(self, workspace_id: UUID, *, limit: int,
                                 offset: int = 0) -> tuple[tuple[str, ...], int]:
        first_seq: dict[str, int] = {}
        for e in self._events.get(workspace_id, ()):
            if e.execution_id is not None:
                first_seq[e.execution_id] = min(e.seq, first_seq.get(e.execution_id, e.seq))
        ordered = sorted(first_seq, key=lambda execution_id: first_seq[execution_id], reverse=True)
        return tuple(ordered[offset:offset + limit]), len(ordered)

    async def save_export(self, record: ExportRecord, *, session: AsyncConnection | None = None) -> None:
        self._exports.setdefault(record.workspace_id, []).append(record)  # frozen model, safe to keep

    async def list_exports(self, workspace_id: UUID, *, limit: int | None = None) -> tuple[ExportRecord, ...]:
        newest_first = list(reversed(self._exports.get(workspace_id, ())))
        return tuple(newest_first if limit is None else newest_first[:limit])


# ============================================================================
# PostgreSQL (Phase 3)
# ============================================================================

# Column names = model field names, in the same order. Built from the models so
# the SQL cannot drift from them; never from user input, so the f-strings are safe.
_EVENT_COLUMNS = tuple(AuditEvent.model_fields)
_VERIFICATION_COLUMNS = tuple(ChainVerificationResult.model_fields)
_PROVENANCE_COLUMNS = tuple(ProvenanceRecord.model_fields)
_EXPORT_COLUMNS = tuple(ExportRecord.model_fields)
# These provenance columns are jsonb (001_audit_tables.sql).
_PROVENANCE_JSON = ("objective", "decision", "approvals", "execution", "result", "event_ids", "event_hashes")


def _insert_sql(table: str, columns: tuple[str, ...]) -> str:
    return (f"INSERT INTO {table} ({', '.join(columns)}) "
            f"VALUES ({', '.join(f'%({c})s' for c in columns)})")


_INSERT_EVENT = _insert_sql("audit_events", _EVENT_COLUMNS)
_INSERT_VERIFICATION = _insert_sql("hash_chain_verifications", _VERIFICATION_COLUMNS)
_INSERT_EXPORT = _insert_sql("audit_exports", _EXPORT_COLUMNS)

# EventFilter field -> SQL condition. Fixed text only; the values always go in as parameters.
_FILTER_SQL: dict[str, str] = {
    "date_from": "event_timestamp >= %(date_from)s",
    "date_to": "event_timestamp <= %(date_to)s",
    "action": "action = %(action)s",
    "actor_id": "actor_id = %(actor_id)s",
    "actor_role": "actor_role = %(actor_role)s",
    "outcome": "outcome = %(outcome)s",
    "execution_id": "execution_id = %(execution_id)s",
}
# A second seal of the same request inserts nothing and returns no row (§8.4 step 7).
_INSERT_PROVENANCE = (_insert_sql("provenance_records", _PROVENANCE_COLUMNS)
                      + " ON CONFLICT (workspace_id, execution_id) DO NOTHING RETURNING provenance_id")


def _provenance_values(record: ProvenanceRecord) -> dict[str, Any]:
    """The jsonb parts are written with the same rules as the hash (canonical.normalize),
    so a record read back recomputes to the same record_hash."""
    plain = normalize(record.model_dump())
    values = dict(record)
    for name in _PROVENANCE_JSON:
        values[name] = Jsonb(plain[name])
    return values


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
        # Use the caller's transaction if given (pattern A), otherwise open our own.
        async with self._use(session) as conn:
            # STEP 1: take the key for this workspace.
            # Only one request can write at a time; the others wait in line.
            # The key is given back automatically when the transaction ends.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s::text, 0))",
                               (str(workspace_id),))
            # STEP 2: read the head (last seq + last hash). None = first event ever.
            # FOR UPDATE = extra lock on the head row while we use it.
            rows = await _fetch_all(conn, "SELECT workspace_id, last_seq, last_hash, updated_at "
                                          "FROM audit_chain_heads WHERE workspace_id = %s FOR UPDATE",
                                    (workspace_id,))
            head = ChainHead(**rows[0]) if rows else None

            # STEP 3: build the new event (next seq, previous hash copied in).
            event = build(head)
            # STEP 4: double-check it links correctly to the head.
            check_links(workspace_id, head, event)

            # STEP 5: save the event FIRST, then move the head.
            # (Order matters: the 002 trigger (from backend\migrations\002_audit_protection) only accepts a head that points to a saved event.)
            await conn.execute(_INSERT_EVENT, _row_values(event))
            head_values = {"workspace_id": workspace_id, "last_seq": event.seq,
                           "last_hash": event.current_hash, "updated_at": event.event_timestamp}
            if head is None:  # first event: create the head
                await conn.execute("INSERT INTO audit_chain_heads (workspace_id, last_seq, last_hash, updated_at) "
                                   "VALUES (%(workspace_id)s, %(last_seq)s, %(last_hash)s, %(updated_at)s)",
                                   head_values)
            else:  # later events: move the head forward by one
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

    async def list_execution_events(self, workspace_id: UUID, execution_id: str) -> tuple[AuditEvent, ...]:
        # Uses the (workspace_id, execution_id, seq) index from 001.
        query = (f"SELECT {', '.join(_EVENT_COLUMNS)} FROM audit_events "
                 "WHERE workspace_id = %s AND execution_id = %s ORDER BY seq")
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, (workspace_id, execution_id))
        return tuple(AuditEvent(**row) for row in rows)

    async def save_provenance(self, record: ProvenanceRecord, *,
                              session: AsyncConnection | None = None) -> bool:
        async with self._use(session) as conn:
            rows = await _fetch_all(conn, _INSERT_PROVENANCE, _provenance_values(record))
        return bool(rows)

    async def get_provenance(self, workspace_id: UUID, execution_id: str) -> Optional[ProvenanceRecord]:
        query = (f"SELECT {', '.join(_PROVENANCE_COLUMNS)} FROM provenance_records "
                 "WHERE workspace_id = %s AND execution_id = %s")
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, (workspace_id, execution_id))
        return ProvenanceRecord(**rows[0]) if rows else None

    async def query_events(self, workspace_id: UUID, filters: EventFilter, *, limit: int | None,
                           offset: int = 0, to_seq: int | None = None,
                           newest_first: bool = True) -> tuple[tuple[AuditEvent, ...], int]:
        params: dict[str, Any] = {"workspace_id": workspace_id, "to_seq": to_seq, "limit": limit, "offset": offset}
        conditions = ["workspace_id = %(workspace_id)s"]
        for name, value in filters:
            if value is not None:
                conditions.append(_FILTER_SQL[name])
                params[name] = value.value if isinstance(value, Enum) else value
        if to_seq is not None:
            conditions.append("seq <= %(to_seq)s")
        where = " AND ".join(conditions)
        query = (f"SELECT {', '.join(_EVENT_COLUMNS)} FROM audit_events WHERE {where} "
                 f"ORDER BY seq {'DESC' if newest_first else 'ASC'}")
        if limit is not None:
            query += " LIMIT %(limit)s"
        query += " OFFSET %(offset)s"
        async with self._db.connection() as conn:
            total = (await _fetch_all(conn, f"SELECT count(*) AS total FROM audit_events WHERE {where}", params))
            rows = await _fetch_all(conn, query, params)
        return tuple(AuditEvent(**row) for row in rows), total[0]["total"]

    async def get_event(self, workspace_id: UUID, event_id: UUID) -> Optional[AuditEvent]:
        query = (f"SELECT {', '.join(_EVENT_COLUMNS)} FROM audit_events "
                 "WHERE workspace_id = %s AND event_id = %s")
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, (workspace_id, event_id))
        return AuditEvent(**rows[0]) if rows else None

    async def list_execution_ids(self, workspace_id: UUID, *, limit: int,
                                 offset: int = 0) -> tuple[tuple[str, ...], int]:
        where = "workspace_id = %(workspace_id)s AND execution_id IS NOT NULL"
        params = {"workspace_id": workspace_id, "limit": limit, "offset": offset}
        async with self._db.connection() as conn:
            total = await _fetch_all(conn, f"SELECT count(DISTINCT execution_id) AS total FROM audit_events "
                                           f"WHERE {where}", params)
            rows = await _fetch_all(conn, f"SELECT execution_id FROM audit_events WHERE {where} "
                                          "GROUP BY execution_id ORDER BY min(seq) DESC "
                                          "LIMIT %(limit)s OFFSET %(offset)s", params)
        return tuple(row["execution_id"] for row in rows), total[0]["total"]

    async def save_export(self, record: ExportRecord, *, session: AsyncConnection | None = None) -> None:
        async with self._use(session) as conn:
            await conn.execute(_INSERT_EXPORT, _row_values(record))

    async def list_exports(self, workspace_id: UUID, *, limit: int | None = None) -> tuple[ExportRecord, ...]:
        query = (f"SELECT {', '.join(_EXPORT_COLUMNS)} FROM audit_exports "
                 "WHERE workspace_id = %(workspace_id)s ORDER BY exported_at DESC, export_id")
        if limit is not None:
            query += " LIMIT %(limit)s"
        async with self._db.connection() as conn:
            rows = await _fetch_all(conn, query, {"workspace_id": workspace_id, "limit": limit})
        return tuple(ExportRecord(**row) for row in rows)


__all__ = ["ChainHead", "EventBuilder", "AuditRepository", "InMemoryAuditRepository", "PostgresAuditRepository"]
