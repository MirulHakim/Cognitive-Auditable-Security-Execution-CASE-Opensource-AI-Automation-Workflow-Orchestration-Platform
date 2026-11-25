"""PostgreSQL access.

A deliberately small pool: FastAPI runs the synchronous route handlers on its
thread pool, so a short-lived, thread-reused connection per slot is enough and
keeps the runtime dependencies to psycopg itself.
"""

from __future__ import annotations

import threading
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg.rows import dict_row

from .config import settings


class Database:
    def __init__(self, url: str, max_connections: int = 8) -> None:
        self._url = url
        self._max = max_connections
        self._idle: list[psycopg.Connection[Any]] = []
        self._lock = threading.Lock()
        self._all: list[psycopg.Connection[Any]] = []

    # -- lifecycle ---------------------------------------------------------
    def open(self) -> None:
        # Touch one connection early so a bad DSN fails at startup, not on the
        # first request.
        with self.connection() as conn:
            conn.execute("SELECT 1")

    def close(self) -> None:
        with self._lock:
            connections, self._all = self._all, []
            self._idle = []
        for conn in connections:
            try:
                conn.close()
            except Exception:  # pragma: no cover - best effort shutdown
                pass

    def _borrow(self) -> psycopg.Connection[Any]:
        with self._lock:
            if self._idle:
                return self._idle.pop()
            if len(self._all) < self._max:
                conn = psycopg.connect(self._url, row_factory=dict_row)
                self._all.append(conn)
                return conn
        # Pool exhausted: fall back to a dedicated connection for this call.
        return psycopg.connect(self._url, row_factory=dict_row)

    def _give_back(self, conn: psycopg.Connection[Any]) -> None:
        if conn.closed:
            return
        with self._lock:
            if len(self._idle) < self._max:
                self._idle.append(conn)
                return
        conn.close()

    @contextmanager
    def connection(self) -> Iterator[psycopg.Connection[Any]]:
        conn = self._borrow()
        try:
            yield conn
            if not conn.autocommit:
                conn.commit()
        except Exception:
            if not conn.closed:
                conn.rollback()
            raise
        finally:
            self._give_back(conn)

    # -- helpers -----------------------------------------------------------
    def query(self, sql: str, params: Sequence[Any] | None = None) -> list[dict[str, Any]]:
        with self.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params or ())
                return list(cur.fetchall()) if cur.description else []

    def one(self, sql: str, params: Sequence[Any] | None = None) -> dict[str, Any] | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def execute(self, sql: str, params: Sequence[Any] | None = None) -> None:
        with self.connection() as conn:
            conn.execute(sql, params or ())


db = Database(settings.database_url)
