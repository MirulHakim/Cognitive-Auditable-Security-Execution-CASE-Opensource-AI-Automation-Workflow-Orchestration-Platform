"""
CASE — Audit & Transparency Layer
Schemas

Location: src/audit/schemas.py

Section 3 (the audit event) follows AUDIT_MODULE_PLAN.md §5.1 since Phase 1,
section 4 (verification result) follows §5.5 since Phase 2,
sections 6-7 (provenance record, lineage result) follow §5.4 / §8.5 since Phase 4,
section 5 (export) and section 8 (read API views) follow §8.6 / §9 since Phase 5.
The timeline filter (EventFilter) sits right after the audit event.
"""

import re
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Union
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

HASH_PATTERN = r"^[a-f0-9]{64}$"


# ============================================================================
# 3. AUDIT EVENT SCHEMAS (§5.1)
# ============================================================================

# Enum ni make sure hanya dalam senarai je yang boleh diplih. 
# Other than the listed values, it will raise validation error. 
# This is to make sure the data is standardized and consistent across the system.
class AuditEventTypeEnum(str, Enum):
    """Event type, derived from the action by the catalogue (§7)."""
    USER_ACTION = "USER_ACTION"
    AI_DECISION = "AI_DECISION"
    SYSTEM_ACTION = "SYSTEM_ACTION"
    APPROVAL_GATE = "APPROVAL_GATE"
    STATE_CHANGE = "STATE_CHANGE"
    SECURITY_EVENT = "SECURITY_EVENT"
    INTEGRITY_EVENT = "INTEGRITY_EVENT"

# actor_type = manusia, AI atau sistem? actor_role = peranan apa?
# actor_type dikira dari role: ADMIN/OPERATOR/AUDITOR -> USER, SYSTEM -> SYSTEM, AI -> AI.
class ActorTypeEnum(str, Enum):
    """Type of actor performing the action (derived from the role, §8.1)."""
    USER = "USER"
    #could be a system process, a scheduled job, or an external service acting on behalf of the system.
    SYSTEM = "SYSTEM"
    AI = "AI"

#   actor_role -> "With which role?"(ADMIN / OPERATOR / ...) - for permissions
# Why keep both:
#   - easy filtering: "all human decisions" = actor_type USER (no need to list every role)
#   - new roles can be added later; the 3 types never change
class ActorRoleEnum(str, Enum):
    ADMIN = "ADMIN"
    OPERATOR = "OPERATOR"
    AUDITOR = "AUDITOR"
    SYSTEM = "SYSTEM"
    AI = "AI"

#detect where the request came from: Gmail, Telegram, Web Form, Web App, or System (internal process). 
# For now: Unknown channels are recorded as SYSTEM by the caller.
class AuditSourceEnum(str, Enum):
    """Where the action came from. Unknown channels are recorded as SYSTEM by the caller."""
    GMAIL = "GMAIL"
    TELEGRAM = "TELEGRAM"
    WEB_FORM = "WEB_FORM"
    WEB_APP = "WEB_APP"
    SYSTEM = "SYSTEM"
    # Reserved for future resources; not used in the MVP.
    REST_API = "REST_API"
    JSON_FILE = "JSON_FILE"
    EMAIL_SERVICE = "EMAIL_SERVICE"


class OutcomeEnum(str, Enum):
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class AuditEvent(BaseModel):
    """One append-only audit record. `current_hash` covers every field except
    `event_id` (§5.2). `action` is checked against catalogue.AuditAction by
    AuditService; it is kept as text here so the catalogue can grow freely."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    #basic details of the event; all fields are required except execution_id (for single-event requests).
    event_id: UUID
    workspace_id: UUID
    seq: int = Field(ge=1)
    event_timestamp: datetime
    #which request/transaction this event belongs to; optional for single-event requests.
    execution_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    #category of the action
    event_type: AuditEventTypeEnum
    #what happened, who did it, what role they had, and what was affected.
    action: str = Field(min_length=1, max_length=64)
    actor_type: ActorTypeEnum
    actor_id: str = Field(min_length=1, max_length=128)
    actor_role: ActorRoleEnum
    #on what resource the action was performed; target_type is a short string (e.g., "document", "workflow") and target_id is a unique identifier for that resource.
    target_type: str = Field(pattern=r"^[a-z][a-z_]{0,31}$")
    target_id: str = Field(min_length=1, max_length=256)
    source: AuditSourceEnum
    outcome: OutcomeEnum
    details: Dict[str, Any]
    #chain fields: will be used for hash chain verification
    previous_hash: str = Field(pattern=HASH_PATTERN)
    current_hash: str = Field(pattern=HASH_PATTERN)

    @field_validator("event_timestamp")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("event_timestamp must be timezone-aware")
        return value.astimezone(timezone.utc)


def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Filters typed by a person may have no time zone ("2026-11-01"): read them as UTC."""
    if value is None:
        return None
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


# Timeline filters for GET /events (§9). Replaces the Phase 0 timeline schemas
# (they had actor names and emails, which audit events never store: rule 5).
class EventFilter(BaseModel):
    """Every field is optional; the ones given are combined with AND.
    date_from / date_to are inclusive."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    action: Optional[str] = Field(default=None, min_length=1, max_length=64)
    actor_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    actor_role: Optional[ActorRoleEnum] = None
    outcome: Optional[OutcomeEnum] = None
    execution_id: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @field_validator("date_from", "date_to")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)

    def matches(self, event: "AuditEvent") -> bool:
        """The same rules as the SQL WHERE clause in PostgresAuditRepository.query_events."""
        return ((self.date_from is None or event.event_timestamp >= self.date_from)
                and (self.date_to is None or event.event_timestamp <= self.date_to)
                and (self.action is None or event.action == self.action)
                and (self.actor_id is None or event.actor_id == self.actor_id)
                and (self.actor_role is None or event.actor_role is self.actor_role)
                and (self.outcome is None or event.outcome is self.outcome)
                and (self.execution_id is None or event.execution_id == self.execution_id))


# ============================================================================
# 4. HASH CHAIN VERIFICATION (§5.5, §8.3)
# ============================================================================

class VerificationStatusEnum(str, Enum):
    VERIFIED = "VERIFIED"
    BROKEN = "BROKEN"


# Why the chain is broken. verify_chain stops at the first one it finds.
class ChainBreakReasonEnum(str, Enum):
    # Found while walking the events in seq order:
    GAP = "GAP"                                  # a seq number is missing (record deleted)
    DUPLICATE_SEQ = "DUPLICATE_SEQ"              # seq repeats or goes backwards (Postgres UNIQUE prevents this)
    LINK_BROKEN = "LINK_BROKEN"                  # previous_hash != the prior record's current_hash (prior record changed and re-hashed)
    RECORD_MODIFIED = "RECORD_MODIFIED"          # recomputed hash != stored current_hash
    # Found by comparing with the chain head (§5.3):
    TAIL_TRUNCATED = "TAIL_TRUNCATED"            # head says more records exist than were found
    INSERTED_OUTSIDE_LOG_EVENT = "INSERTED_OUTSIDE_LOG_EVENT"  # a record exists after the head
    HEAD_MISMATCH = "HEAD_MISMATCH"              # same seq as the head, different hash


class ChainVerificationResult(BaseModel):
    """One verification run (§5.5). The four head fields are always filled, also
    when VERIFIED, so the Audit Trail page can show them side by side: a deleted
    last record shows as head_seq 250 vs last_found_seq 249.

    An empty chain has head_seq 0 and head_hash = 64 zeros (the genesis hash);
    last_found_* follow the same rule when no record was found."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    verification_id: UUID
    workspace_id: UUID
    verified_by: str = Field(min_length=1, max_length=128)
    verified_role: ActorRoleEnum
    verified_at: datetime
    #requested range; to_seq None = up to the end of the chain
    from_seq: int = Field(ge=1)
    to_seq: Optional[int] = Field(default=None, ge=1)
    #records read and checked, up to and including the broken one
    events_checked: int = Field(ge=0)
    status: VerificationStatusEnum
    #null when VERIFIED
    broken_at_seq: Optional[int] = Field(default=None, ge=1)
    reason: Optional[ChainBreakReasonEnum] = None
    unverifiable_after: Optional[int] = Field(default=None, ge=0)  # records found after the break (not checked)
    #chain head used for the comparison, and the last record actually found
    head_seq: int = Field(ge=0)
    head_hash: str = Field(pattern=HASH_PATTERN)
    last_found_seq: int = Field(ge=0)
    last_found_hash: str = Field(pattern=HASH_PATTERN)
    duration_ms: int = Field(ge=0)

    @field_validator("verified_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("verified_at must be timezone-aware")
        return value.astimezone(timezone.utc)

    @property
    def is_verified(self) -> bool:
        return self.status is VerificationStatusEnum.VERIFIED


# ============================================================================
# 5. AUDIT EXPORT (§8.6) - Phase 5
# ============================================================================
# The file itself is returned in the HTTP response (not stored on a server).
# What IS stored is an ExportRecord (table audit_exports): who exported what,
# and the chain head + file hash at that moment.

class ExportFormatEnum(str, Enum):
    PDF = "PDF"
    JSON = "JSON"


class ExportRequest(BaseModel):
    """Body of POST /api/v1/audit/export. No filter = the whole workspace
    (the only kind of export whose chain can be re-checked end to end offline)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    format: ExportFormatEnum
    execution_id: Optional[str] = Field(default=None, min_length=1, max_length=128)
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None

    @field_validator("date_from", "date_to")
    @classmethod
    def _utc(cls, value: Optional[datetime]) -> Optional[datetime]:
        return _as_utc(value)


class ExportRecord(BaseModel):
    """One row of audit_exports. Field names = column names (001_audit_tables.sql)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    export_id: UUID
    workspace_id: UUID
    exported_by: str = Field(min_length=1, max_length=128)
    exported_role: ActorRoleEnum
    exported_at: datetime
    format: ExportFormatEnum
    filters: Dict[str, Any]                  # the ExportRequest filters, as plain JSON
    record_count: int = Field(ge=0)          # number of events in the file
    head_seq: int = Field(ge=0)
    head_hash: str = Field(pattern=HASH_PATTERN)
    file_hash: str = Field(pattern=HASH_PATTERN)   # SHA-256 of the exact bytes given to the user

    @field_validator("exported_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("exported_at must be timezone-aware")
        return value.astimezone(timezone.utc)


# ============================================================================
# 6. PROVENANCE RECORD (§5.4, §8.4) - Phase 4
# ============================================================================
# One record per request, written once when the request is closed.
# Think of it as the "case summary" on top of the event log:
#   objective -> decision -> approvals -> execution -> result
# plus the list of events it was built from (event_ids / event_hashes),
# sealed with two hashes:
#   lineage_hash = hash of the event_hashes list   (were the events changed?)
#   record_hash  = hash of every other field       (was the summary changed?)
# Only ids, labels and hashes are stored here, never content (rule 5).

# Values of EXECUTION_CLOSED.final_status (catalogue.FINAL_STATUSES reads them from here).
FinalStatus = Literal["DELIVERED", "REJECTED_GATE1", "REJECTED_GATE2", "UNSUPPORTED", "FAILED"]

# The template version format belongs to the template store, so text and numbers are both kept as-is.
TemplateVersion = Union[str, int]


class ClassificationOutcomeEnum(str, Enum):
    """What the AI classification said (AI_TEMPLATE_SELECTED / AI_TEMPLATE_NO_MATCH)."""
    SELECTED = "SELECTED"
    NO_MATCH = "NO_MATCH"


class TemplateChoiceEnum(str, Enum):
    """Who decided the template (§5.4): lets an auditor see when a human changed the AI's choice."""
    AI_SUGGESTED = "AI_SUGGESTED"                        # no operator template event
    OPERATOR_SWITCHED = "OPERATOR_SWITCHED"              # TEMPLATE_MANUALLY_SELECTED: operator choose different existing template
    OPERATOR_REQUESTED_NEW = "OPERATOR_REQUESTED_NEW"    # TEMPLATE_REQUESTED: operator asks for new template from prompt


class _Part(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


class ProvenanceObjective(_Part):
    """What was asked. Fields are null when the event that carries them is missing."""
    source: AuditSourceEnum                       # channel of JOB_RECEIVED (first event if there is none)
    request_ref: Optional[str] = Field(default=None, max_length=256)     # JOB_RECEIVED.details.request_ref
    intent_label: Optional[str] = Field(default=None, max_length=128)    # readable objective from classification
    std_message_output_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)  # MESSAGE_STANDARDIZED.output_hash


class ProvenanceDecision(_Part):
    """Which template was used, and whether a human changed the AI's choice."""
    classification_outcome: Optional[ClassificationOutcomeEnum] = None   # null if the AI never ran
    ai_suggested_template_id: Optional[str] = None                       # null on NO_MATCH
    template_choice: TemplateChoiceEnum
    template_id: Optional[str] = None
    template_version: Optional[TemplateVersion] = None
    source_template_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)
    template_created_in_request: bool
    ai_confidence: Optional[str] = None          # recorded as text, NOT treated as calibrated
    working_copy_revision: Optional[int] = Field(default=None, ge=0)
    final_working_copy_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)


class ProvenanceApproval(_Part):
    """One gate decision. approved_hash: Gate 1 = approved template hash, Gate 2 = document hash
    (null on a rejection)."""
    gate: Literal["GATE1", "GATE2"]
    decision: Literal["APPROVED", "REJECTED"]
    by: str                                      # actor_id
    role: ActorRoleEnum
    at: datetime
    approved_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)
    comment_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)

    @field_validator("at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("at must be timezone-aware")
        return value.astimezone(timezone.utc)


class ProvenanceExecution(_Part):
    """Template approved at Gate 1 vs template actually executed. All null if execution never started."""
    approved_template_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)
    executed_template_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)
    hashes_match: Optional[bool] = None


class ProvenanceResult(_Part):
    final_status: FinalStatus                    # from EXECUTION_CLOSED
    recipient_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)
    document_hash: Optional[str] = Field(default=None, pattern=HASH_PATTERN)

#for the whole lineage
class ProvenanceRecord(BaseModel):
    """The sealed record of one request (§5.4). Stored in provenance_records (append-only)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    provenance_id: UUID
    workspace_id: UUID
    execution_id: str = Field(min_length=1, max_length=128)
    objective: ProvenanceObjective
    decision: ProvenanceDecision
    approvals: List[ProvenanceApproval]
    execution: ProvenanceExecution
    result: ProvenanceResult
    # Every event of this request up to and including EXECUTION_CLOSED, in seq order.
    event_ids: List[UUID]
    event_hashes: List[str]
    lineage_hash: str = Field(pattern=HASH_PATTERN)
    record_hash: str = Field(pattern=HASH_PATTERN)
    sealed_at: datetime

    @field_validator("event_hashes")
    @classmethod
    def _hashes(cls, value: List[str]) -> List[str]:
        if any(not re.fullmatch(HASH_PATTERN, h) for h in value):
            raise ValueError("every event hash must be 64 lowercase hex characters")
        return value

    @field_validator("sealed_at")
    @classmethod
    def _utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("sealed_at must be timezone-aware")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _same_length(self) -> "ProvenanceRecord":
        if len(self.event_ids) != len(self.event_hashes):
            raise ValueError("event_ids and event_hashes must have the same length")
        return self


# ============================================================================
# 7. LINEAGE VERIFICATION RESULT (§8.5) - Phase 4
# ============================================================================

class LineageStatusEnum(str, Enum):
    VALID = "VALID"
    INVALID = "INVALID"


# Everything verify_lineage can find wrong. Unlike verify_chain it reports
# every problem, not only the first.
class LineageProblemEnum(str, Enum):
    RECORD_HASH_MISMATCH = "RECORD_HASH_MISMATCH"          # 1. a provenance field was changed
    EVENT_MISSING = "EVENT_MISSING"                        # 2. a listed event is gone
    EVENT_MODIFIED = "EVENT_MODIFIED"                      # 2. a listed event no longer has its listed hash
    LINEAGE_HASH_MISMATCH = "LINEAGE_HASH_MISMATCH"        # 3. the event_hashes list was changed
    CHAIN_BROKEN = "CHAIN_BROKEN"                          # 4. verify_chain failed up to PROVENANCE_RECORDED
    PROVENANCE_EVENT_MISSING = "PROVENANCE_EVENT_MISSING"  # 5. no PROVENANCE_RECORDED for this record
    PROVENANCE_EVENT_MISMATCH = "PROVENANCE_EVENT_MISMATCH"  # 5. its details do not match the record
    TEMPLATE_HASH_MISMATCH = "TEMPLATE_HASH_MISMATCH"      # 6. approved template != executed template
    ORDER_VIOLATION = "ORDER_VIOLATION"                    # 7. a step happened before its required gate


class LineageProblem(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    reason: LineageProblemEnum
    seq: Optional[int] = Field(default=None, ge=1)   # the offending event, when there is one
    event_id: Optional[UUID] = None
    detail: Optional[str] = None                     # short explanation, never content


class LineageVerificationResult(BaseModel):
    """One verify_lineage run. VALID proves the record and its events are unchanged and
    that the recorded order respected both gates. It does not prove the AI classification
    or the human decision was correct."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    verification_id: UUID
    workspace_id: UUID
    execution_id: str
    provenance_id: UUID
    verified_by: str = Field(min_length=1, max_length=128)
    verified_role: ActorRoleEnum
    verified_at: datetime
    status: LineageStatusEnum
    events_checked: int = Field(ge=0)
    problems: List[LineageProblem]
    duration_ms: int = Field(ge=0)

    @property
    def is_valid(self) -> bool:
        return self.status is LineageStatusEnum.VALID


# ============================================================================
# 8. READ API VIEWS (§9) - Phase 5
# ============================================================================
# What the endpoints return. Built by queries.py from stored events and
# records; nothing here is stored.

class VerifyChainRequest(BaseModel):
    """Body of POST /verify. Both empty = the whole chain."""
    model_config = ConfigDict(frozen=True, extra="forbid")

    from_seq: Optional[int] = Field(default=None, ge=1)
    to_seq: Optional[int] = Field(default=None, ge=1)


class LineageSummary(_Part):
    """One line per step, for the request list: Objective -> Decision -> Approval -> Result."""
    objective: str
    decision: str
    approvals: List[str]          # e.g. ["GATE1 APPROVED by u-op-1", "GATE2 APPROVED by u-op-1"]
    result: str


class ExecutionIntegrityEnum(str, Enum):
    NOT_SEALED = "NOT_SEALED"                # no provenance record yet (request still open)
    NOT_VERIFIED = "NOT_VERIFIED"            # sealed, verify_lineage never run on it
    LINEAGE_VALID = "LINEAGE_VALID"          # the LAST verify_lineage run said VALID
    LINEAGE_INVALID = "LINEAGE_INVALID"      # the LAST verify_lineage run said INVALID


class ExecutionSummary(BaseModel):
    """One row of GET /executions."""
    model_config = ConfigDict(frozen=True, extra="forbid")

    execution_id: str
    event_count: int = Field(ge=0)
    first_event_at: datetime
    last_event_at: datetime
    last_action: str
    provenance_id: Optional[UUID] = None
    summary: Optional[LineageSummary] = None          # null until the request is sealed
    integrity_status: ExecutionIntegrityEnum
    last_lineage_check_at: Optional[datetime] = None  # when integrity_status was decided


class ExecutionDetail(BaseModel):
    """GET /executions/{execution_id}: every event of one request + its provenance record."""
    model_config = ConfigDict(frozen=True, extra="forbid")

    execution: ExecutionSummary
    events: List[AuditEvent]
    provenance: Optional[ProvenanceRecord] = None


class EventChainView(BaseModel):
    """GET /events/{event_id}: one event and its two neighbours in the chain.

    hash_matches      : recomputing this event's hash gives current_hash
    linked_to_previous: previous_hash == current_hash of seq-1 (genesis for seq 1);
                        null if seq-1 cannot be found
    linked_to_next    : this current_hash == previous_hash of seq+1; null if this is the last event
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    event: AuditEvent
    previous_event_hash: Optional[str] = None
    next_event_previous_hash: Optional[str] = None
    hash_matches: bool
    linked_to_previous: Optional[bool] = None
    linked_to_next: Optional[bool] = None
