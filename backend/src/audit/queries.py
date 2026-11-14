"""
CASE — Audit & Transparency Layer
Read-only queries for the audit API (AUDIT_MODULE_PLAN.md §9)

Location: src/audit/queries.py

Every function here only READS (no logging, no writes) and always takes the
caller's workspace_id, so one workspace can never see another's records:
an event or request of another workspace simply "does not exist" (404).

    list_events          GET /events                 flat timeline, filtered + paginated
    get_event_view       GET /events/{event_id}      one event + its neighbours' hashes
    list_executions      GET /executions             one row per request
    get_execution        GET /executions/{id}        all events of one request + provenance
    summarize            Objective -> Decision -> Approval -> Result (also used by the PDF)
"""

# queries.py - Understanding Notes
#
# Think of this file as the "reading room" of the audit archive:
# you can look at anything in YOUR workspace, but nothing here can change a record.
#
# integrity_status of a request (GET /executions):
#   NOT_SEALED      -> request not closed yet, so no provenance record
#   NOT_VERIFIED    -> sealed, but nobody has run verify-lineage on it
#   LINEAGE_VALID   -> the LAST verify-lineage run said VALID
#   LINEAGE_INVALID -> the LAST verify-lineage run said INVALID
# It comes from the LINEAGE_VERIFIED / LINEAGE_VERIFICATION_FAILED events already
# in the chain, so listing requests never runs (or logs) a new verification.

from __future__ import annotations

from typing import Optional
from uuid import UUID

from .canonical import GENESIS_HASH, compute_event_hash
from .catalogue import AuditAction
from .repository import AuditRepository
from .schemas import (AuditEvent, EventChainView, EventFilter, ExecutionDetail, ExecutionIntegrityEnum,
                      ExecutionSummary, LineageSummary, ProvenanceRecord, TemplateChoiceEnum)

_LINEAGE_RESULTS = {AuditAction.LINEAGE_VERIFIED.value: ExecutionIntegrityEnum.LINEAGE_VALID,
                    AuditAction.LINEAGE_VERIFICATION_FAILED.value: ExecutionIntegrityEnum.LINEAGE_INVALID}


# ---------------------------------------------------------------------------
# Timeline
# ---------------------------------------------------------------------------

async def list_events(repository: AuditRepository, workspace_id: UUID, filters: EventFilter, *,
                      limit: int, offset: int = 0) -> tuple[tuple[AuditEvent, ...], int]:
    """Newest first. Returns (page of events, total matching)."""
    return await repository.query_events(workspace_id, filters, limit=limit, offset=offset)


async def get_event_view(repository: AuditRepository, workspace_id: UUID,
                         event_id: UUID) -> Optional[EventChainView]:
    """One event with the hashes it links to: the "chain view" on the event page."""
    event = await repository.get_event(workspace_id, event_id)
    if event is None:
        return None
    around = {e.seq: e for e in await repository.list_events(workspace_id, from_seq=max(1, event.seq - 1),
                                                             to_seq=event.seq + 1)}
    if event.seq == 1:
        previous_hash: Optional[str] = GENESIS_HASH
    else:
        previous = around.get(event.seq - 1)
        previous_hash = previous.current_hash if previous is not None else None
    following = around.get(event.seq + 1)
    return EventChainView(
        event=event,
        previous_event_hash=previous_hash,
        next_event_previous_hash=following.previous_hash if following is not None else None,
        hash_matches=compute_event_hash(event) == event.current_hash,
        linked_to_previous=None if previous_hash is None else event.previous_hash == previous_hash,
        linked_to_next=None if following is None else following.previous_hash == event.current_hash,
    )


# ---------------------------------------------------------------------------
# Requests (one execution_id each)
# ---------------------------------------------------------------------------

def _template(record: ProvenanceRecord) -> str:
    d = record.decision
    return d.template_id if d.template_version is None else f"{d.template_id} v{d.template_version}"


def summarize(record: ProvenanceRecord) -> LineageSummary:
    """Objective -> Decision -> Approval -> Result as short readable lines (ids and labels only)."""
    o, d = record.objective, record.decision
    what = o.intent_label or o.request_ref or "objective not recorded"
    if d.template_id is None:
        decision = "No template used" + (" (AI found no match)" if d.classification_outcome else "")
    elif d.template_choice is TemplateChoiceEnum.OPERATOR_SWITCHED:
        decision = f"Operator switched {d.ai_suggested_template_id or 'no AI suggestion'} -> {_template(record)}"
    elif d.template_choice is TemplateChoiceEnum.OPERATOR_REQUESTED_NEW:
        decision = f"Operator requested a new template -> {_template(record)}"
    else:
        decision = f"AI suggested {_template(record)}, operator accepted"
    return LineageSummary(
        objective=f"{what} (via {o.source.value})",
        decision=decision,
        approvals=[f"{a.gate} {a.decision} by {a.by}" for a in record.approvals],
        result=record.result.final_status,
    )


def integrity_of(events: tuple[AuditEvent, ...],
                 record: Optional[ProvenanceRecord]) -> tuple[ExecutionIntegrityEnum, Optional[AuditEvent]]:
    """(status, the LINEAGE_* event it came from) for one request; also used by the PDF export."""
    if record is None:
        return ExecutionIntegrityEnum.NOT_SEALED, None
    last = next((e for e in reversed(events) if e.action in _LINEAGE_RESULTS
                 and e.details.get("provenance_id") == str(record.provenance_id)), None)
    if last is None:
        return ExecutionIntegrityEnum.NOT_VERIFIED, None
    return _LINEAGE_RESULTS[last.action], last


def _summary(execution_id: str, events: tuple[AuditEvent, ...],
             record: Optional[ProvenanceRecord]) -> ExecutionSummary:
    status, checked_by = integrity_of(events, record)
    return ExecutionSummary(
        execution_id=execution_id,
        event_count=len(events),
        first_event_at=events[0].event_timestamp,
        last_event_at=events[-1].event_timestamp,
        last_action=events[-1].action,
        provenance_id=record.provenance_id if record else None,
        summary=summarize(record) if record else None,
        integrity_status=status,
        last_lineage_check_at=checked_by.event_timestamp if checked_by else None,
    )


async def list_executions(repository: AuditRepository, workspace_id: UUID, *, limit: int,
                          offset: int = 0) -> tuple[tuple[ExecutionSummary, ...], int]:
    """Newest request first. Returns (page of summaries, total number of requests)."""
    ids, total = await repository.list_execution_ids(workspace_id, limit=limit, offset=offset)
    rows = []
    for execution_id in ids:
        events = await repository.list_execution_events(workspace_id, execution_id)
        record = await repository.get_provenance(workspace_id, execution_id)
        rows.append(_summary(execution_id, events, record))
    return tuple(rows), total


async def get_execution(repository: AuditRepository, workspace_id: UUID,
                        execution_id: str) -> Optional[ExecutionDetail]:
    events = await repository.list_execution_events(workspace_id, execution_id)
    if not events:
        return None
    record = await repository.get_provenance(workspace_id, execution_id)
    return ExecutionDetail(execution=_summary(execution_id, events, record), events=list(events),
                           provenance=record)


__all__ = ["list_events", "get_event_view", "summarize", "integrity_of", "list_executions", "get_execution"]
