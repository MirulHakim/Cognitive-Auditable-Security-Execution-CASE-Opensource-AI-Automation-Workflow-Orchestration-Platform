"""
Task 2.2: Secure API Layer - Business Services
Date: August 26, 2026
Sprint: Sprint 2 (W3-W4)

Contains business logic for resource management.
"""

import logging
from typing import List, Optional
from uuid import uuid4
from datetime import datetime
import base64

from .models import ResourceResponse, ResourceDB

logger = logging.getLogger(__name__)


class ResourceService:
    """Service for managing enterprise resources."""

    def __init__(self, db_connection):
        """
        Initialize ResourceService.

        Args:
            db_connection: Database connection pool
        """
        self.db = db_connection

    async def create_resource(
        self,
        workspace_id: str,
        resource_name: str,
        resource_type: str,
        connection_url: str,
        encrypted_credentials: str,
        created_by: str,
        description: Optional[str] = None
    ) -> ResourceResponse:
        """
        Create a new enterprise resource.

        Args:
            workspace_id: Workspace the resource belongs to
            resource_name: Name of the resource
            resource_type: Type (REST_API, EMAIL_SERVICE, JSON_FILE)
            connection_url: Connection URL/endpoint
            encrypted_credentials: Encrypted credentials (base64)
            created_by: User ID who created it
            description: Optional description

        Returns:
            ResourceResponse with created resource details

        Raises:
            ValueError: If resource name already exists in workspace
        """
        try:
            # Check for duplicate name
            existing = await self._get_resource_by_name(workspace_id, resource_name)
            if existing:
                raise ValueError(f"Resource '{resource_name}' already exists in this workspace")

            # Generate ID
            resource_id = str(uuid4())

            # Decode credentials from base64 to binary
            try:
                credentials_bytes = base64.b64decode(encrypted_credentials)
            except Exception as e:
                raise ValueError(f"Invalid base64 credentials: {str(e)}")

            # Insert into database
            query = """
                INSERT INTO resources (
                    resource_id, workspace_id, resource_name,
                    resource_type, connection_url, encrypted_credentials,
                    status, created_by, created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """

            now = datetime.utcnow()
            values = (
                resource_id, workspace_id, resource_name,
                resource_type, connection_url, credentials_bytes,
                "ACTIVE", created_by, now, now
            )

            result = await self.db.fetch_one(query, values)

            logger.info(
                f"Resource created: {resource_id} in workspace {workspace_id}",
                extra={"workspace_id": workspace_id, "resource_id": resource_id}
            )

            return self._to_response(result)

        except Exception as e:
            logger.error(f"Error creating resource: {str(e)}")
            raise

    async def list_resources(
        self,
        workspace_id: str,
        limit: int = 10,
        offset: int = 0,
        status: Optional[str] = None
    ) -> tuple[List[ResourceResponse], int]:
        """
        List resources in a workspace.

        Args:
            workspace_id: Workspace to list resources from
            limit: Max results (1-100)
            offset: Pagination offset
            status: Filter by status (ACTIVE, INACTIVE, ERROR)

        Returns:
            Tuple of (resources list, total count)
        """
        try:
            # Build query with optional status filter
            where_clause = "WHERE workspace_id = %s"
            params = [workspace_id]

            if status:
                where_clause += " AND status = %s"
                params.append(status)

            # Get total count
            count_query = f"SELECT COUNT(*) as count FROM resources {where_clause}"
            count_result = await self.db.fetch_one(count_query, params)
            total_count = count_result['count'] if count_result else 0

            # Get paginated results
            query = f"""
                SELECT * FROM resources
                {where_clause}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])

            results = await self.db.fetch(query, params)

            logger.info(
                f"Listed {len(results)} resources from workspace {workspace_id}",
                extra={"workspace_id": workspace_id}
            )

            return [self._to_response(r) for r in results], total_count

        except Exception as e:
            logger.error(f"Error listing resources: {str(e)}")
            raise

    async def get_resource(
        self,
        workspace_id: str,
        resource_id: str
    ) -> ResourceResponse:
        """
        Get single resource details.

        Args:
            workspace_id: Workspace (for isolation check)
            resource_id: Resource to retrieve

        Returns:
            ResourceResponse

        Raises:
            ValueError: If resource not found
        """
        try:
            query = """
                SELECT * FROM resources
                WHERE workspace_id = %s AND resource_id = %s
            """
            result = await self.db.fetch_one(query, [workspace_id, resource_id])

            if not result:
                raise ValueError(f"Resource '{resource_id}' not found")

            logger.info(
                f"Retrieved resource: {resource_id}",
                extra={"workspace_id": workspace_id, "resource_id": resource_id}
            )

            return self._to_response(result)

        except Exception as e:
            logger.error(f"Error getting resource: {str(e)}")
            raise

    async def fetch_resource_data(
        self,
        workspace_id: str,
        resource_id: str,
        filters: Optional[dict] = None
    ) -> dict:
        """
        Fetch data from enterprise resource.

        Args:
            workspace_id: Workspace (for isolation)
            resource_id: Resource to fetch from
            filters: Optional resource-specific filters

        Returns:
            Raw data from resource

        Note:
            This is a placeholder. Sprint 3 will implement actual data fetching
            and standardization. For Sprint 2, returns mock data.
        """
        try:
            # Get resource config
            resource = await self.get_resource(workspace_id, resource_id)

            # TODO: Sprint 3 - Implement actual data fetching
            # For now, return mock data for testing
            mock_data = {
                "resource_id": resource_id,
                "resource_type": resource.resource_type,
                "data": [
                    {"id": 1, "name": "Sample Item 1", "status": "active"},
                    {"id": 2, "name": "Sample Item 2", "status": "pending"},
                ],
                "fetched_at": datetime.utcnow().isoformat(),
                "note": "Mock data - Sprint 3 will implement real fetching"
            }

            logger.info(
                f"Fetched data from resource: {resource_id}",
                extra={"workspace_id": workspace_id, "resource_id": resource_id}
            )

            return mock_data

        except Exception as e:
            logger.error(f"Error fetching resource data: {str(e)}")
            raise

    # ========================================================================
    # PRIVATE HELPER METHODS
    # ========================================================================

    async def _get_resource_by_name(
        self,
        workspace_id: str,
        resource_name: str
    ) -> Optional[dict]:
        """Check if resource name exists in workspace."""
        query = """
            SELECT * FROM resources
            WHERE workspace_id = %s AND resource_name = %s
            LIMIT 1
        """
        return await self.db.fetch_one(query, [workspace_id, resource_name])

    def _to_response(self, db_row: dict) -> ResourceResponse:
        """Convert database row to ResourceResponse."""
        return ResourceResponse(
            resource_id=db_row['resource_id'],
            resource_name=db_row['resource_name'],
            resource_type=db_row['resource_type'],
            status=db_row['status'],
            created_by=db_row.get('created_by'),
            created_at=db_row['created_at'],
            updated_at=db_row.get('updated_at'),
            last_tested_at=db_row.get('last_tested_at')
        )