"""
CASE Platform - Pydantic Schemas for Request/Response Validation
Module: Secure API Layer
Author: Nur A'in Safieya Ahmad Alauddin (225561)
Date: August 20, 2026
Framework: FastAPI + Pydantic v2

Purpose: Define Pydantic models for:
- Request validation (input sanitization)
- Response formatting (standardized JSON)
- JWT claims and request context
- Error responses, health check and API metadata
- Role-based access control (role -> permissions)

The audit, hash chain, export and provenance schemas (formerly sections 3-6)
moved to src/audit/schemas.py in Audit Phase 0. Section numbers below are
kept unchanged.
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
# 7. ERROR-SPECIFIC SCHEMAS
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
# 8. UTILITY SCHEMAS
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
# 9. ROLE-BASED ACCESS CONTROL (RBAC)
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
