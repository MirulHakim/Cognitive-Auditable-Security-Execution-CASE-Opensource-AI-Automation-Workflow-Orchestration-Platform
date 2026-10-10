"""Sample JSON file contents for standardization tests."""

import json

POLICY_DOCUMENT = {
    "policy_id": "POL-001",
    "title": "Late Checkout Policy",
    "effective_date": "2026-01-01T00:00:00Z",
    "max_fee": 50,
    "active": True,
    "tags": ["dorm", "checkout"],
}

POLICY_DOCUMENT_BYTES = json.dumps(POLICY_DOCUMENT).encode("utf-8")

LIST_OF_ITEMS = [
    {"item_id": 1, "label": "Widget", "in_stock": True, "created": "2026-01-01"},
    {"item_id": 2, "label": "Gadget", "in_stock": False, "created": "2026-02-01"},
]

INVALID_JSON_TEXT = "{not valid json"

LIST_OF_NON_OBJECTS = [1, 2, 3]
