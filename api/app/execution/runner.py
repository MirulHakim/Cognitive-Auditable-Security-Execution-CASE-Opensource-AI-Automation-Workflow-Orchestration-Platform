"""The runner: a deterministic walk over the approved steps.

Execution order is the array order. A gate (``approval`` or ``intake``) stops the
walk and leaves the instance ``PAUSED`` at that step; the service resumes it by
calling ``advance`` again from the next index once the human input is recorded.
Everything else executes immediately, one row per step in ``step_runs``.
"""

from __future__ import annotations

from typing import Any

from ..repos import InstanceRepo
from .handlers import GATES, RunContext, StepFailed, handle_step


class Runner:
    def __init__(self, instances: InstanceRepo) -> None:
        self._instances = instances

    def advance(
        self,
        instance: dict[str, Any],
        start_index: int,
        *,
        performed_by: str | None,
        history: list[dict[str, Any]] | None = None,
    ) -> None:
        instance_id = instance["instanceId"]
        steps: list[dict[str, Any]] = instance["steps"]
        case_input: dict[str, str] = instance.get("input") or {}

        upstream: list[dict[str, Any]] = list(history or [])
        cursor = start_index

        while cursor < len(steps):
            step = steps[cursor]

            if step["type"] in GATES:
                self._instances.update(
                    instance_id,
                    status="PAUSED",
                    current_step=step["id"],
                    cursor=cursor,
                )
                return

            context = RunContext(
                instance_id=instance_id,
                case_input=case_input,
                upstream=list(upstream),
                performed_by=performed_by,
            )

            try:
                status, result = handle_step(step, context)
            except StepFailed as error:
                self._instances.record_step_run(
                    instance_id=instance_id,
                    step_id=step["id"],
                    step_type=step["type"],
                    status="FAILED",
                    performed_by=performed_by,
                    result={"error": str(error)},
                )
                # Stop without pretending the rest of the workflow happened.
                self._instances.update(
                    instance_id,
                    status="PAUSED",
                    current_step=step["id"],
                    cursor=cursor,
                )
                return

            self._instances.record_step_run(
                instance_id=instance_id,
                step_id=step["id"],
                step_type=step["type"],
                status=status,
                performed_by=performed_by,
                result=result,
            )
            upstream.append(
                {
                    "stepId": step["id"],
                    "stepName": step["name"],
                    "stepType": step["type"],
                    "status": status,
                    "result": result,
                }
            )
            cursor += 1

        self._instances.update(
            instance_id,
            status="COMPLETED",
            current_step=None,
            cursor=cursor,
        )


def pending_gate(instance: dict[str, Any]) -> dict[str, Any] | None:
    """Rebuild the payload the dashboard renders for a paused run."""
    if instance["status"] != "PAUSED" or not instance.get("currentStep"):
        return None
    step = next((item for item in instance["steps"] if item["id"] == instance["currentStep"]), None)
    if step is None:
        return None

    if step["type"] == "intake":
        config = step.get("config") or {}
        accepted = step.get("acceptedFileTypes") or config.get("acceptedFileTypes") or ["pdf", "jpg", "jpeg", "png"]
        return {
            "kind": "intake",
            "instanceId": instance["instanceId"],
            "stepNumber": instance["cursorIndex"] + 1,
            "totalSteps": len(instance["steps"]),
            "step": step,
            "acceptedFileTypes": accepted,
            "instruction": step.get("instruction") or config.get("instruction"),
        }

    if step["type"] != "approval":
        return None

    return {
        "kind": "approval",
        "instanceId": instance["instanceId"],
        "stepNumber": instance["cursorIndex"] + 1,
        "totalSteps": len(instance["steps"]),
        "step": step,
    }
