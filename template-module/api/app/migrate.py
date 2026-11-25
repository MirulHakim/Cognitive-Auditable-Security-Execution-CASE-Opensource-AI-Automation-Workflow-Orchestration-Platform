"""Forward-only SQL migrations — the same contract as the Node runner.

Each ``*.sql`` file runs once, inside its own transaction, and is recorded in
``schema_migrations``. The files are byte-identical to the Node server's set
(plus 007, which widens the step vocabulary), so a database migrated by either
runtime stays usable by the other.
"""

from __future__ import annotations

from pathlib import Path

from .db import Database

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def apply_migrations(database: Database) -> list[str]:
    database.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """
    )

    applied = {
        row["filename"] for row in database.query("SELECT filename FROM schema_migrations")
    }

    ran: list[str] = []
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if path.name in applied:
            continue
        sql = path.read_text(encoding="utf-8")
        with database.connection() as conn:
            with conn.transaction():
                conn.execute(sql)
                conn.execute("INSERT INTO schema_migrations (filename) VALUES (%s)", (path.name,))
        ran.append(path.name)
    return ran


if __name__ == "__main__":  # pragma: no cover - manual helper
    from .db import db

    print("applied:", ", ".join(apply_migrations(db)) or "(nothing new)")
