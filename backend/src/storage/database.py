"""
CASE — Shared storage
Database: one async PostgreSQL connection pool for every module

Location: src/storage/database.py

Every module (Audit, Standardization, Workflow Engine, ...) uses the same
Database object, so they share one pool and can share one transaction
(pattern A, AUDIT_MODULE_PLAN.md §8.2).

    db = Database()                 # reads DATABASE_URL
    await db.open()
    async with db.transaction() as tx:
        await tx.execute("INSERT ...")
        await audit.log_event(..., session=tx)
    # here: committed. If anything above raised: rolled back, nothing saved.

The app connects as `case_app` (INSERT/SELECT only on the audit tables), never
as the table owner, so it cannot disable the protection triggers (§6).

Windows note: psycopg's async mode cannot run on the default
ProactorEventLoop. Tests use a SelectorEventLoop (tests/audit/integration/
conftest.py); in Docker/Linux nothing needs to change.
"""

# database.py - Understanding Notes
#
# Pool:
# Opening a Postgres connection is slow (login, handshake). The pool keeps a
# few connections open and lends one to whoever needs it, then takes it back.
#
# transaction():
# "All or nothing". Borrow a connection, BEGIN, run the caller's statements,
# COMMIT if the block finished normally, ROLLBACK if it raised an error.
#
# connection():
# Borrow a connection for reads only (no need to think about commit).

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

DATABASE_URL_ENV = "DATABASE_URL"


class Database:
    """Async connection pool + transaction helper.

    `conninfo` is a Postgres URL, e.g.
    postgresql://case_app:case_app_dev@localhost:5432/case_dev
    If it is not given, DATABASE_URL is used. Extra keyword arguments are
    passed to every connection (e.g. options="-c TimeZone=Asia/Kuala_Lumpur").
    """

    def __init__(self, conninfo: str | None = None, *, min_size: int = 1, max_size: int = 10,
                 **connect_kwargs: Any) -> None:
        conninfo = conninfo or os.environ.get(DATABASE_URL_ENV)
        if not conninfo:
            raise RuntimeError(f"no database configured: pass conninfo or set {DATABASE_URL_ENV}")
        # open=False: the pool connects in open(), inside the running event loop.
        self._pool = AsyncConnectionPool(conninfo, min_size=min_size, max_size=max_size,
                                         kwargs=connect_kwargs or None, open=False)

    async def open(self) -> None:
        """Connect; waits until the first connections are ready, so a wrong URL fails here."""
        await self._pool.open(wait=True)

    async def close(self) -> None:
        await self._pool.close()

    async def __aenter__(self) -> Database:
        await self.open()
        return self

    async def __aexit__(self, *exc_info: Any) -> None:
        await self.close()

    @asynccontextmanager
    async def connection(self) -> AsyncIterator[AsyncConnection]:
        """Borrow a connection for reads; returned to the pool afterwards."""
        async with self._pool.connection() as conn:
            yield conn

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[AsyncConnection]:
        """Borrow a connection inside BEGIN ... COMMIT; ROLLBACK if the block raises."""
        async with self._pool.connection() as conn:
            async with conn.transaction():
                yield conn


__all__ = ["DATABASE_URL_ENV", "Database"]
