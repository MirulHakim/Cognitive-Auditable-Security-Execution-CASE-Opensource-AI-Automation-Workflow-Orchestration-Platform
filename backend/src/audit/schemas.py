"""
CASE — Audit & Transparency Layer
Schemas

Location: src/audit/schemas.py

Section 3 (the audit event) follows AUDIT_MODULE_PLAN.md §5.1 since Phase 1,
section 4 (verification result) follows §5.5 since Phase 2,
sections 6-7 (provenance record, lineage result) follow §5.4 / §8.5 since Phase 4.
Section 5 was moved unchanged from src/secure_api/schemas.py in Phase 0
and is revised in Phase 5 (see the TODO there).
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


# TODO(Audit Phase 5): revise the timeline schemas below for §9 (flat + grouped by request).

class AuditTimelineEntry(BaseModel):
    """Denormalized Audit Timeline Entry - formatted for UI display"""
    #event: what happened, who did it, when, and what was affected.
    event_id: UUID
    event_type: AuditEventTypeEnum
    #who did it, what role they had, and how to contact them.
    actor_id: UUID
    actor_name: str  # from users.full_name
    actor_email: str
    #action_description will be revised in Phase 5 
    action_description: str
    affected_resource_id: Optional[UUID] = None
    affected_resource_type: Optional[str] = None
    timestamp: datetime
    is_verified: Optional[bool] = None  # hash chain status


class QueryAuditTimelineRequest(BaseModel):
    """Request: Query Audit Timeline
    GET /api/v1/audit/timeline?event_type=USER_ACTION&...
    """
    event_type: Optional[AuditEventTypeEnum] = None
    actor_id: Optional[UUID] = None
    affected_resource_id: Optional[UUID] = None
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    search: Optional[str] = None
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class AuditTimelineResponse(BaseModel):
    """Response: Audit Timeline Query Results
    GET /api/v1/audit/timeline
    """
    events: List[AuditTimelineEntry]
    total_count: int
    limit: int
    offset: int


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
# 5. AUDIT EXPORT SCHEMAS
# ============================================================================
# TODO(Audit Phase 5): revise for §8.6 (JSON/PDF export with the chain head).

class ExportFormatEnum(str, Enum):
    """Export format options"""
    PDF = "PDF"
    JSON = "JSON"


class ExportAuditLogsRequest(BaseModel):
    """Request: Export Audit Logs
    POST /api/v1/audit/export
    """
    format: ExportFormatEnum
    date_from: Optional[datetime] = None
    date_to: Optional[datetime] = None
    event_types: Optional[List[AuditEventTypeEnum]] = None
    include_decision_lineage: bool = True
    include_verification_status: bool = True

    class Config:
        json_schema_extra = {
            "example": {
                "format": "PDF",
                "date_from": "2026-08-01T00:00:00Z",
                "date_to": "2026-08-20T23:59:59Z",
                "event_types": ["USER_ACTION", "APPROVAL_GATE"],
                "include_decision_lineage": True,
                "include_verification_status": True
            }
        }


class ExportAuditLogsResponse(BaseModel):
    """Response: Export Audit Logs"""
    export_id: UUID
    format: ExportFormatEnum
    file_url: str
    file_size_bytes: int
    created_at: datetime
    expires_at: datetime


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
    OPERATOR_SWITCHED = "OPERATOR_SWITCHED"              # TEMPLATE_MANUALLY_SELECTED
    OPERATOR_REQUESTED_NEW = "OPERATOR_REQUESTED_NEW"    # TEMPLATE_REQUESTED


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
