"""
Mock request scenarios (AUDIT_MODULE_PLAN.md §10, "Mock scenarios").

Synthetic events that play one request from start to end, the way the other
modules will log them in Phase 6. Used by the Phase 4 tests, and reusable
later as end-to-end tests and as the demo script.

    req = Request(service, "job-a")
    await req.received()
    await req.ai_selected()
    ...
    await req.closed("DELIVERED")

Scenarios (plan §10):
  A normal path              -> scenario_a
  B no match, unsupported    -> scenario_b
  C operator switches        -> scenario_c
  D operator requests new    -> scenario_d
  E edit after Gate 1        -> scenario_e
  F audit failure at approval   (needs the LangGraph graph: Phase 6)
  G gate skipped (negative)  -> scenario_g
"""

from __future__ import annotations

from typing import Any

from src.audit.canonical import sha256_hex
from tests.audit.conftest import WS

OPERATOR = ("u-op-1", "OPERATOR", "WEB_APP")
AI = ("qwen3.5:9b", "AI", "SYSTEM")
SYSTEM = ("system", "SYSTEM", "SYSTEM")


def h(label: str) -> str:
    """A readable fake hash: h('template-leave') is always the same 64 hex characters."""
    return sha256_hex(label)


# Templates used by the scenarios: (id, version, hash).
TPL_LEAVE = ("tpl-leave", 3, h("template-leave"))
TPL_ROOM = ("tpl-room-change", "2026.1", h("template-room-change"))
TPL_DRAFTED = ("tpl-drafted-7", 1, h("template-drafted-7"))


class Request:
    """Logs the events of one request (one execution_id), with valid details."""

    def __init__(self, service, execution_id: str, workspace_id: str = WS) -> None:
        self.service = service
        self.execution_id = execution_id
        self.workspace_id = workspace_id
        self.events = []

    async def log(self, action: str, details: dict[str, Any] | None = None, *, who=SYSTEM,
                  outcome: str = "SUCCESS", source: str | None = None):
        actor, role, default_source = who
        event = await self.service.append_event(
            workspace_id=self.workspace_id, actor=actor, role=role, action=action,
            target=f"execution:{self.execution_id}", source=source or default_source, outcome=outcome,
            details=details or {}, execution_id=self.execution_id)
        self.events.append(event)
        return event

    # --- ingress and standardization ---------------------------------------
    async def received(self, source="GMAIL"):
        return await self.log("JOB_RECEIVED", {"request_ref": f"msg-{self.execution_id}"}, source=source)

    async def standardized(self):
        return await self.log("MESSAGE_STANDARDIZED", {
            "adapter": "gmail", "schema": "std_message.v1", "input_hash": h(f"raw-{self.execution_id}"),
            "output_hash": h(f"std-{self.execution_id}"), "body_truncated": False, "attachment_count": 1})

    # --- AI classification and template choice ----------------------------
    async def ai_selected(self, template=TPL_LEAVE, confidence="0.87", intent_label="leave application"):
        template_id, version, template_hash = template
        return await self.log("AI_TEMPLATE_SELECTED", {
            "template_id": template_id, "template_version": version, "source_template_hash": template_hash,
            "confidence": confidence, "intent_label": intent_label}, who=AI)

    async def ai_no_match(self):
        return await self.log("AI_TEMPLATE_NO_MATCH", {"candidates_checked": 4, "reason_code": "BELOW_THRESHOLD"},
                              who=AI)

    async def manually_selected(self, template=TPL_ROOM, ai_template_id="tpl-leave"):
        template_id, version, template_hash = template
        return await self.log("TEMPLATE_MANUALLY_SELECTED", {
            "ai_template_id": ai_template_id, "template_id": template_id, "template_version": version,
            "source_template_hash": template_hash}, who=OPERATOR)

    async def template_requested(self):
        return await self.log("TEMPLATE_REQUESTED", {"prompt_hash": h("operator-prompt")}, who=OPERATOR)

    async def ai_drafted(self, template=TPL_DRAFTED):
        template_id, version, template_hash = template
        return await self.log("AI_TEMPLATE_DRAFTED", {
            "template_id": template_id, "template_version": version, "template_hash": template_hash,
            "prompt_hash": h("operator-prompt")}, who=AI)

    async def template_created(self, template=TPL_DRAFTED, origin="AI_DRAFTED"):
        template_id, version, template_hash = template
        return await self.log("TEMPLATE_CREATED", {
            "template_id": template_id, "template_version": version, "template_hash": template_hash,
            "origin": origin}, who=OPERATOR)

    async def unsupported(self):
        return await self.log("REQUEST_UNSUPPORTED", {"reason_code": "NO_TEMPLATE"}, who=OPERATOR)

    # --- working copy ------------------------------------------------------
    async def instantiated(self, template=TPL_LEAVE, revision=1):
        template_id, version, _ = template
        return await self.log("TEMPLATE_INSTANTIATED", {
            "template_id": template_id, "template_version": version, "working_copy_id": f"wc-{self.execution_id}",
            "revision": revision, "content_hash": h(f"copy-{self.execution_id}-r{revision}")})

    async def modified(self, revision=2):
        return await self.log("EXECUTION_TEMPLATE_MODIFIED", {
            "working_copy_id": f"wc-{self.execution_id}", "revision": revision,
            "previous_hash": h(f"copy-{self.execution_id}-r{revision - 1}"),
            "content_hash": h(f"copy-{self.execution_id}-r{revision}"), "changed_fields": ["steps.2.recipient"]},
            who=OPERATOR)

    async def modify_rejected(self):
        return await self.log("EXECUTION_TEMPLATE_MODIFY_REJECTED", {"reason_code": "AFTER_GATE1"},
                              who=OPERATOR, outcome="FAILURE")

    def copy_hash(self, revision=1) -> str:
        return h(f"copy-{self.execution_id}-r{revision}")

    # --- Gate 1 and execution -----------------------------------------------
    async def gate1_submitted(self):
        return await self.log("GATE1_SUBMITTED", {"revision": 1})

    async def gate1_approved(self, revision=1, approved_hash=None):
        return await self.log("GATE1_APPROVED", {
            "revision": revision, "approved_template_hash": approved_hash or self.copy_hash(revision),
            "comment_hash": h("looks fine")}, who=OPERATOR)

    async def gate1_rejected(self, revision=1):
        return await self.log("GATE1_REJECTED", {"revision": revision}, who=OPERATOR)

    async def execution_started(self, approved=None, executed=None):
        approved = approved or self.copy_hash()
        return await self.log("EXECUTION_STARTED", {"approved_template_hash": approved,
                                                     "executed_template_hash": executed or approved})

    async def attachment_extracted(self):
        return await self.log("ATTACHMENT_EXTRACTED", {
            "attachment_count": 1, "file_hashes": [h("attachment-1")], "extracted_chars": 1840})

    async def content_generated(self):
        return await self.log("AI_CONTENT_GENERATED", {"output_hash": h(f"content-{self.execution_id}")}, who=AI)

    async def document_generated(self):
        return await self.log("DOCUMENT_GENERATED", {"document_hash": self.document_hash, "format": "PDF"})

    @property
    def document_hash(self) -> str:
        return h(f"document-{self.execution_id}")

    # --- Gate 2, delivery, closing -----------------------------------------
    async def gate2_approved(self):
        return await self.log("GATE2_APPROVED", {"document_hash": self.document_hash}, who=OPERATOR)

    async def gate2_rejected(self):
        return await self.log("GATE2_REJECTED", {"document_hash": self.document_hash}, who=OPERATOR)

    async def delivered(self):
        return await self.log("JOB_DELIVERED", {"channel": "GMAIL", "recipient_hash": h("student@example")})

    async def closed(self, final_status="DELIVERED"):
        return await self.log("EXECUTION_CLOSED", {"final_status": final_status})

    # --- common middle part ------------------------------------------------
    async def run_after_template(self, template=TPL_LEAVE):
        """Working copy -> Gate 1 -> execute -> Gate 2 -> deliver -> close (the normal path)."""
        await self.instantiated(template)
        await self.gate1_submitted()
        await self.gate1_approved()
        await self.execution_started()
        await self.attachment_extracted()
        await self.content_generated()
        await self.document_generated()
        await self.gate2_approved()
        await self.delivered()
        await self.closed("DELIVERED")


async def scenario_a(service, execution_id="job-a", workspace_id=WS) -> Request:
    """A. Normal: AI selects -> operator accepts -> both gates -> delivered."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.standardized()
    await req.ai_selected()
    await req.run_after_template()
    return req


async def scenario_b(service, execution_id="job-b", workspace_id=WS) -> Request:
    """B. No match: AI finds no template -> operator rejects -> closed UNSUPPORTED, no execution."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.standardized()
    await req.ai_no_match()
    await req.unsupported()
    await req.closed("UNSUPPORTED")
    return req


async def scenario_c(service, execution_id="job-c", workspace_id=WS) -> Request:
    """C. Operator switches: AI picks tpl-leave, operator picks tpl-room-change."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.standardized()
    await req.ai_selected(TPL_LEAVE)
    await req.manually_selected(TPL_ROOM, ai_template_id=TPL_LEAVE[0])
    await req.run_after_template(TPL_ROOM)
    return req


async def scenario_d(service, execution_id="job-d", workspace_id=WS) -> Request:
    """D. Operator requests a new template: prompt -> AI drafts -> saved -> normal path."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.standardized()
    await req.ai_no_match()
    await req.template_requested()
    await req.ai_drafted(TPL_DRAFTED)
    await req.template_created(TPL_DRAFTED, origin="AI_DRAFTED")
    await req.run_after_template(TPL_DRAFTED)
    return req


async def scenario_e(service, execution_id="job-e", workspace_id=WS) -> Request:
    """E. Edit after Gate 1 is refused; what runs is still what was approved."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.standardized()
    await req.ai_selected()
    await req.instantiated()
    await req.modified(revision=2)            # allowed: before Gate 1
    await req.gate1_submitted()
    await req.gate1_approved(revision=2)
    await req.modify_rejected()               # refused: after Gate 1
    await req.execution_started(approved=req.copy_hash(2))
    await req.attachment_extracted()
    await req.content_generated()
    await req.document_generated()
    await req.gate2_approved()
    await req.delivered()
    await req.closed("DELIVERED")
    return req


async def scenario_g(service, execution_id="job-g", workspace_id=WS) -> Request:
    """G. Gate skipped (negative test): a document is generated with no GATE1_APPROVED."""
    req = Request(service, execution_id, workspace_id)
    await req.received()
    await req.ai_selected()
    await req.instantiated()
    await req.document_generated()            # <- no Gate 1 before this
    await req.closed("FAILED")
    return req
