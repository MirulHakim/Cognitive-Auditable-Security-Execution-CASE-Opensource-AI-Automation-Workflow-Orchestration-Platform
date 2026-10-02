"""
Task 2.2: Secure API Layer - Pydantic Models
Date: August 26, 2026
Sprint: Sprint 2 (W3-W4)

Defines request/response schemas for all 4 API endpoints.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Literal
from datetime import datetime
from uuid import UUID


# ============================================================================
# RESPONSE ENVELOPE (Used by all endpoints)
# ============================================================================

class ApiResponse(BaseModel):
    """Standard response wrapper for all API endpoints."""
    success: bool
    data: Optional[dict] = None
    error: Optional[dict] = None
    metadata: dict = Field(default_factory=dict)


# ============================================================================
# REQUEST MODELS
# ============================================================================

class CreateResourceRequest(BaseModel):
    """Request body for POST /api/v1/resources"""
    resource_name: str = Field(..., max_length=255, min_length=1)
    resource_type: Literal["REST_API", "EMAIL_SERVICE", "JSON_FILE"]
    connection_url: str = Field(..., max_length=1000)
    encrypted_credentials: str  # Base64 encoded
    description: Optional[str] = Field(None, max_length=500)

    @field_validator('resource_name')
    @classmethod
    def sanitize_name(cls, v):
        """Remove dangerous characters from resource name."""
        # Remove XSS attempts, SQL injection attempts
        dangerous_chars = ['<', '>', '"', "'", ';', '--', '/*', '*/']
        for char in dangerous_chars:
            if char in v:
                raise ValueError(f"Resource name contains invalid character: {char}")
        return v.strip()

    @field_validator('connection_url')
    @classmethod
    def validate_url(cls, v):
        """Validate connection URL format."""
        if not (v.startswith('http://') or v.startswith('https://') or
                v.startswith('postgresql://') or v.startswith('mysql://')):
            raise ValueError("Connection URL must start with http://, https://, postgresql://, or mysql://")
        return v


class ListResourcesRequest(BaseModel):
    """Query parameters for GET /api/v1/resources"""
    limit: int = Field(default=10, ge=1, le=100)
    offset: int = Field(default=0, ge=0)
    status: Optional[Literal["ACTIVE", "INACTIVE", "ERROR"]] = None


class FetchResourceDataRequest(BaseModel):
    """Query parameters for GET /api/v1/resources/{id}/data"""
    filters: Optional[dict] = None  # Resource-specific filters


# ============================================================================
# RESPONSE MODELS
# ============================================================================

class ResourceResponse(BaseModel):
    """Single resource response."""
    resource_id: str
    resource_name: str
    resource_type: str
    connection_url: Optional[str] = None  # Don't expose in responses
    status: str
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_tested_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CreateResourceResponse(BaseModel):
    """Response for POST /api/v1/resources"""
    success: bool = True
    data: ResourceResponse
    metadata: dict


class ListResourcesResponse(BaseModel):
    """Response for GET /api/v1/resources"""
    success: bool = True
    data: List[ResourceResponse]
    metadata: dict


class GetResourceResponse(BaseModel):
    """Response for GET /api/v1/resources/{id}"""
    success: bool = True
    data: ResourceResponse
    metadata: dict


class FetchResourceDataResponse(BaseModel):
    """Response for GET /api/v1/resources/{id}/data"""
    success: bool = True
    data: dict  # Raw data from resource
    metadata: dict


# ============================================================================
# ERROR RESPONSE MODELS
# ============================================================================

class ErrorDetail(BaseModel):
    """Error response structure."""
    code: str  # e.g., "VALIDATION_ERROR", "RESOURCE_NOT_FOUND"
    message: str
    details: Optional[dict] = None


class ErrorResponse(BaseModel):
    """Standard error response."""
    success: bool = False
    error: ErrorDetail
    metadata: dict


# ============================================================================
# AUTH MODELS (From JWT token)
# ============================================================================

class JWTClaims(BaseModel):
    """JWT token claims."""
    user_id: str
    workspace_id: str
    role: Literal["ADMIN", "DEVELOPER", "AUDITOR"]
    exp: int  # Expiration timestamp


class UserContext(BaseModel):
    """User context extracted from JWT."""
    user_id: str
    workspace_id: str
    role: str
    request_id: str  # For tracing


# ============================================================================
# DATABASE MODELS (What we get from DB)
# ============================================================================

class ResourceDB(BaseModel):
    """Resource record from database."""
    resource_id: str
    workspace_id: str
    resource_name: str
    resource_type: str
    connection_url: str
    encrypted_credentials: bytes
    status: str
    created_by: str
    created_at: datetime
    updated_at: datetime
    last_tested_at: Optional[datetime] = None

    class Config:
        from_attributes = True