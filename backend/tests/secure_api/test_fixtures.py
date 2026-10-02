"""
Task 3.1 stand-in: placeholder raw data structures per resource type.

Real Task 3.1 (analyze data structures from *connected* resources) can't happen
until Sprint 2.3's real DB/API connections exist. These fixtures are best-guess
shapes based on the field names already assumed in schemas.DataConversionConfig
(id/created_at, message_id/from/to, etc.) — used to unblock Sprint 3 testing.

Once real resources are connected, compare these against real responses and
update both this file and schemas.DataConversionConfig if the shapes differ.
"""

from src.secure_api.schemas import ResourceTypeEnum

MOCK_RAW_DATA = {
    ResourceTypeEnum.REST_API: {
        "id": "usr_123",
        "created_at": "2026-08-20T10:30:00Z",
        "updated_at": "2026-08-21T11:00:00Z",
        "name": "Test User",
        "active": True,
    },
    ResourceTypeEnum.DATABASE: {
        "id": 42,
        "created_date": "2026-08-15",
        "customer_name": "Acme Corp",
        "balance": 1500.50,
    },
    ResourceTypeEnum.EMAIL_SERVICE: {
        "message_id": "<abc123@mail.example.com>",
        "date": "2026-08-20T09:15:00Z",
        "from": "alice@example.com",
        "to": "bob@example.com",
        "subject": "Quarterly Report",
    },
    ResourceTypeEnum.JSON_FILE: {
        "item_id": 7,
        "label": "Widget",
        "in_stock": True,
    },
}
