"""Business logic for the template lifecycle and workflow execution.

Template lifecycle (unchanged from the Node server):

    create/generate -> PENDING + inactive -> approve -> APPROVED + active
                                         \\-> reject  -> REJECTED (inactive)

Instances are a snapshot of the approved steps; the runner walks them.
"""

from __future__ import annotations

import json
from typing import Any

from . import llm
from .audit import AuditStore
from .documents import resolve_document
from .errors import conflict, not_found, unprocessable, upstream
from .execution.handlers import RunContext, StepFailed
from .execution.runner import Runner, pending_gate
from .intake import read_upload
from .repos import InstanceRepo, TemplateRepo
from .rules import validate_business_rules
from .schemas import (
    NODE_CATALOGUE,
    CreateTemplateRequest,
    UpdateTemplateRequest,
    WorkflowStep,
    normalise_steps,
)

DRAFT_REVIEW_COMMENT = "Awaiting operator review."
CLARIFY_QUESTION = (
    "Could you describe the case this workflow handles, what must be checked or approved "
    "(and by whom), and what document or message should come out of it? If a person must "
    "upload a PDF or image for the AI to read, say so too."
)


def _business_details(issues: list[dict[str, Any]]) -> dict[str, Any]:
    return {"structural": [], "businessRules": issues}


class TemplateService:
    def __init__(self, templates: TemplateRepo, audit: AuditStore) -> None:
        self._templates = templates
        self._audit = audit

    # -- validation --------------------------------------------------------
    def assert_valid(self, name: str, steps: list[WorkflowStep]) -> None:
        issues = validate_business_rules(name, steps)
        if issues:
            raise unprocessable("Template failed business-rule validation.", _business_details(issues))

    # -- create / generate -------------------------------------------------
    def create(self, name: str, steps: list[WorkflowStep], actor_id: str) -> dict[str, Any]:
        self.assert_valid(name, steps)
        return self._templates.create(
            name=name.strip(),
            steps=normalise_steps(steps),
            origin="MANUAL",
            created_by=actor_id,
            review_status="PENDING",
            review_comments=DRAFT_REVIEW_COMMENT,
        )

    def generate(self, prompt: str, actor_id: str) -> dict[str, Any]:
        if len(prompt.strip()) < 20:
            return {"needsClarification": True, "question": CLARIFY_QUESTION}

        catalogue = [
            {"type": node.type, "title": node.title, "category": node.category, "description": node.description}
            for node in NODE_CATALOGUE
        ]
        instruction = f"""You design audited workflows. Answer with JSON only, no prose.

Allowed node types:
{json.dumps(catalogue, indent=1)}

Return either
{{"needsClarification": true, "question": "..."}}
when the request is too vague to design from, or
{{"name": "...", "steps": [{{"id": "step-1", "name": "...", "type": "<allowed type>", "description": "...", "config": {{}}}}]}}.

Rules: a trigger may only be first and at most one; otherwise the first step must be
a review; an approval must come after a validation; gmail/telegram must be last.

Request: {prompt.strip()}"""

        try:
            raw = llm.generate_json(instruction, temperature=0.1)
        except llm.LlmUnavailable as error:
            raise upstream("AI template generation failed.", {"reason": str(error)}) from error

        if isinstance(raw, dict) and raw.get("needsClarification") is True:
            question = str(raw.get("question") or CLARIFY_QUESTION)
            return {"needsClarification": True, "question": question}

        candidate = raw
        if isinstance(raw, dict) and "steps" in raw and "name" in raw:
            candidate = {"name": raw["name"], "steps": raw["steps"]}

        try:
            request = CreateTemplateRequest.model_validate(candidate)
        except Exception as error:  # noqa: BLE001 - model output is untrusted
            raise unprocessable(
                "The AI response did not match the required template structure.",
                {"structural": [{"path": "(root)", "message": str(error), "code": "invalid"}], "businessRules": []},
            ) from error

        self.assert_valid(request.name, request.steps)

        template = self._templates.create(
            name=request.name.strip(),
            steps=normalise_steps(request.steps),
            origin="AI_DRAFTED",
            created_by=actor_id,
            review_status="PENDING",
            review_comments="AI draft awaiting operator review.",
        )
        return {"template": template}

    # -- reads -------------------------------------------------------------
    def list(self, filters: dict[str, str]) -> list[dict[str, Any]]:
        return self._templates.list(filters)

    def get(self, template_id: str) -> dict[str, Any]:
        template = self._templates.get(template_id)
        if template is None:
            raise not_found(f"Template {template_id} not found.")
        template["reviews"] = self._templates.reviews(template_id)
        return template

    # -- edit --------------------------------------------------------------
    def update(self, template_id: str, patch: UpdateTemplateRequest) -> dict[str, Any]:
        if patch.name is None and patch.steps is None:
            raise unprocessable("Provide at least one of 'name' or 'steps'.")

        def work(locked: dict[str, Any]) -> None:
            current = locked.get("current")
            if current is None:
                raise not_found(f"Template {template_id} not found.")
            if current["reviewStatus"] == "APPROVED":
                raise conflict(
                    "Approved templates cannot be edited directly. Create a new version instead.",
                    {"reviewStatus": current["reviewStatus"], "templateId": template_id},
                )
            name = patch.name or current["name"]
            steps = patch.steps if patch.steps is not None else [WorkflowStep.model_validate(item) for item in current["steps"]]
            self.assert_valid(name, steps)
            locked["update"](name.strip(), normalise_steps(steps))
            if current["reviewStatus"] == "REJECTED":
                locked["insert_review"]("PENDING", None, "Re-submitted for review after edits.")

        with self._templates.locked(template_id) as locked:
            work(locked)

        return self._templates.get(template_id) or {}

    # -- lifecycle ---------------------------------------------------------
    def approve(self, template_id: str, actor_id: str, comments: str | None) -> dict[str, Any]:
        def work(locked: dict[str, Any]) -> None:
            current = locked.get("current")
            if current is None:
                raise not_found(f"Template {template_id} not found.")
            if current["reviewStatus"] != "PENDING":
                raise conflict(
                    f"Only PENDING templates can be approved; this template is {current['reviewStatus']}.",
                    {"reviewStatus": current["reviewStatus"]},
                )
            self.assert_valid(current["name"], [WorkflowStep.model_validate(item) for item in current["steps"]])
            locked["insert_review"]("APPROVED", actor_id, comments)
            locked["set_active"](True)

        with self._templates.locked(template_id) as locked:
            work(locked)
        return self.get(template_id)

    def reject(self, template_id: str, actor_id: str, comments: str) -> dict[str, Any]:
        if not comments.strip():
            raise unprocessable("Rejecting a template needs a reason.", {"structural": [], "businessRules": []})

        def work(locked: dict[str, Any]) -> None:
            current = locked.get("current")
            if current is None:
                raise not_found(f"Template {template_id} not found.")
            if current["reviewStatus"] != "PENDING":
                raise conflict(
                    f"Only PENDING templates can be rejected; this template is {current['reviewStatus']}.",
                    {"reviewStatus": current["reviewStatus"]},
                )
            self.assert_valid(current["name"], [WorkflowStep.model_validate(item) for item in current["steps"]])
            locked["insert_review"]("REJECTED", actor_id, comments)
            locked["set_active"](False)

        with self._templates.locked(template_id) as locked:
            work(locked)
        return self.get(template_id)

    def activate(self, template_id: str) -> dict[str, Any]:
        template = self._templates.get(template_id)
        if template is None:
            raise not_found(f"Template {template_id} not found.")
        if template["reviewStatus"] != "APPROVED":
            raise conflict(
                "Only approved templates can be activated. Approve this template first.",
                {"reviewStatus": template["reviewStatus"], "templateId": template_id},
            )
        return self._templates.set_active(template_id, True) or template

    def deactivate(self, template_id: str) -> dict[str, Any]:
        updated = self._templates.set_active(template_id, False)
        if updated is None:
            raise not_found(f"Template {template_id} not found.")
        return updated


class InstanceService:
    def __init__(self, templates: TemplateRepo, instances: InstanceRepo, audit: AuditStore) -> None:
        self._templates = templates
        self._instances = instances
        self._audit = audit
        self._runner = Runner(instances)

    # -- reads -------------------------------------------------------------
    def detail(self, instance_id: str) -> dict[str, Any]:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise not_found(f"Workflow instance {instance_id} not found.")
        return {
            "instance": instance,
            "stepRuns": self._instances.step_runs(instance_id),
            "pendingApproval": pending_gate(instance),
        }

    def list(self, filters: dict[str, str]) -> list[dict[str, Any]]:
        return self._instances.list(filters)

    def document(self, instance_id: str, step_id: str) -> tuple[Any, str, str]:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise not_found(f"Workflow instance {instance_id} not found.")
        step = next((item for item in instance["steps"] if item["id"] == step_id), None)
        if step is None or step["type"] != "document":
            raise not_found(f"This instance has no document step '{step_id}'.")
        run = next((item for item in self._instances.step_runs(instance_id) if item["stepId"] == step_id), None)
        recorded = (run or {}).get("result", {}).get("file")
        if not recorded:
            raise not_found("No document has been generated for this step yet.")
        path = resolve_document(str(recorded))
        if path is None:
            raise not_found("The generated document file no longer exists on disk.")
        mime = (run or {}).get("result", {}).get("mimeType") or "application/octet-stream"
        return path, path.name, mime

    # -- execution ---------------------------------------------------------
    def start(self, template_id: str, actor_id: str, case_input: dict[str, str]) -> dict[str, Any]:
        template = self._templates.get(template_id)
        if template is None:
            raise not_found(f"Template {template_id} not found.")
        if template["reviewStatus"] != "APPROVED" or not template["isActive"]:
            raise conflict(
                "Only templates that are APPROVED and active can be executed.",
                {"reviewStatus": template["reviewStatus"], "isActive": template["isActive"]},
            )

        instance = self._instances.create(
            template_id=template["templateId"],
            template_name=template["name"],
            template_version=template["version"],
            steps=template["steps"],
            input_data=case_input,
            created_by=actor_id,
        )
        self._audit.record(
            actor_id=actor_id,
            actor_role=self._role(actor_id),
            action="WORKFLOW_STARTED",
            target_type="instance",
            target_id=instance["instanceId"],
            details={"templateId": template_id, "steps": len(template["steps"]), "input": case_input},
        )
        self._runner.advance(instance, 0, performed_by=actor_id)
        return self._after(instance["instanceId"], actor_id)

    def respond(self, instance_id: str, actor_id: str, approved: bool, comments: str | None) -> dict[str, Any]:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise not_found(f"Workflow instance {instance_id} not found.")
        if instance["status"] != "PAUSED":
            raise conflict(
                f"This workflow is {instance['status']}; only a PAUSED workflow is waiting for a decision.",
                {"instanceStatus": instance["status"]},
            )
        step = next((item for item in instance["steps"] if item["id"] == instance["currentStep"]), None)
        if step is None or step["type"] != "approval":
            raise conflict(
                "This workflow is not waiting for an approval decision.",
                {"instanceStatus": instance["status"]},
            )

        self._instances.record_step_run(
            instance_id=instance_id,
            step_id=step["id"],
            step_type="approval",
            status="APPROVED" if approved else "REJECTED",
            performed_by=actor_id,
            result={"comments": comments},
        )
        self._audit.record(
            actor_id=actor_id,
            actor_role=self._role(actor_id),
            action="APPROVAL_GRANTED" if approved else "APPROVAL_REJECTED",
            target_type="instance",
            target_id=instance_id,
            outcome="SUCCESS" if approved else "FAILURE",
            details={"stepId": step["id"], "comments": comments},
        )

        if not approved:
            self._instances.update(
                instance_id,
                status="REJECTED",
                current_step=step["id"],
                cursor=instance["cursorIndex"],
            )
            return self.detail(instance_id)

        refreshed = self._instances.get(instance_id) or instance
        history = [
            {
                "stepId": run["stepId"],
                "stepName": run["stepId"],
                "stepType": run["stepType"],
                "status": run["status"],
                "result": run["result"],
            }
            for run in self._instances.step_runs(instance_id)
        ]
        self._runner.advance(refreshed, refreshed["cursorIndex"] + 1, performed_by=actor_id, history=history)
        return self._after(instance_id, actor_id)

    def submit_intake(
        self,
        instance_id: str,
        actor_id: str,
        *,
        file_name: str,
        mime_type: str,
        data: bytes,
    ) -> dict[str, Any]:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise not_found(f"Workflow instance {instance_id} not found.")
        if instance["status"] != "PAUSED":
            raise conflict(
                f"This workflow is {instance['status']}; only a PAUSED workflow is waiting for a file.",
                {"instanceStatus": instance["status"]},
            )
        step = next((item for item in instance["steps"] if item["id"] == instance["currentStep"]), None)
        if step is None or step["type"] != "intake":
            raise conflict(
                "This workflow is not waiting for a file.",
                {"instanceStatus": instance["status"]},
            )

        gate = pending_gate(instance) or {}
        accepted = gate.get("acceptedFileTypes") or ["pdf", "jpg", "jpeg", "png"]
        reading = read_upload(file_name=file_name, mime_type=mime_type, data=data, accepted=accepted)
        instruction = gate.get("instruction")

        # The upload is the evidence the approver relies on, so it is also the
        # text the AI reasons over when an instruction was given.
        if instruction:
            try:
                reading["aiSummary"] = llm.generate_text(
                    f"Instruction: {instruction}\n\nDocument:\n{reading['text'][:12_000]}\n\nAnswer:"
                )
            except llm.LlmUnavailable:
                reading["aiSummary"] = None

        self._instances.record_step_run(
            instance_id=instance_id,
            step_id=step["id"],
            step_type="intake",
            status="COMPLETED",
            performed_by=actor_id,
            result=reading,
        )
        self._audit.record(
            actor_id=actor_id,
            actor_role=self._role(actor_id),
            action="WORKFLOW_INPUT_READ",
            target_type="instance",
            target_id=instance_id,
            details={
                "stepId": step["id"],
                "fileName": reading["fileName"],
                "bytes": reading["bytes"],
                "method": reading["method"],
                "aiSummary": bool(reading.get("aiSummary")),
            },
        )

        refreshed = self._instances.get(instance_id) or instance
        history = [
            {
                "stepId": run["stepId"],
                "stepName": run["stepId"],
                "stepType": run["stepType"],
                "status": run["status"],
                "result": run["result"],
            }
            for run in self._instances.step_runs(instance_id)
        ]
        self._runner.advance(refreshed, refreshed["cursorIndex"] + 1, performed_by=actor_id, history=history)
        return self._after(instance_id, actor_id)

    def cancel(self, instance_id: str, actor_id: str) -> dict[str, Any]:
        instance = self._instances.get(instance_id)
        if instance is None:
            raise not_found(f"Workflow instance {instance_id} not found.")
        if instance["status"] in {"COMPLETED", "REJECTED", "CANCELLED"}:
            raise conflict(
                f"This workflow already finished ({instance['status']}).",
                {"instanceStatus": instance["status"]},
            )
        self._instances.update(
            instance_id,
            status="CANCELLED",
            current_step=None,
            cursor=instance["cursorIndex"],
        )
        self._audit.record(
            actor_id=actor_id,
            actor_role=self._role(actor_id),
            action="WORKFLOW_CANCELLED",
            target_type="instance",
            target_id=instance_id,
            outcome="SUCCESS",
            details={"at": instance["currentStep"]},
        )
        return self.detail(instance_id)

    # -- helpers -----------------------------------------------------------
    def _role(self, actor_id: str) -> str:
        # The audit row names the role at the time of the action.
        from .db import db

        row = db.one("SELECT role FROM operators WHERE operator_id = %s", [actor_id])
        return str(row["role"]) if row else "system"

    def _after(self, instance_id: str, actor_id: str) -> dict[str, Any]:
        instance = self._instances.get(instance_id) or {}
        if instance.get("status") == "COMPLETED":
            self._audit.record(
                actor_id=actor_id,
                actor_role=self._role(actor_id),
                action="WORKFLOW_COMPLETED",
                target_type="instance",
                target_id=instance_id,
                details={"steps": len(instance.get("steps", []))},
            )
        return self.detail(instance_id)


__all__ = ["TemplateService", "InstanceService", "RunContext", "StepFailed"]
