"""
CASE Platform - Pydantic Schemas for Request/Response Validation
Module: Secure API Layer & Audit & Transparency Layer
Author: Nur A'in Safieya Ahmad Alauddin (225561)
Date: August 20, 2026
Framework: FastAPI + Pydantic v2

Purpose: Define Pydantic models for:
- Request validation (input sanitization)
- Response formatting (standardized JSON)
- Audit events (immutable event structure)
- Enterprise resources (credentials, metadata)
- Data standardization (heterogeneous -> unified format)
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, EmailStr, field_validator


# ============================================================================
# 1. SHARED/COMMON SCHEMAS
# ============================================================================

class RoleEnum(str, Enum):
    """User Roles for RBAC"""
    ADMIN = "ADMIN"
    DEVELOPER = "DEVELOPER"
    AUDITOR = "AUDITOR"


class APIResponse(BaseModel):
    """Standard API Response Wrapper - all endpoints return this structure"""
    success: bool
    data: Optional[Any] = None
    metadata: Optional[Dict[str, Any]] = None
    error: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "success": True,
                "data": {"resource_id": "550e8400-e29b-41d4-a716-446655440000"},
                "metadata": {
                    "request_id": "req-12345",
                    "timestamp": "2026-08-20T10:30:00Z",
                    "workspace_id": "550e8400-e29b-41d4-a716-446655440001"
                }
            }
        }


class ErrorResponse(BaseModel):
    """Standard Error Response"""
    success: bool = False
    error: Dict[str, Any]

    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "error": {
                    "code": "INVALID_REQUEST",
                    "message": "Resource not found",
                    "request_id": "req-12345"
                }
            }
        }


class ValidationErrorDetail(BaseModel):
    """Detail of a validation error"""
    field: str
    message: str
    received_value: Optional[Any] = None


class PaginationParams(BaseModel):
    """Pagination parameters for queries"""
    limit: int = Field(default=50, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


# ============================================================================
# 2. JWT & AUTHENTICATION SCHEMAS
# ============================================================================

class JWTClaims(BaseModel):
    """JWT Claims extracted and validated - consumed from security layer"""
    user_id: UUID
    workspace_id: UUID
    email: EmailStr
    role: RoleEnum
    iat: int
    exp: int


class RequestContext(BaseModel):
    """Request context added by auth middleware"""
    user_id: UUID
    workspace_id: UUID
    role: RoleEnum
    email: str
    request_id: str
    timestamp: datetime


# ============================================================================
# 3. ENTERPRISE RESOURCE SCHEMAS
#
# Resource CRUD request/response models (CreateResourceRequest, ResourceResponse,
# etc.) live in models.py, which routes.py/services.py actually import against.
# ResourceTypeEnum stays here because the data standardization schemas in
# section 7 below depend on it.
# ============================================================================

class ResourceTypeEnum(str, Enum):
    """Supported resource types"""
    REST_API = "REST_API"
    DATABASE = "DATABASE"
    EMAIL_SERVICE = "EMAIL_SERVICE"
    JSON_FILE = "JSON_FILE"


# ============================================================================
# 4. AUDIT EVENT SCHEMAS
# ============================================================================

class AuditEventTypeEnum(str, Enum):
    """Audit event types"""
    USER_ACTION = "USER_ACTION"
    AI_DECISION = "AI_DECISION"
    SYSTEM_ACTION = "SYSTEM_ACTION"
    WORKFLOW_STATE_CHANGE = "WORKFLOW_STATE_CHANGE"
    APPROVAL_GATE = "APPROVAL_GATE"
    EXECUTION_RESULT = "EXECUTION_RESULT"


class ActorTypeEnum(str, Enum):
    """Type of actor performing the action"""
    USER = "USER"
    SYSTEM = "SYSTEM"
    AI = "AI"


class RecordAuditEventRequest(BaseModel):
    """Request: Record New Audit Event
    POST /api/v1/audit/events
    """
    event_type: AuditEventTypeEnum
    action_description: str = Field(..., min_length=1, max_length=500)
    affected_resource_id: Optional[UUID] = None
    affected_resource_type: Optional[str] = None
    action_data: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "event_type": "USER_ACTION",
                "action_description": "Created new enterprise resource",
                "affected_resource_id": "550e8400-e29b-41d4-a716-446655440000",
                "affected_resource_type": "REST_API",
                "action_data": {"resource_name": "Gmail Integration"}
            }
        }


class AuditEventSchema(BaseModel):
    """Core Audit Event - Immutable Record stored in database"""
    event_id: UUID
    workspace_id: UUID
    event_type: AuditEventTypeEnum
    actor_id: UUID
    actor_type: ActorTypeEnum
    action_description: str
    affected_resource_id: Optional[UUID] = None
    affected_resource_type: Optional[str] = None
    action_data: Optional[Dict[str, Any]] = None

    # Hash Chaining Fields
    previous_hash: Optional[str] = Field(None, pattern=r'^[a-f0-9]{64}$')  # SHA-256 hex
    current_hash: str = Field(..., pattern=r'^[a-f0-9]{64}$')  # SHA-256 hex

    # Temporal Fields
    timestamp: datetime
    created_at: datetime


class AuditTimelineEntry(BaseModel):
    """Denormalized Audit Timeline Entry - formatted for UI display"""
    event_id: UUID
    event_type: AuditEventTypeEnum
    actor_id: UUID
    actor_name: str  # from users.full_name
    actor_email: str
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
# 5. HASH CHAIN VERIFICATION SCHEMAS
# ============================================================================

class VerifyHashChainRequest(BaseModel):
    """Request: Verify Hash Chain Integrity
    GET /api/v1/audit/verify?event_id=...&full_chain=true
    """
    event_id: Optional[UUID] = None  # if provided, verify single event; else entire chain
    full_chain: bool = False


class HashVerificationStatusEnum(str, Enum):
    """Hash verification status"""
    VALID = "VALID"
    INVALID = "INVALID"
    BROKEN_CHAIN = "BROKEN_CHAIN"


class HashVerificationResult(BaseModel):
    """Response: Hash Chain Verification Result
    POST /api/v1/audit/verify
    """
    status: HashVerificationStatusEnum
    is_valid: bool
    total_events_checked: int
    broken_at_event_id: Optional[UUID] = None  # if chain broken, which event
    verification_timestamp: datetime
    details: Optional[Dict[str, Any]] = None

    class Config:
        json_schema_extra = {
            "example": {
                "status": "VALID",
                "is_valid": True,
                "total_events_checked": 1523,
                "verification_timestamp": "2026-08-20T10:30:00Z",
                "details": None
            }
        }


# ============================================================================
# 6. AUDIT EXPORT SCHEMAS
# ============================================================================

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
# 7. DATA STANDARDIZATION SCHEMAS
# ============================================================================

class FieldTypeEnum(str, Enum):
    """Standardized data field types"""
    STRING = "STRING"
    NUMBER = "NUMBER"
    BOOLEAN = "BOOLEAN"
    DATETIME = "DATETIME"
    JSON = "JSON"
    UNKNOWN = "UNKNOWN"


class StandardizedDataField(BaseModel):
    """Standardized data field mapping"""
    field_name: str
    field_value: Any
    original_field_name: Optional[str] = None
    field_type: FieldTypeEnum
    transformed: bool = False


class StandardizedDataRecord(BaseModel):
    """Standardized data record - converted from heterogeneous sources"""
    record_id: UUID
    resource_id: UUID
    resource_type: ResourceTypeEnum
    fields: List[StandardizedDataField]
    original_data: Optional[Dict[str, Any]] = None  # preserve original for comparison
    standardization_timestamp: datetime


class TypeConversionRule(BaseModel):
    """Type conversion rule for field mapping"""
    source_field: str
    target_field: str
    target_type: FieldTypeEnum
    conversion_rule: Optional[str] = None


class TypeConversionRules(BaseModel):
    """Type conversion rules by resource type"""
    resource_type: ResourceTypeEnum
    field_mappings: List[TypeConversionRule]


# ============================================================================
# 8. DECISION & PROVENANCE SCHEMAS
# ============================================================================

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


# ============================================================================
# 9. ERROR-SPECIFIC SCHEMAS
# ============================================================================

class ErrorCode(str, Enum):
    """API error codes"""
    INVALID_REQUEST = "INVALID_REQUEST"
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    INTERNAL_ERROR = "INTERNAL_ERROR"
    VALIDATION_ERROR = "VALIDATION_ERROR"


class ValidationErrorResponse(BaseModel):
    """Validation error response"""
    success: bool = False
    error: Dict[str, Any] = Field(...)

    class Config:
        json_schema_extra = {
            "example": {
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Input validation failed",
                    "details": [
                        {"field": "resource_name", "message": "String must be at most 255 characters"},
                        {"field": "base_url", "message": "Invalid URL format"}
                    ],
                    "request_id": "req-12345"
                }
            }
        }


class AuthErrorResponse(BaseModel):
    """Authentication/Authorization error response"""
    success: bool = False
    error: Dict[str, Any] = Field(...)


# ============================================================================
# 10. UTILITY SCHEMAS
# ============================================================================

class HealthCheckResponse(BaseModel):
    """Health check endpoint response"""
    status: str = "healthy"
    timestamp: datetime
    version: str


class APIMetadata(BaseModel):
    """API metadata in responses"""
    request_id: str
    timestamp: datetime
    workspace_id: UUID


# ============================================================================
# 11. CONFIGURATION SCHEMAS (for reference)
# ============================================================================

class DataConversionConfig:
    """Configuration for data type conversions by resource type"""

    CONVERSIONS = {
        ResourceTypeEnum.REST_API: [
            TypeConversionRule(
                source_field="id",
                target_field="record_id",
                target_type=FieldTypeEnum.STRING
            ),
            TypeConversionRule(
                source_field="created_at",
                target_field="created_timestamp",
                target_type=FieldTypeEnum.DATETIME,
                conversion_rule="parse_iso8601()"
            ),
            TypeConversionRule(
                source_field="updated_at",
                target_field="updated_timestamp",
                target_type=FieldTypeEnum.DATETIME,
                conversion_rule="parse_iso8601()"
            ),
        ],
        ResourceTypeEnum.DATABASE: [
            TypeConversionRule(
                source_field="id",
                target_field="record_id",
                target_type=FieldTypeEnum.STRING
            ),
            TypeConversionRule(
                source_field="created_date",
                target_field="created_timestamp",
                target_type=FieldTypeEnum.DATETIME
            ),
        ],
        ResourceTypeEnum.EMAIL_SERVICE: [
            TypeConversionRule(
                source_field="message_id",
                target_field="record_id",
                target_type=FieldTypeEnum.STRING
            ),
            TypeConversionRule(
                source_field="date",
                target_field="created_timestamp",
                target_type=FieldTypeEnum.DATETIME
            ),
            TypeConversionRule(
                source_field="from",
                target_field="sender",
                target_type=FieldTypeEnum.STRING
            ),
            TypeConversionRule(
                source_field="to",
                target_field="recipient",
                target_type=FieldTypeEnum.STRING
            ),
        ],
        ResourceTypeEnum.JSON_FILE: [],  # Minimal transformation
    }

    @classmethod
    def get_conversion_rules(cls, resource_type: ResourceTypeEnum) -> List[TypeConversionRule]:
        """Get conversion rules for a resource type"""
        return cls.CONVERSIONS.get(resource_type, [])


# ============================================================================
# 12. ROLE-BASED ACCESS CONTROL (RBAC)
# ============================================================================

ROLE_PERMISSIONS = {
    RoleEnum.ADMIN: [
        "read:resources",
        "write:resources",
        "delete:resources",
        "read:audit",
        "export:audit",
        "verify:audit"
    ],
    RoleEnum.DEVELOPER: [
        "read:resources",
        "write:resources",
        "read:audit"
    ],
    RoleEnum.AUDITOR: [
        "read:audit",
        "export:audit",
        "verify:audit"
    ],
}


def check_permission(role: RoleEnum, permission: str) -> bool:
    """Check if a role has a specific permission"""
    return permission in ROLE_PERMISSIONS.get(role, [])
