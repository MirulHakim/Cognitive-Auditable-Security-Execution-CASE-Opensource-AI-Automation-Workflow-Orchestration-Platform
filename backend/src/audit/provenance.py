"""
CASE — Audit & Transparency Layer
Building the provenance record (AUDIT_MODULE_PLAN.md §5.4, §8.4 steps 1-2 and 4-5)

Location: src/audit/provenance.py

Ringkasnya: take all events of ONE request (one execution_id), read their
details, and fill in the "case summary":
    objective -> decision -> approvals -> execution -> result
then seal it with lineage_hash and record_hash.

Pure functions only: no database, no logging. AuditService.seal_provenance
loads the events, checks the chain, and saves what build_record returns.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from .canonical import GENESIS_HASH, compute_lineage_hash, compute_record_hash
from .catalogue import AuditAction
from .errors import ProvenanceError
from .schemas import (HASH_PATTERN, AuditEvent, ClassificationOutcomeEnum, ProvenanceApproval,
                      ProvenanceDecision, ProvenanceExecution, ProvenanceObjective, ProvenanceRecord,
                      ProvenanceResult, TemplateChoiceEnum)

A = AuditAction

# Gate events -> (gate, decision, details key holding the approved hash).
_GATE_EVENTS: dict[str, tuple[str, str, Optional[str]]] = {
    A.GATE1_APPROVED.value: ("GATE1", "APPROVED", "approved_template_hash"),
    A.GATE1_REJECTED.value: ("GATE1", "REJECTED", None),
    A.GATE2_APPROVED.value: ("GATE2", "APPROVED", "document_hash"),
    A.GATE2_REJECTED.value: ("GATE2", "REJECTED", None),
}


# ---------------------------------------------------------------------------
# Small readers for free-form details (actions without a required-details
# model, e.g. JOB_RECEIVED, DOCUMENT_GENERATED). A value of the wrong shape is
# treated as missing, so one odd event cannot stop a request from being sealed.
# ---------------------------------------------------------------------------

def _text(details: dict[str, Any], key: str, max_length: int) -> Optional[str]:
    value = details.get(key)
    return value if isinstance(value, str) and 0 < len(value) <= max_length else None


def _hash(details: dict[str, Any], key: str) -> Optional[str]:
    value = details.get(key)
    return value if isinstance(value, str) and re.fullmatch(HASH_PATTERN, value) else None


def _last(events: Sequence[AuditEvent], *actions: AuditAction) -> Optional[AuditEvent]:
    names = {a.value for a in actions}
    return next((e for e in reversed(events) if e.action in names), None)


# ---------------------------------------------------------------------------
# Step 1-2: which events belong in the record
# ---------------------------------------------------------------------------

def select_lineage_events(events: Sequence[AuditEvent]) -> tuple[AuditEvent, ...]:
    """The events of one request that go into its record: ordered by seq, up to
    and including the single EXECUTION_CLOSED.

    Events logged after closing (PROVENANCE_RECORDED, LINEAGE_VERIFIED, ...) are
    left out, so PROVENANCE_RECORDED is never part of its own lineage.
    """
    # Step 1: sort the events, oldest first.
    ordered = sorted(events, key=lambda e: e.seq)

    # Step 2: find the "job finished" event.
    closed = [e for e in ordered if e.action == A.EXECUTION_CLOSED.value]

    # Step 3: no "job finished" event = job not done yet = stop here.
    if len(closed) != 1:
        found = "no EXECUTION_CLOSED" if not closed else f"{len(closed)} EXECUTION_CLOSED events"
        raise ProvenanceError(f"request cannot be sealed: it has {found} (exactly one is required)",
                              code="NOT_CLOSED")

    # Step 4: keep events up to "job finished", throw away the rest.
    return tuple(e for e in ordered if e.seq <= closed[0].seq)


# ---------------------------------------------------------------------------
# Step 4: the parts of the record
# ---------------------------------------------------------------------------

def derive_template_choice(events: Sequence[AuditEvent]) -> TemplateChoiceEnum:
    """§5.4: no operator template event -> AI_SUGGESTED; TEMPLATE_MANUALLY_SELECTED ->
    OPERATOR_SWITCHED; TEMPLATE_REQUESTED -> OPERATOR_REQUESTED_NEW. If the operator
    did both, the later one (their final decision) counts."""
    last = _last(events, A.TEMPLATE_MANUALLY_SELECTED, A.TEMPLATE_REQUESTED)
    if last is None:
        return TemplateChoiceEnum.AI_SUGGESTED
    if last.action == A.TEMPLATE_MANUALLY_SELECTED.value:
        return TemplateChoiceEnum.OPERATOR_SWITCHED
    return TemplateChoiceEnum.OPERATOR_REQUESTED_NEW


def _objective(events: Sequence[AuditEvent]) -> ProvenanceObjective:
    received = _last(events, A.JOB_RECEIVED)
    standardized = _last(events, A.MESSAGE_STANDARDIZED)
    classified = _last(events, A.AI_TEMPLATE_SELECTED, A.AI_TEMPLATE_NO_MATCH)
    return ProvenanceObjective(
        source=(received or events[0]).source,
        request_ref=_text(received.details, "request_ref", 256) if received else None,
        intent_label=_text(classified.details, "intent_label", 128) if classified else None,
        std_message_output_hash=standardized.details["output_hash"] if standardized else None,
    )


def _decision(events: Sequence[AuditEvent]) -> ProvenanceDecision:
    classified = _last(events, A.AI_TEMPLATE_SELECTED, A.AI_TEMPLATE_NO_MATCH)
    ai_selected = classified if classified and classified.action == A.AI_TEMPLATE_SELECTED.value else None

    # The template finally used = the last event that chose or created one, in seq order.
    template_id = template_version = template_hash = None
    for e in events:
        d = e.details
        if e.action in (A.AI_TEMPLATE_SELECTED.value, A.TEMPLATE_MANUALLY_SELECTED.value):
            template_id, template_version, template_hash = d["template_id"], d["template_version"], d["source_template_hash"]
        elif e.action in (A.AI_TEMPLATE_DRAFTED.value, A.TEMPLATE_CREATED.value):
            template_id, template_version, template_hash = d["template_id"], d["template_version"], d["template_hash"]

    # The working copy after its last change (instantiated, then maybe edited before Gate 1).
    copy = _last(events, A.TEMPLATE_INSTANTIATED, A.EXECUTION_TEMPLATE_MODIFIED)

    return ProvenanceDecision(
        classification_outcome=(None if classified is None else
                                ClassificationOutcomeEnum.SELECTED if ai_selected else
                                ClassificationOutcomeEnum.NO_MATCH),
        ai_suggested_template_id=ai_selected.details["template_id"] if ai_selected else None,
        template_choice=derive_template_choice(events),
        template_id=template_id,
        template_version=template_version,
        source_template_hash=template_hash,
        template_created_in_request=any(e.action == A.TEMPLATE_CREATED.value for e in events),
        ai_confidence=ai_selected.details["confidence"] if ai_selected else None,
        working_copy_revision=copy.details["revision"] if copy else None,
        final_working_copy_hash=copy.details["content_hash"] if copy else None,
    )


def _approvals(events: Sequence[AuditEvent]) -> list[ProvenanceApproval]:
    approvals = []
    for e in events:
        gate = _GATE_EVENTS.get(e.action)
        if gate is None:
            continue
        name, decision, hash_key = gate
        approvals.append(ProvenanceApproval(
            gate=name, decision=decision, by=e.actor_id, role=e.actor_role, at=e.event_timestamp,
            approved_hash=e.details[hash_key] if hash_key else None,
            comment_hash=e.details.get("comment_hash"),
        ))
    return approvals


def _execution(events: Sequence[AuditEvent]) -> ProvenanceExecution:
    started = _last(events, A.EXECUTION_STARTED)
    if started is None:
        return ProvenanceExecution()
    approved, executed = started.details["approved_template_hash"], started.details["executed_template_hash"]
    return ProvenanceExecution(approved_template_hash=approved, executed_template_hash=executed,
                               hashes_match=approved == executed)


def _result(events: Sequence[AuditEvent]) -> ProvenanceResult:
    closed = _last(events, A.EXECUTION_CLOSED)
    delivered = _last(events, A.JOB_DELIVERED)
    document = _last(events, A.DOCUMENT_GENERATED)
    gate2 = _last(events, A.GATE2_APPROVED, A.GATE2_REJECTED)
    document_hash = (_hash(document.details, "document_hash") if document else None) \
        or (gate2.details["document_hash"] if gate2 else None)
    return ProvenanceResult(
        final_status=closed.details["final_status"],
        recipient_hash=_hash(delivered.details, "recipient_hash") if delivered else None,
        document_hash=document_hash,
    )


# ---------------------------------------------------------------------------
# Step 4-5: the whole record, with its two hashes
# ---------------------------------------------------------------------------

def build_record(workspace_id: UUID, execution_id: str, events: Sequence[AuditEvent], *,
                 provenance_id: UUID, sealed_at: datetime) -> ProvenanceRecord:
    """Build the sealed record from the events select_lineage_events returned."""
    if not events:
        raise ProvenanceError("request cannot be sealed: it has no events", code="NOT_CLOSED")
    event_hashes = [e.current_hash for e in events]
    draft = ProvenanceRecord(
        provenance_id=provenance_id,
        workspace_id=workspace_id,
        execution_id=execution_id,
        objective=_objective(events),
        decision=_decision(events),
        approvals=_approvals(events),
        execution=_execution(events),
        result=_result(events),
        event_ids=[e.event_id for e in events],
        event_hashes=event_hashes,
        lineage_hash=compute_lineage_hash(event_hashes),
        record_hash=GENESIS_HASH,  # placeholder: record_hash is not part of its own hash
        sealed_at=sealed_at,
    )
    return draft.model_copy(update={"record_hash": compute_record_hash(draft)})


__all__ = ["select_lineage_events", "derive_template_choice", "build_record"]
