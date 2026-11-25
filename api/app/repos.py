"""Repositories: operators, templates and executions.

Rows stay snake_case in SQL and are mapped to the camelCase JSON the dashboard
expects at this boundary, so routes never leak column names.
"""

from __future__ import annotations

import json
import secrets
from contextlib import contextmanager
from typing import Any, Iterator

from .db import Database
from .schemas import iso_utc

TemplateFilters = dict[str, str]

TEMPLATE_SELECT = """
SELECT t.template_id, t.name, t.version, t.steps, t.origin, t.is_active,
       t.created_by, t.created_at, t.updated_at,
       r.status AS review_status, r.reviewed_by, r.comments AS review_comments,
       r.created_at AS reviewed_at
  FROM workflow_templates t
  LEFT JOIN LATERAL (
        SELECT status, reviewed_by, comments, created_at
          FROM template_reviews
         WHERE template_id = t.template_id
         ORDER BY created_at DESC, review_id DESC
         LIMIT 1
  ) r ON TRUE
"""

INSTANCE_SELECT = """
SELECT instance_id, template_id, template_name, template_version, steps, status,
       current_step, cursor_index, input, created_by, created_at, updated_at
  FROM workflow_instances
"""

STEP_RUN_SELECT = """
SELECT run_id, instance_id, step_id, step_type, status, performed_by, result,
       started_at, finished_at
  FROM step_runs
"""


def _steps(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, str):
        return json.loads(value)
    return list(value or [])


def _json(value: Any) -> Any:
    return json.loads(value) if isinstance(value, str) else value


def template_to_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "templateId": str(row["template_id"]),
        "name": row["name"],
        "version": row["version"],
        "steps": _steps(row["steps"]),
        "origin": row["origin"],
        "isActive": bool(row["is_active"]),
        "createdBy": row["created_by"],
        "createdAt": iso_utc(row["created_at"]),
        "updatedAt": iso_utc(row["updated_at"]),
        "reviewStatus": row.get("review_status") or "PENDING",
        "reviewedBy": row.get("reviewed_by"),
        "reviewComments": row.get("review_comments"),
        "reviewedAt": iso_utc(row.get("reviewed_at")),
    }


def instance_to_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "instanceId": str(row["instance_id"]),
        "templateId": str(row["template_id"]),
        "templateName": row["template_name"],
        "templateVersion": row["template_version"],
        "steps": _steps(row["steps"]),
        "status": row["status"],
        "currentStep": row["current_step"],
        "cursorIndex": row["cursor_index"],
        "input": _json(row["input"]) or {},
        "createdBy": row["created_by"],
        "createdAt": iso_utc(row["created_at"]),
        "updatedAt": iso_utc(row["updated_at"]),
    }


def step_run_to_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "runId": str(row["run_id"]),
        "instanceId": str(row["instance_id"]),
        "stepId": row["step_id"],
        "stepType": row["step_type"],
        "status": row["status"],
        "performedBy": row["performed_by"],
        "result": _json(row["result"]) or {},
        "startedAt": iso_utc(row["started_at"]),
        "finishedAt": iso_utc(row["finished_at"]),
    }


def operator_to_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["operator_id"],
        "displayName": row["display_name"],
        "email": row["email"],
        "role": row["role"],
        "revokedAt": iso_utc(row["revoked_at"]),
    }


# --------------------------------------------------------------------------
# Operators
# --------------------------------------------------------------------------

OPERATOR_COLUMNS = "operator_id, display_name, email, role, revoked_at"


class OperatorRepo:
    def __init__(self, database: Database) -> None:
        self._db = database

    def resolve(self, identifier: str) -> dict[str, Any] | None:
        row = self._db.one(
            f"""SELECT {OPERATOR_COLUMNS} FROM operators
                 WHERE operator_id = %s OR lower(email) = lower(%s)
                 LIMIT 1""",
            [identifier, identifier],
        )
        return operator_to_json(row) if row else None

    def find(self, operator_id: str) -> dict[str, Any] | None:
        row = self._db.one(
            f"SELECT {OPERATOR_COLUMNS} FROM operators WHERE operator_id = %s", [operator_id]
        )
        return operator_to_json(row) if row else None

    def find_by_email(self, email: str) -> dict[str, Any] | None:
        row = self._db.one(
            f"SELECT {OPERATOR_COLUMNS} FROM operators WHERE lower(email) = lower(%s)", [email]
        )
        return operator_to_json(row) if row else None

    def list(self) -> list[dict[str, Any]]:
        rows = self._db.query(f"SELECT {OPERATOR_COLUMNS} FROM operators ORDER BY display_name")
        return [operator_to_json(row) for row in rows]

    def create(self, *, email: str, display_name: str, role: str) -> dict[str, Any]:
        operator_id = f"op-{secrets.token_hex(4)}"
        row = self._db.one(
            f"""INSERT INTO operators (operator_id, display_name, email, role)
                VALUES (%s, %s, %s, %s)
                RETURNING {OPERATOR_COLUMNS}""",
            [operator_id, display_name, email, role],
        )
        assert row is not None
        return operator_to_json(row)

    def restore(self, operator_id: str, *, display_name: str, email: str, role: str) -> dict[str, Any]:
        row = self._db.one(
            f"""UPDATE operators
                   SET display_name = %s, email = %s, role = %s, revoked_at = NULL
                 WHERE operator_id = %s
             RETURNING {OPERATOR_COLUMNS}""",
            [display_name, email, role, operator_id],
        )
        assert row is not None
        return operator_to_json(row)

    def set_role(self, operator_id: str, role: str) -> dict[str, Any] | None:
        row = self._db.one(
            f"""UPDATE operators SET role = %s WHERE operator_id = %s
             RETURNING {OPERATOR_COLUMNS}""",
            [role, operator_id],
        )
        return operator_to_json(row) if row else None

    def revoke(self, operator_id: str) -> dict[str, Any] | None:
        row = self._db.one(
            f"""UPDATE operators SET revoked_at = now() WHERE operator_id = %s
             RETURNING {OPERATOR_COLUMNS}""",
            [operator_id],
        )
        return operator_to_json(row) if row else None


# --------------------------------------------------------------------------
# Templates
# --------------------------------------------------------------------------


class TemplateRepo:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(
        self,
        *,
        name: str,
        steps: list[dict[str, Any]],
        origin: str,
        created_by: str,
        review_status: str,
        review_comments: str | None,
    ) -> dict[str, Any]:
        with self._db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """INSERT INTO workflow_templates (name, version, steps, origin, is_active, created_by)
                       VALUES (%s, 1, %s::jsonb, %s, FALSE, %s)
                    RETURNING template_id""",
                    [name, json.dumps(steps), origin, created_by],
                )
                template_id = cur.fetchone()["template_id"]
                cur.execute(
                    """INSERT INTO template_reviews (template_id, status, reviewed_by, comments)
                       VALUES (%s, %s, NULL, %s)""",
                    [template_id, review_status, review_comments],
                )
        created = self.get(template_id)
        assert created is not None
        return created

    def get(self, template_id: str) -> dict[str, Any] | None:
        row = self._db.one(f"{TEMPLATE_SELECT} WHERE t.template_id = %s", [template_id])
        return template_to_json(row) if row else None

    def list(self, filters: TemplateFilters) -> list[dict[str, Any]]:
        where: list[str] = []
        params: list[Any] = []
        if filters.get("origin"):
            where.append("t.origin = %s")
            params.append(filters["origin"])
        if filters.get("is_active") in {"true", "false"}:
            where.append("t.is_active = %s")
            params.append(filters["is_active"] == "true")
        if filters.get("status"):
            where.append("COALESCE(r.status, 'PENDING') = %s")
            params.append(filters["status"])
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._db.query(
            f"{TEMPLATE_SELECT} {clause} ORDER BY t.created_at DESC", params
        )
        return [template_to_json(row) for row in rows]

    def reviews(self, template_id: str) -> list[dict[str, Any]]:
        rows = self._db.query(
            """SELECT review_id, template_id, status, reviewed_by, comments, created_at
                 FROM template_reviews WHERE template_id = %s
                ORDER BY created_at ASC, review_id ASC""",
            [template_id],
        )
        return [
            {
                "reviewId": str(row["review_id"]),
                "templateId": str(row["template_id"]),
                "status": row["status"],
                "reviewedBy": row["reviewed_by"],
                "comments": row["comments"],
                "createdAt": iso_utc(row["created_at"]),
            }
            for row in rows
        ]

    @contextmanager
    def locked(self, template_id: str) -> Iterator[dict[str, Any]]:
        """Row-locked template plus the three writes the lifecycle needs."""
        with self._db.connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    f"{TEMPLATE_SELECT} WHERE t.template_id = %s FOR UPDATE OF t", [template_id]
                )
                row = cur.fetchone()
            if row is None:
                yield {"current": None}
                return

            helpers = {
                "current": template_to_json(row),
                "update": lambda name, steps: _update_template(conn, template_id, name, steps),
                "insert_review": lambda status, reviewed_by, comments: _insert_review(
                    conn, template_id, status, reviewed_by, comments
                ),
                "set_active": lambda active: conn.execute(
                    "UPDATE workflow_templates SET is_active = %s, updated_at = now() WHERE template_id = %s",
                    [active, template_id],
                ),
            }
            yield helpers

    def set_active(self, template_id: str, active: bool) -> dict[str, Any] | None:
        row = self._db.one(
            """UPDATE workflow_templates SET is_active = %s, updated_at = now()
                WHERE template_id = %s RETURNING template_id""",
            [active, template_id],
        )
        return self.get(str(row["template_id"])) if row else None


def _update_template(conn: Any, template_id: str, name: str, steps: list[dict[str, Any]]) -> None:
    conn.execute(
        """UPDATE workflow_templates
              SET name = %s, steps = %s::jsonb, updated_at = now()
            WHERE template_id = %s""",
        [name, json.dumps(steps), template_id],
    )


def _insert_review(
    conn: Any, template_id: str, status: str, reviewed_by: str | None, comments: str | None
) -> None:
    conn.execute(
        """INSERT INTO template_reviews (template_id, status, reviewed_by, comments)
           VALUES (%s, %s, %s, %s)""",
        [template_id, status, reviewed_by, comments],
    )


# --------------------------------------------------------------------------
# Instances
# --------------------------------------------------------------------------


class InstanceRepo:
    def __init__(self, database: Database) -> None:
        self._db = database

    def create(
        self,
        *,
        template_id: str,
        template_name: str,
        template_version: int,
        steps: list[dict[str, Any]],
        input_data: dict[str, str],
        created_by: str,
    ) -> dict[str, Any]:
        row = self._db.one(
            """INSERT INTO workflow_instances
                 (template_id, template_name, template_version, steps, status, current_step,
                  cursor_index, input, created_by)
               VALUES (%s, %s, %s, %s::jsonb, 'RUNNING', NULL, 0, %s::jsonb, %s)
            RETURNING instance_id""",
            [
                template_id,
                template_name,
                template_version,
                json.dumps(steps),
                json.dumps(input_data),
                created_by,
            ],
        )
        assert row is not None
        created = self.get(str(row["instance_id"]))
        assert created is not None
        return created

    def get(self, instance_id: str) -> dict[str, Any] | None:
        row = self._db.one(f"{INSTANCE_SELECT} WHERE instance_id = %s", [instance_id])
        return instance_to_json(row) if row else None

    def list(self, filters: dict[str, str]) -> list[dict[str, Any]]:
        where: list[str] = []
        params: list[Any] = []
        if filters.get("status"):
            where.append("status = %s")
            params.append(filters["status"])
        if filters.get("template_id"):
            where.append("template_id = %s")
            params.append(filters["template_id"])
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self._db.query(f"{INSTANCE_SELECT} {clause} ORDER BY created_at DESC", params)
        return [instance_to_json(row) for row in rows]

    def update(self, instance_id: str, *, status: str, current_step: str | None, cursor: int) -> None:
        self._db.execute(
            """UPDATE workflow_instances
                  SET status = %s, current_step = %s, cursor_index = %s, updated_at = now()
                WHERE instance_id = %s""",
            [status, current_step, cursor, instance_id],
        )

    def record_step_run(
        self,
        *,
        instance_id: str,
        step_id: str,
        step_type: str,
        status: str,
        performed_by: str | None,
        result: dict[str, Any],
    ) -> None:
        self._db.execute(
            """INSERT INTO step_runs
                 (instance_id, step_id, step_type, status, performed_by, result)
               VALUES (%s, %s, %s, %s, %s, %s::jsonb)
               ON CONFLICT (instance_id, step_id) DO UPDATE
                  SET status = EXCLUDED.status,
                      performed_by = EXCLUDED.performed_by,
                      result = EXCLUDED.result,
                      finished_at = now()""",
            [instance_id, step_id, step_type, status, performed_by, json.dumps(result)],
        )

    def step_runs(self, instance_id: str) -> list[dict[str, Any]]:
        rows = self._db.query(
            f"{STEP_RUN_SELECT} WHERE instance_id = %s ORDER BY started_at ASC", [instance_id]
        )
        return [step_run_to_json(row) for row in rows]
