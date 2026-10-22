"""
CASE — Audit & Transparency Layer
Event catalogue (AUDIT_MODULE_PLAN.md §7)

Location: src/audit/catalogue.py

- AuditAction        : every action other modules may log; anything else is rejected
- EVENT_TYPES        : action -> event_type
- REQUIRED_DETAILS   : action -> Pydantic model of the details keys it must carry
- forbidden keys     : names that must never appear in details (rule 5)
- FINAL_STATUSES     : values of EXECUTION_CLOSED.final_status
- REQUIRED_PRIOR_GATE: gate-order rules checked by verify_lineage (Phase 4)

New actions can be added here without changing the hashing algorithm.
"""

from __future__ import annotations

from collections.abc import Mapping
from enum import Enum
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr

from .schemas import HASH_PATTERN, AuditEventTypeEnum


class AuditAction(str, Enum):
    # Ingress
    JOB_RECEIVED = "JOB_RECEIVED"
    INGRESS_REJECTED_NOT_WHITELISTED = "INGRESS_REJECTED_NOT_WHITELISTED"
    INGRESS_REJECTED_DKIM_FAIL = "INGRESS_REJECTED_DKIM_FAIL"
    # Standardization
    MESSAGE_STANDARDIZED = "MESSAGE_STANDARDIZED"
    STANDARDIZATION_FAILED = "STANDARDIZATION_FAILED"
    DATA_STANDARDIZED = "DATA_STANDARDIZED"  # reserved for future resources; not emitted in the MVP
    # AI
    AI_TEMPLATE_SELECTED = "AI_TEMPLATE_SELECTED"
    AI_TEMPLATE_NO_MATCH = "AI_TEMPLATE_NO_MATCH"
    AI_TEMPLATE_DRAFTED = "AI_TEMPLATE_DRAFTED"
    AI_CONTENT_GENERATED = "AI_CONTENT_GENERATED"
    # Template
    TEMPLATE_MANUALLY_SELECTED = "TEMPLATE_MANUALLY_SELECTED"
    TEMPLATE_REQUESTED = "TEMPLATE_REQUESTED"
    TEMPLATE_CREATED = "TEMPLATE_CREATED"
    TEMPLATE_DEACTIVATED = "TEMPLATE_DEACTIVATED"
    EXECUTION_TEMPLATE_MODIFIED = "EXECUTION_TEMPLATE_MODIFIED"
    REQUEST_UNSUPPORTED = "REQUEST_UNSUPPORTED"
    TEMPLATE_INSTANTIATED = "TEMPLATE_INSTANTIATED"
    EXECUTION_TEMPLATE_MODIFY_REJECTED = "EXECUTION_TEMPLATE_MODIFY_REJECTED"
    # Gates
    GATE1_SUBMITTED = "GATE1_SUBMITTED"
    GATE1_APPROVED = "GATE1_APPROVED"
    GATE1_REJECTED = "GATE1_REJECTED"
    GATE2_APPROVED = "GATE2_APPROVED"
    GATE2_REJECTED = "GATE2_REJECTED"
    # Execution
    EXECUTION_STARTED = "EXECUTION_STARTED"
    EXECUTION_FAILED = "EXECUTION_FAILED"
    EXECUTION_CLOSED = "EXECUTION_CLOSED"
    ATTACHMENT_EXTRACTED = "ATTACHMENT_EXTRACTED"
    # Output
    DOCUMENT_GENERATED = "DOCUMENT_GENERATED"
    JOB_DELIVERED = "JOB_DELIVERED"
    # Integrations
    INTEGRATION_CONNECTED = "INTEGRATION_CONNECTED"
    INTEGRATION_DISCONNECTED = "INTEGRATION_DISCONNECTED"
    # Security
    ACCESS_FORBIDDEN = "ACCESS_FORBIDDEN"
    AUTH_FAILED = "AUTH_FAILED"
    WHITELIST_ADDED = "WHITELIST_ADDED"
    WHITELIST_REMOVED = "WHITELIST_REMOVED"
    # Audit
    AUDIT_INTEGRITY_VERIFIED = "AUDIT_INTEGRITY_VERIFIED"
    AUDIT_INTEGRITY_FAILED = "AUDIT_INTEGRITY_FAILED"
    LINEAGE_VERIFIED = "LINEAGE_VERIFIED"
    LINEAGE_VERIFICATION_FAILED = "LINEAGE_VERIFICATION_FAILED"
    AUDIT_EXPORTED = "AUDIT_EXPORTED"
    PROVENANCE_RECORDED = "PROVENANCE_RECORDED"


A = AuditAction
T = AuditEventTypeEnum

EVENT_TYPES: Mapping[AuditAction, AuditEventTypeEnum] = {
    A.JOB_RECEIVED: T.SYSTEM_ACTION,
    A.INGRESS_REJECTED_NOT_WHITELISTED: T.SECURITY_EVENT,
    A.INGRESS_REJECTED_DKIM_FAIL: T.SECURITY_EVENT,
    A.MESSAGE_STANDARDIZED: T.SYSTEM_ACTION,
    A.STANDARDIZATION_FAILED: T.SYSTEM_ACTION,
    A.DATA_STANDARDIZED: T.SYSTEM_ACTION,
    A.AI_TEMPLATE_SELECTED: T.AI_DECISION,
    A.AI_TEMPLATE_NO_MATCH: T.AI_DECISION,
    A.AI_TEMPLATE_DRAFTED: T.AI_DECISION,
    A.AI_CONTENT_GENERATED: T.AI_DECISION,
    A.TEMPLATE_MANUALLY_SELECTED: T.USER_ACTION,
    A.TEMPLATE_REQUESTED: T.USER_ACTION,
    A.TEMPLATE_CREATED: T.USER_ACTION,
    A.TEMPLATE_DEACTIVATED: T.USER_ACTION,
    A.EXECUTION_TEMPLATE_MODIFIED: T.USER_ACTION,
    A.REQUEST_UNSUPPORTED: T.USER_ACTION,
    A.TEMPLATE_INSTANTIATED: T.SYSTEM_ACTION,
    A.EXECUTION_TEMPLATE_MODIFY_REJECTED: T.SECURITY_EVENT,
    A.GATE1_SUBMITTED: T.STATE_CHANGE,
    A.GATE1_APPROVED: T.APPROVAL_GATE,
    A.GATE1_REJECTED: T.APPROVAL_GATE,
    A.GATE2_APPROVED: T.APPROVAL_GATE,
    A.GATE2_REJECTED: T.APPROVAL_GATE,
    A.EXECUTION_STARTED: T.STATE_CHANGE,
    A.EXECUTION_FAILED: T.STATE_CHANGE,
    A.EXECUTION_CLOSED: T.STATE_CHANGE,
    A.ATTACHMENT_EXTRACTED: T.SYSTEM_ACTION,
    A.DOCUMENT_GENERATED: T.SYSTEM_ACTION,
    A.JOB_DELIVERED: T.SYSTEM_ACTION,
    A.INTEGRATION_CONNECTED: T.USER_ACTION,
    A.INTEGRATION_DISCONNECTED: T.USER_ACTION,
    A.ACCESS_FORBIDDEN: T.SECURITY_EVENT,
    A.AUTH_FAILED: T.SECURITY_EVENT,
    A.WHITELIST_ADDED: T.SECURITY_EVENT,
    A.WHITELIST_REMOVED: T.SECURITY_EVENT,
    A.AUDIT_INTEGRITY_VERIFIED: T.INTEGRITY_EVENT,
    A.AUDIT_INTEGRITY_FAILED: T.INTEGRITY_EVENT,
    A.LINEAGE_VERIFIED: T.INTEGRITY_EVENT,
    A.LINEAGE_VERIFICATION_FAILED: T.INTEGRITY_EVENT,
    A.AUDIT_EXPORTED: T.INTEGRITY_EVENT,
    A.PROVENANCE_RECORDED: T.INTEGRITY_EVENT,
}

FINAL_STATUSES: tuple[str, ...] = ("DELIVERED", "REJECTED_GATE1", "REJECTED_GATE2", "UNSUPPORTED", "FAILED")
FinalStatus = Literal["DELIVERED", "REJECTED_GATE1", "REJECTED_GATE2", "UNSUPPORTED", "FAILED"]

# Gate order (§3 rule 12, §8.5 check 7): each action may appear only after the
# named gate approval for the same request. Used by verify_lineage in Phase 4.
REQUIRED_PRIOR_GATE: Mapping[AuditAction, AuditAction] = {
    A.EXECUTION_STARTED: A.GATE1_APPROVED,
    A.ATTACHMENT_EXTRACTED: A.GATE1_APPROVED,
    A.AI_CONTENT_GENERATED: A.GATE1_APPROVED,
    A.DOCUMENT_GENERATED: A.GATE1_APPROVED,
    A.JOB_DELIVERED: A.GATE2_APPROVED,
}


# ---------------------------------------------------------------------------
# Forbidden details keys (rule 5): whole-key match plus secret-like suffixes,
# both case-insensitive. Whole-key, not substring, so required keys such as
# `content_hash` and `prompt_hash` stay valid.
# ---------------------------------------------------------------------------
FORBIDDEN_KEYS: frozenset[str] = frozenset({
    "body", "body_text", "content", "raw", "prompt", "prompt_text",
    "password", "token", "secret", "api_key", "credentials",
})
FORBIDDEN_SUFFIXES: tuple[str, ...] = ("_token", "_secret", "_password", "_api_key", "_credentials")


def is_forbidden_key(key: str) -> bool:
    lowered = key.lower()
    return lowered in FORBIDDEN_KEYS or lowered.endswith(FORBIDDEN_SUFFIXES)


def find_forbidden_keys(value: Any, path: str = "$") -> list[str]:
    """Paths of every forbidden key, searched through nested dicts and lists."""
    found: list[str] = []
    if isinstance(value, Mapping):
        for key, item in value.items():
            child = f"{path}.{key}"
            if isinstance(key, str) and is_forbidden_key(key):
                found.append(child)
            found.extend(find_forbidden_keys(item, child))
    elif isinstance(value, (list, tuple)):
        for i, item in enumerate(value):
            found.extend(find_forbidden_keys(item, f"{path}[{i}]"))
    return found


# ---------------------------------------------------------------------------
# Required details, one model per action (§7). Strict: "5" is not 5 and True
# is not 1. Extra keys are allowed; they are still checked for forbidden keys
# and size. The models only validate - the stored details are what the caller
# sent, so no defaults are ever added to the hashed record.
# ---------------------------------------------------------------------------
Hash = Annotated[StrictStr, Field(pattern=HASH_PATTERN)]
Count = Annotated[StrictInt, Field(ge=0)]
Id = Annotated[StrictStr, Field(min_length=1, max_length=128)]
Label = Annotated[StrictStr, Field(min_length=1, max_length=128)]
Code = Annotated[StrictStr, Field(pattern=r"^[A-Z][A-Z0-9_]{0,63}$")]
FieldName = Annotated[StrictStr, Field(pattern=r"^[A-Za-z_][A-Za-z0-9_.]{0,127}$")]
DecimalString = Annotated[StrictStr, Field(pattern=r"^\d+(\.\d+)?$")]
# The template version format belongs to the template store (§12.2 #4), so both are accepted as-is.
Version = Union[Annotated[StrictStr, Field(min_length=1, max_length=64)], Annotated[StrictInt, Field(ge=0)]]
# Details hold plain JSON strings, and strict mode does not accept a string for an Enum field.
SourceName = Literal["GMAIL", "TELEGRAM", "WEB_FORM", "WEB_APP", "SYSTEM", "REST_API", "JSON_FILE", "EMAIL_SERVICE"]


class _Details(BaseModel):
    model_config = ConfigDict(extra="allow", strict=True)


class MessageStandardizedDetails(_Details):
    adapter: Label
    schema_: Label = Field(alias="schema")
    input_hash: Hash
    output_hash: Hash
    body_truncated: StrictBool
    attachment_count: Count


class StandardizationFailedDetails(_Details):
    stage: Literal["message", "resource"]
    source: SourceName
    code: Code
    error_fields: list[FieldName]
    channel: Optional[Label] = None


class AiTemplateSelectedDetails(_Details):
    template_id: Id
    template_version: Version
    source_template_hash: Hash
    confidence: DecimalString


class AiTemplateNoMatchDetails(_Details):
    candidates_checked: Count
    reason_code: Code


class TemplateManuallySelectedDetails(_Details):
    ai_template_id: Optional[Id]  # required key; null after NO_MATCH
    template_id: Id
    template_version: Version
    source_template_hash: Hash


class TemplateRequestedDetails(_Details):
    prompt_hash: Hash


class AiTemplateDraftedDetails(_Details):
    template_id: Id
    template_version: Version
    template_hash: Hash
    prompt_hash: Hash


class TemplateCreatedDetails(_Details):
    template_id: Id
    template_version: Version
    template_hash: Hash
    origin: Literal["MANUAL", "AI_DRAFTED"]


class TemplateDeactivatedDetails(_Details):
    template_id: Id
    template_version: Version
    reason_code: Code


class TemplateInstantiatedDetails(_Details):
    template_id: Id
    template_version: Version
    working_copy_id: Id
    revision: Count
    content_hash: Hash


class ExecutionTemplateModifiedDetails(_Details):
    working_copy_id: Id
    revision: Count
    previous_hash: Hash
    content_hash: Hash
    changed_fields: list[FieldName]


class Gate1ApprovedDetails(_Details):
    revision: Count
    approved_template_hash: Hash
    comment_hash: Optional[Hash] = None


class Gate1RejectedDetails(_Details):
    revision: Count
    comment_hash: Optional[Hash] = None


class Gate2DecisionDetails(_Details):
    document_hash: Hash
    comment_hash: Optional[Hash] = None


class ExecutionStartedDetails(_Details):
    approved_template_hash: Hash
    executed_template_hash: Hash


class AttachmentExtractedDetails(_Details):
    attachment_count: Count
    file_hashes: list[Hash]
    extracted_chars: Count


class ExecutionClosedDetails(_Details):
    final_status: FinalStatus


class IntegrationDetails(_Details):
    integration_id: Id
    channel: Literal["GMAIL", "TELEGRAM"]
    scope_label: Label


class AuditIntegrityVerifiedDetails(_Details):
    verification_id: Id
    events_checked: Count
    head_seq: Count
    head_hash: Hash


class AuditIntegrityFailedDetails(AuditIntegrityVerifiedDetails):
    broken_at_seq: Count


class ProvenanceRecordedDetails(_Details):
    provenance_id: Id
    event_count: Count
    lineage_hash: Hash
    record_hash: Hash


# Actions not listed here take free-form details (still checked for forbidden keys and size).
REQUIRED_DETAILS: Mapping[AuditAction, type[BaseModel]] = {
    A.MESSAGE_STANDARDIZED: MessageStandardizedDetails,
    A.STANDARDIZATION_FAILED: StandardizationFailedDetails,
    A.AI_TEMPLATE_SELECTED: AiTemplateSelectedDetails,
    A.AI_TEMPLATE_NO_MATCH: AiTemplateNoMatchDetails,
    A.TEMPLATE_MANUALLY_SELECTED: TemplateManuallySelectedDetails,
    A.TEMPLATE_REQUESTED: TemplateRequestedDetails,
    A.AI_TEMPLATE_DRAFTED: AiTemplateDraftedDetails,
    A.TEMPLATE_CREATED: TemplateCreatedDetails,
    A.TEMPLATE_DEACTIVATED: TemplateDeactivatedDetails,
    A.TEMPLATE_INSTANTIATED: TemplateInstantiatedDetails,
    A.EXECUTION_TEMPLATE_MODIFIED: ExecutionTemplateModifiedDetails,
    A.GATE1_APPROVED: Gate1ApprovedDetails,
    A.GATE1_REJECTED: Gate1RejectedDetails,
    A.GATE2_APPROVED: Gate2DecisionDetails,
    A.GATE2_REJECTED: Gate2DecisionDetails,
    A.EXECUTION_STARTED: ExecutionStartedDetails,
    A.ATTACHMENT_EXTRACTED: AttachmentExtractedDetails,
    A.EXECUTION_CLOSED: ExecutionClosedDetails,
    A.INTEGRATION_CONNECTED: IntegrationDetails,
    A.INTEGRATION_DISCONNECTED: IntegrationDetails,
    A.AUDIT_INTEGRITY_VERIFIED: AuditIntegrityVerifiedDetails,
    A.AUDIT_INTEGRITY_FAILED: AuditIntegrityFailedDetails,
    A.PROVENANCE_RECORDED: ProvenanceRecordedDetails,
}

del A, T

__all__ = [
    "AuditAction", "EVENT_TYPES", "FINAL_STATUSES", "REQUIRED_PRIOR_GATE",
    "FORBIDDEN_KEYS", "FORBIDDEN_SUFFIXES", "is_forbidden_key", "find_forbidden_keys",
    "REQUIRED_DETAILS",
]
