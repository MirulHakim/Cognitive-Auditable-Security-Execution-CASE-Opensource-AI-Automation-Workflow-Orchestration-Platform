"""
CASE — Shared storage
Migration runner: applies backend/migrations/*.sql in filename order

Location: src/storage/migrate.py

Run it as the table OWNER (case_owner), never as case_app (§6 role split):

    set CASE_MIGRATION_URL=postgresql://case_owner:case_owner_dev@localhost:5432/case_dev
    python -m src.storage.migrate

Each file runs in its own transaction and is recorded in `schema_migrations`,
so running the command again only applies new files. A file that fails is
rolled back completely and the files after it are not applied.

Never edit a migration that has already been applied; add a new numbered
file instead (e.g. 004_...sql).
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg

MIGRATION_URL_ENV = "CASE_MIGRATION_URL"
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"  # backend/migrations


def apply_migrations(conninfo: str, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Apply the .sql files not applied yet; return their names."""
    applied_now: list[str] = []
    # autocommit=True so each `with conn.transaction()` below is a real BEGIN/COMMIT.
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename   text PRIMARY KEY,
                applied_at timestamptz NOT NULL DEFAULT now()
            )""")
        done = {row[0] for row in conn.execute("SELECT filename FROM schema_migrations")}
        for path in sorted(directory.glob("*.sql")):
            if path.name in done:
                continue
            with conn.transaction():
                # No parameters: psycopg sends the file as-is, several statements allowed.
                conn.execute(path.read_text(encoding="utf-8"))
                conn.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))
            applied_now.append(path.name)
    return applied_now


def main() -> int:
    conninfo = os.environ.get(MIGRATION_URL_ENV)
    if not conninfo:
        print(f"Set {MIGRATION_URL_ENV} to the owner connection URL (see the docstring).", file=sys.stderr)
        return 2
    applied = apply_migrations(conninfo)
    print("Applied: " + ", ".join(applied) if applied else "Nothing to apply; database is up to date.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
