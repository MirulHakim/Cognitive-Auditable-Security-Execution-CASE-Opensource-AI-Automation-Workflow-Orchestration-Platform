"""
CASE — Audit & Transparency Layer
Schemas

Location: src/audit/schemas.py

Section 3 (the audit event) follows AUDIT_MODULE_PLAN.md §5.1 since Phase 1,
section 4 (verification result) follows §5.5 since Phase 2.
Sections 5-6 were moved unchanged from src/secure_api/schemas.py in Phase 0
and are revised in the phase that uses them (see the TODO on each section).
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
# 6. DECISION & PROVENANCE SCHEMAS
# ============================================================================
# TODO(Audit Phase 4): replace with the §5.4 provenance record (and rename WorkflowLineage, §3 rule 11).

class AIDecision(BaseModel):
    """AI decision record - tracks AI suggestions/classifications"""
    decision_id: UUID
    workflow_id: UUID
    ai_suggestion: str
    reasoning: Optional[str] = None
    confidence_score: int = Field(..., ge=0, le=100)
    evidence: Optional[List[str]] = None
    timestamp: datetime
    related_audit_event_id: UUID


class ApprovalStatusEnum(str, Enum):
    """Human approval status"""
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    PENDING = "PENDING"


class HumanDecision(BaseModel):
    """Human decision/approval record"""
    decision_id: UUID
    workflow_id: UUID
    decision: ApprovalStatusEnum
    approver_id: UUID
    rationale: Optional[str] = None
    timestamp: datetime
    related_audit_event_id: UUID


class ExecutionResultStatus(str, Enum):
    """Execution result status"""
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    PENDING = "PENDING"


class ExecutionResult(BaseModel):
    """Workflow execution result"""
    status: ExecutionResultStatus
    result_data: Optional[Any] = None
    error_message: Optional[str] = None
    timestamp: datetime


class WorkflowLineage(BaseModel):
    """Complete workflow lineage/provenance
    Objective → AI Decision → Human Approval → Execution Result
    """
    workflow_id: UUID
    objective: str
    ai_decision: Optional[AIDecision] = None
    human_decision: Optional[HumanDecision] = None
    execution_result: Optional[ExecutionResult] = None
    created_at: datetime
