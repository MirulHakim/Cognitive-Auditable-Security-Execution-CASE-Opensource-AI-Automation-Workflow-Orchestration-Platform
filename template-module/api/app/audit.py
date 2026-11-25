"""Append-only audit trail with a SHA-256 hash chain.

A byte-for-byte port of ``server/src/audit/auditLog.ts`` so chains written by the
Node server verify here and vice versa:

    hash = sha256( JSON.stringify([seq, recordedAt, actorId, actorRole, action,
                                   targetType, targetId, outcome, details])
                   + "|" + prevHash )

``details`` is canonicalised (object keys sorted at every level) before hashing.
Writers serialise on a Postgres advisory lock, so concurrent requests still
produce one linear chain.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from .db import Database
from .schemas import iso_utc

GENESIS_HASH = "0" * 64
CHAIN_LOCK_KEY = 728_931_401

COLUMNS = (
    "audit_id, event_seq, recorded_at, actor_id, actor_role, action, "
    "target_type, target_id, outcome, details, prev_hash, hash"
)


def canonicalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: canonicalize(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [canonicalize(item) for item in value]
    return value


def compute_audit_hash(payload: dict[str, Any], prev_hash: str) -> str:
    body = json.dumps(
        [
            payload["sequence"],
            payload["recordedAt"],
            payload["actorId"],
            payload["actorRole"],
            payload["action"],
            payload["targetType"],
            payload["targetId"],
            payload["outcome"],
            canonicalize(payload["details"]),
        ],
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(f"{body}|{prev_hash}".encode("utf-8")).hexdigest()


def _to_event(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(row["audit_id"]),
        "sequence": int(row["event_seq"]),
        "recordedAt": iso_utc(row["recorded_at"]),
        "actorId": row["actor_id"],
        "actorRole": row["actor_role"],
        "action": row["action"],
        "targetType": row["target_type"] or "",
        "targetId": row["target_id"] or "",
        "outcome": row["outcome"],
        "details": row["details"] or {},
        "prevHash": row["prev_hash"],
        "hash": row["hash"],
    }


def _now_ms() -> datetime:
    now = datetime.now(timezone.utc)
    return now.replace(microsecond=(now.microsecond // 1000) * 1000)


class AuditStore:
    def __init__(self, database: Database) -> None:
        self._db = database

    # -- writer ------------------------------------------------------------
    def record(
        self,
        *,
        actor_id: str,
        actor_role: str,
        action: str,
        target_type: str = "",
        target_id: str = "",
        outcome: str = "SUCCESS",
        details: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        details_json = canonicalize(details or {})
        with self._db.connection() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", (CHAIN_LOCK_KEY,))
            with conn.cursor() as cur:
                cur.execute("SELECT event_seq, hash FROM audit_events ORDER BY event_seq DESC LIMIT 1")
                tail = cur.fetchone()
            sequence = int(tail["event_seq"]) + 1 if tail else 1
            prev_hash = tail["hash"] if tail else GENESIS_HASH
            recorded_at = _now_ms()
            payload = {
                "sequence": sequence,
                "recordedAt": iso_utc(recorded_at),
                "actorId": actor_id,
                "actorRole": actor_role,
                "action": action,
                "targetType": target_type,
                "targetId": target_id,
                "outcome": outcome,
                "details": details_json,
            }
            digest = compute_audit_hash(payload, prev_hash)
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    INSERT INTO audit_events
                      (event_seq, recorded_at, actor_id, actor_role, action, target_type,
                       target_id, outcome, details, prev_hash, hash)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s)
                    RETURNING {COLUMNS}
                    """,
                    (
                        sequence,
                        recorded_at,
                        actor_id,
                        actor_role,
                        action,
                        target_type,
                        target_id,
                        outcome,
                        json.dumps(details_json, ensure_ascii=False),
                        prev_hash,
                        digest,
                    ),
                )
                row = cur.fetchone()
        if row is None:  # pragma: no cover - unreachable with RETURNING
            raise RuntimeError("Audit insert returned no row.")
        return _to_event(row)

    # -- reader ------------------------------------------------------------
    def list(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        action: str | None = None,
        outcome: str | None = None,
        actor_id: str | None = None,
    ) -> tuple[list[dict[str, Any]], int]:
        limit = min(max(limit, 1), 200)
        offset = max(offset, 0)
        where: list[str] = []
        params: list[Any] = []
        if action:
            params.append(action)
            where.append("action = %s")
        if outcome:
            params.append(outcome)
            where.append("outcome = %s")
        if actor_id:
            params.append(actor_id)
            where.append("actor_id = %s")
        clause = f"WHERE {' AND '.join(where)}" if where else ""

        total_row = self._db.one(f"SELECT count(*) AS count FROM audit_events {clause}", params)
        rows = self._db.query(
            f"SELECT {COLUMNS} FROM audit_events {clause} ORDER BY event_seq DESC LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
        return [_to_event(row) for row in rows], int(total_row["count"]) if total_row else 0

    def get(self, audit_id: str) -> dict[str, Any] | None:
        row = self._db.one(f"SELECT {COLUMNS} FROM audit_events WHERE audit_id = %s", [audit_id])
        return _to_event(row) if row else None

    # -- verifier ----------------------------------------------------------
    def verify(self) -> dict[str, Any]:
        rows = self._db.query(f"SELECT {COLUMNS} FROM audit_events ORDER BY event_seq ASC")
        previous = GENESIS_HASH
        broken_at: int | None = None
        for row in rows:
            event = _to_event(row)
            expected = compute_audit_hash(
                {
                    "sequence": event["sequence"],
                    "recordedAt": event["recordedAt"],
                    "actorId": event["actorId"],
                    "actorRole": event["actorRole"],
                    "action": event["action"],
                    "targetType": event["targetType"],
                    "targetId": event["targetId"],
                    "outcome": event["outcome"],
                    "details": event["details"],
                },
                previous,
            )
            if event["prevHash"] != previous or expected != event["hash"]:
                broken_at = event["sequence"]
                break
            previous = event["hash"]

        head = rows[-1]["hash"] if rows else GENESIS_HASH
        return {
            "verified": broken_at is None,
            "checked": len(rows),
            "brokenAt": broken_at,
            "checkedAt": iso_utc(datetime.now(timezone.utc)),
            "headHash": head,
        }
