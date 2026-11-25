"""Business rules ("can this workflow actually run?").

Structural validation (Pydantic) proves the payload has the right shape. These
rules decide whether the *workflow* makes sense: a trigger can only open it, an
approval needs a validation before it, terminal connectors can only close it, and
each node's settings are complete enough to execute.

Each violation is returned as ``{rule, message, stepId?}`` — the shape the
dashboard already renders.
"""

from __future__ import annotations

from typing import Any

from .config import settings
from .schemas import NODE_BY_TYPE, TERMINAL_TYPES, TRIGGER_TYPES, WorkflowStep


def _violation(rule: str, message: str, step_id: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"rule": rule, "message": message}
    if step_id:
        payload["stepId"] = step_id
    return payload


def validate_business_rules(
    name: str,
    steps: list[WorkflowStep] | list[dict[str, Any]],
    *,
    max_steps: int | None = None,
    supported_roles: Iterable[str] | None = None,
    supported_channels: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    max_steps = max_steps or settings.max_steps
    roles = tuple(supported_roles or settings.supported_roles)
    channels = tuple(supported_channels or settings.supported_channels)

    issues: list[dict[str, Any]] = []

    if not name.strip():
        issues.append(_violation("name-required", "The workflow needs a name."))

    if len(steps) > max_steps:
        issues.append(
            _violation(
                "max-steps",
                f"A workflow can have at most {max_steps} steps. This one has {len(steps)}.",
            )
        )

    seen: set[str] = set()
    for step in steps:
        step_id = step.id if isinstance(step, WorkflowStep) else step.get("id", "")
        if step_id in seen:
            issues.append(_violation("duplicate-step-id", f"Two steps share the same id ('{step_id}').", step_id))
        seen.add(step_id)

    if not steps:
        return issues

    def step_type(step: WorkflowStep | dict[str, Any]) -> str:
        return step.type if isinstance(step, WorkflowStep) else str(step.get("type", ""))

    def step_id(step: WorkflowStep | dict[str, Any]) -> str:
        return step.id if isinstance(step, WorkflowStep) else str(step.get("id", ""))

    def config_of(step: WorkflowStep | dict[str, Any]) -> dict[str, Any]:
        if isinstance(step, WorkflowStep):
            return step.effective_config()
        merged = dict(NODE_BY_TYPE[step["type"]].defaults) if step.get("type") in NODE_BY_TYPE else {}
        merged.update(step.get("config") or {})
        return merged

    types = [step_type(step) for step in steps]

    # --- where triggers may sit -------------------------------------------
    trigger_positions = [index for index, kind in enumerate(types) if kind in TRIGGER_TYPES]
    if len(trigger_positions) > 1:
        issues.append(
            _violation(
                "single-trigger",
                "Only one starter is allowed. Remove the extra one.",
                step_id(steps[trigger_positions[1]]),
            )
        )
    for position in trigger_positions:
        if position != 0:
            issues.append(
                _violation(
                    "trigger-first",
                    "A starter has to be the first step.",
                    step_id(steps[position]),
                )
            )

    # --- the opening step --------------------------------------------------
    if types and types[0] not in TRIGGER_TYPES and types[0] != "review":
        issues.append(
            _violation(
                "review-first",
                "The first step must be a starter or a review.",
                step_id(steps[0]),
            )
        )

    # --- terminal connectors close the flow --------------------------------
    for index, kind in enumerate(types):
        if kind in TERMINAL_TYPES and index != len(types) - 1:
            issues.append(
                _violation(
                    "terminal-last",
                    "Gmail and Telegram have to be the last step.",
                    step_id(steps[index]),
                )
            )

    # --- approvals need something validated before them --------------------
    for index, kind in enumerate(types):
        if kind != "approval":
            continue
        if "validation" not in types[:index]:
            issues.append(
                _violation(
                    "approval-after-validation",
                    "An approval has to come after a check of the details.",
                    step_id(steps[index]),
                )
            )

    # --- per-node settings -------------------------------------------------
    for step, kind in zip(steps, types):
        node = NODE_BY_TYPE.get(kind)  # type: ignore[arg-type]
        if node is None:
            issues.append(_violation("unknown-node", f"This step type is not available ('{kind}').", step_id(step)))
            continue
        config = config_of(step)

        assigned = config.get("assignedRole") or ""
        if assigned and assigned not in roles:
            issues.append(
                _violation(
                    "assigned-role",
                    f"'{assigned}' is not a role you can pick. Use: {', '.join(roles)}.",
                    step_id(step),
                )
            )

        if kind == "notification":
            channel = config.get("channel") or "email"
            if channel not in channels:
                issues.append(
                    _violation(
                        "notification-channel",
                        f"Messages can only go by {', '.join(channels)}.",
                        step_id(step),
                    )
                )

        if kind == "intake" and not config.get("acceptedFileTypes"):
            issues.append(
                _violation("intake-file-types", "Choose at least one allowed file type.", step_id(step))
            )

        if kind in {"llm_agent", "agent_react"} and not str(config.get("instruction") or "").strip():
            issues.append(
                _violation("llm-instruction", "This AI step needs an instruction.", step_id(step))
            )

        if kind == "document" and not str(config.get("title") or "").strip():
            issues.append(_violation("document-title", "The document needs a title.", step_id(step)))


        if kind == "db_query":
            from .schemas import QUERYABLE_TABLES

            table = str(config.get("table") or "")
            if table not in QUERYABLE_TABLES:
                issues.append(
                    _violation(
                        "query-table",
                        f"You can't read the table '{table}'. Use one of: {', '.join(QUERYABLE_TABLES)}.",
                        step_id(step),
                    )
                )

        if kind == "logic_condition" and not str(config.get("expression") or "").strip():
            issues.append(
                _violation("logic-expression", "This branch needs a condition.", step_id(step))
            )

    return issues
