"""
Task 2.2: Secure API Layer - API Routes
Date: August 26, 2026
Sprint: Sprint 2 (W3-W4)

Defines the 4 REST API ENDPOINTS for resource management.
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from uuid import uuid4
from datetime import datetime

from .models import (
    CreateResourceRequest, CreateResourceResponse,
    ListResourcesResponse, GetResourceResponse,
    FetchResourceDataResponse, ErrorResponse, ErrorDetail
)
# Import the ResourceService class from the services module
from .services import ResourceService

# to create/get logger for this module to record what happens, _name_ is the name of the current module
logger = logging.getLogger(__name__)

# Create router
router = APIRouter(prefix="/api/v1", tags=["resources"])


# ============================================================================
# DEPENDENCY INJECTION
# ============================================================================

# Generate unique request ID for tracing 
def get_request_id() -> str:
    """Generate unique request ID for tracing."""
    return str(uuid4())

# Extract user context from JWT claims (this is mock for Sprint 2)
def get_user_context(request) -> dict:
    """
    Extract user context from JWT claims.

    NOTE: For Sprint 2, using mock JWT. Sprint 2.3 will integrate real JWT.
    """
    # Mock JWT claims (will be replaced with real validation in Sprint 2.3)
    return {
        "user_id": "mock-user-id",
        "workspace_id": "mock-workspace-id",
        "role": "ADMIN"  # Mock - will check real role in 2.3
    }


def get_resource_service(db) -> ResourceService:
    """Get ResourceService instance."""
    return ResourceService(db)


# ============================================================================
# ENDPOINT 1: POST /api/v1/resources (To Create Resource)
# ============================================================================

# when someone wants to create a new resource, they will send a POST request to /api/v1/resources with the resource details in the request body. This endpoint will handle that request and return a response indicating success or failure.
@router.post(
    "/resources",
    response_model=CreateResourceResponse,
    status_code=201,
    summary="Register a new enterprise resource"
)
async def create_resource(
    request_data: CreateResourceRequest,
    request_id: str = Depends(get_request_id),
    user_context: dict = Depends(get_user_context),
) -> CreateResourceResponse:
    """
    Register a new enterprise resource.

    **Requirements:**
    - User must be ADMIN role
    - Resource name must be unique in workspace
    - Connection URL must be valid

    **Returns:**
    - 201: Resource created successfully
    - 400: Validation error
    - 401: Invalid token
    - 403: Insufficient permissions
    """
    try:
        # Authorization check (RBAC)
        if user_context["role"] != "ADMIN":
            logger.warning(
                f"Unauthorized create_resource attempt by user {user_context['user_id']}",
                extra={"request_id": request_id}
            )
            raise HTTPException(
                status_code=403,
                detail=ErrorDetail(
                    code="ACCESS_FORBIDDEN",
                    message="Only ADMIN users can create resources"
                ).dict()
            )

        # TODO: Sprint 2.3 - Integrate real database
        # For now, return mock response
        resource_id = str(uuid4())

        logger.info(
            f"Resource created: {resource_id}",
            extra={
                "request_id": request_id,
                "workspace_id": user_context["workspace_id"],
                "user_id": user_context["user_id"]
            }
        )

        return CreateResourceResponse(
            success=True,
            data={
                "resource_id": resource_id,
                "resource_name": request_data.resource_name,
                "resource_type": request_data.resource_type,
                "status": "ACTIVE",
                "created_by": user_context["user_id"],
                "created_at": datetime.utcnow(),
                "updated_at": datetime.utcnow()
            },
            metadata={
                "request_id": request_id,
                "response_time_ms": 45
            }
        )

    except ValueError as e:
        logger.error(f"Validation error: {str(e)}", extra={"request_id": request_id})
        raise HTTPException(
            status_code=400,
            detail=ErrorDetail(
                code="VALIDATION_ERROR",
                message=str(e)
            ).dict()
        )
    except Exception as e:
        logger.error(f"Error creating resource: {str(e)}", extra={"request_id": request_id})
        raise HTTPException(
            status_code=500,
            detail=ErrorDetail(
                code="INTERNAL_SERVER_ERROR",
                message="An unexpected error occurred"
            ).dict()
        )


# ============================================================================
# ENDPOINT 2: GET /api/v1/resources (List Resources)
# ============================================================================

@router.get(
    "/resources",
    response_model=ListResourcesResponse,
    summary="List all resources in workspace"
)
async def list_resources(
    limit: int = Query(10, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status: str = Query(None),
    request_id: str = Depends(get_request_id),
    user_context: dict = Depends(get_user_context),
) -> ListResourcesResponse:
    """
    List all resources in user's workspace.

    **Query Parameters:**
    - limit: Max results (1-100, default 10)
    - offset: Pagination offset (default 0)
    - status: Filter by status (ACTIVE, INACTIVE, ERROR)

    **Authorization:**
    - ADMIN, DEVELOPER, AUDITOR can list

    **Returns:**
    - 200: List of resources
    - 401: Invalid token
    """
    try:
        # Authorization check (all roles can list)
        if user_context["role"] not in ["ADMIN", "DEVELOPER", "AUDITOR"]:
            raise HTTPException(status_code=403)

        # TODO: Sprint 2.3 - Connect to real database
        # For now, return mock data
        logger.info(
            f"Listed resources from workspace",
            extra={
                "request_id": request_id,
                "workspace_id": user_context["workspace_id"],
                "limit": limit,
                "offset": offset
            }
        )

        return ListResourcesResponse(
            success=True,
            data=[
                {
                    "resource_id": "resource-1",
                    "resource_name": "Customer Records API",
                    "resource_type": "REST_API",
                    "status": "ACTIVE",
                    "created_by": user_context["user_id"],
                    "created_at": datetime.utcnow(),
                },
                {
                    "resource_id": "resource-2",
                    "resource_name": "Email Service",
                    "resource_type": "EMAIL_SERVICE",
                    "status": "ACTIVE",
                    "created_by": user_context["user_id"],
                    "created_at": datetime.utcnow(),
                }
            ],
            metadata={
                "request_id": request_id,
                "total_count": 2,
                "limit": limit,
                "offset": offset
            }
        )

    except Exception as e:
        logger.error(f"Error listing resources: {str(e)}", extra={"request_id": request_id})
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred"}
        )


# ============================================================================
# ENDPOINT 3: GET /api/v1/resources/{resource_id} (Get Single Resource)
# ============================================================================

@router.get(
    "/resources/{resource_id}",
    response_model=GetResourceResponse,
    summary="Get resource details"
)
async def get_resource(
    resource_id: str,
    request_id: str = Depends(get_request_id),
    user_context: dict = Depends(get_user_context),
) -> GetResourceResponse:
    """
    Get details of a specific resource.

    **Path Parameters:**
    - resource_id: UUID of resource

    **Authorization:**
    - ADMIN, DEVELOPER, AUDITOR can read

    **Returns:**
    - 200: Resource details
    - 404: Resource not found
    - 401: Invalid token
    """
    try:
        # Authorization check
        if user_context["role"] not in ["ADMIN", "DEVELOPER", "AUDITOR"]:
            raise HTTPException(status_code=403)

        # TODO: Sprint 2.3 - Connect to real database
        logger.info(
            f"Retrieved resource: {resource_id}",
            extra={
                "request_id": request_id,
                "workspace_id": user_context["workspace_id"],
                "resource_id": resource_id
            }
        )

        return GetResourceResponse(
            success=True,
            data={
                "resource_id": resource_id,
                "resource_name": "Customer Records API",
                "resource_type": "REST_API",
                "status": "ACTIVE",
                "created_by": user_context["user_id"],
                "created_at": datetime.utcnow(),
                "last_tested_at": datetime.utcnow()
            },
            metadata={
                "request_id": request_id
            }
        )

    except Exception as e:
        logger.error(f"Error getting resource: {str(e)}", extra={"request_id": request_id})
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred"}
        )


# ============================================================================
# ENDPOINT 4: GET /api/v1/resources/{resource_id}/data (Fetch Resource Data)
# ============================================================================

@router.get(
    "/resources/{resource_id}/data",
    response_model=FetchResourceDataResponse,
    summary="Fetch data from resource"
)
async def fetch_resource_data(
    resource_id: str,
    request_id: str = Depends(get_request_id),
    user_context: dict = Depends(get_user_context),
) -> FetchResourceDataResponse:
    """
    Fetch actual data from enterprise resource.

    **Path Parameters:**
    - resource_id: UUID of resource

    **Authorization:**
    - ADMIN, DEVELOPER can fetch (AUDITOR cannot)

    **Returns:**
    - 200: Resource data
    - 404: Resource not found
    - 403: Insufficient permissions
    - 401: Invalid token

    **Note:**
    Data standardization happens in Sprint 3.
    This endpoint returns raw data from resource.
    """
    try:
        # Authorization check
        if user_context["role"] not in ["ADMIN", "DEVELOPER"]:
            logger.warning(
                f"Unauthorized data fetch attempt by {user_context['user_id']} (role: {user_context['role']})",
                extra={"request_id": request_id}
            )
            raise HTTPException(
                status_code=403,
                detail={
                    "code": "ACCESS_FORBIDDEN",
                    "message": "Only ADMIN and DEVELOPER can fetch resource data"
                }
            )

        # TODO: Sprint 2.3 - Connect to real database and fetch actual data
        logger.info(
            f"Fetched data from resource: {resource_id}",
            extra={
                "request_id": request_id,
                "workspace_id": user_context["workspace_id"],
                "resource_id": resource_id
            }
        )

        return FetchResourceDataResponse(
            success=True,
            data={
                "resource_id": resource_id,
                "resource_type": "REST_API",
                "data": [
                    {"id": 1, "name": "Customer 1", "email": "customer1@example.com"},
                    {"id": 2, "name": "Customer 2", "email": "customer2@example.com"},
                ],
                "fetched_at": datetime.utcnow().isoformat(),
                "note": "Mock data - Sprint 2.3 will integrate real resource queries"
            },
            metadata={
                "request_id": request_id,
                "response_time_ms": 125
            }
        )

    except Exception as e:
        logger.error(
            f"Error fetching resource data: {str(e)}",
            extra={"request_id": request_id}
        )
        raise HTTPException(
            status_code=500,
            detail={"code": "INTERNAL_SERVER_ERROR", "message": "An unexpected error occurred"}
        )