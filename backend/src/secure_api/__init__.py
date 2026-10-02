"""
Secure API Layer Module

Task 2.2: Secure API Layer Development
Sprint 2 (W3-W4)

Provides REST API endpoints for enterprise resource management.
"""

from .routes import router
from .services import ResourceService
from .models import (
    CreateResourceRequest,
    CreateResourceResponse,
    ListResourcesResponse,
    GetResourceResponse,
    FetchResourceDataResponse,
)
from .database import DatabaseConnection, init_database, shutdown_database

__all__ = [
    "router",
    "ResourceService",
    "CreateResourceRequest",
    "CreateResourceResponse",
    "ListResourcesResponse",
    "GetResourceResponse",
    "FetchResourceDataResponse",
    "DatabaseConnection",
    "init_database",
    "shutdown_database",
]