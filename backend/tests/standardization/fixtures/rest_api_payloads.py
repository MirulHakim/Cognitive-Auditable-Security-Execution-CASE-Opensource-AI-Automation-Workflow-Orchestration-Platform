"""Sample REST API responses and field mappings for standardization tests."""

ORDERS_MAPPING = {
    "records_path": "data.orders",
    "record_type": "order",
    "id_field": "order_id",
    "occurred_at_field": "created_at",
    "fields": {
        "client": {"path": "customer.name", "type": "STRING"},
        "amount_myr": {"path": "total", "type": "NUMBER", "format": "money"},
        "paid": {"path": "paid", "type": "BOOLEAN"},
    },
    "metadata_fields": {"room_no": "room.number"},
}

ORDERS_RESPONSE = {
    "data": {
        "orders": [
            {
                "order_id": "ORD-1",
                "customer": {"name": "Alice Tan"},
                "total": "RM 1,200.00",
                "paid": "ya",
                "created_at": "01/10/2026 09:00",
                "room": {"number": "A-204"},
            },
        ],
    },
}

ORDERS_RESPONSE_MISSING_ID = {
    "data": {
        "orders": [
            {"customer": {"name": "Bob Lee"}, "total": "500", "paid": "tidak", "created_at": "02/10/2026 10:00"},
        ],
    },
}

ORDERS_RESPONSE_BAD_AMOUNT = {
    "data": {
        "orders": [
            {"order_id": "ORD-2", "customer": {"name": "Carol"}, "total": "not-a-number",
             "paid": "ya", "created_at": "03/10/2026 08:00"},
        ],
    },
}

RESPONSE_NO_LIST_AT_PATH = {"data": {"orders": "not-a-list"}}

RESPONSE_SINGLE_OBJECT = {
    "order_id": "ORD-3", "customer": {"name": "Dan"}, "total": "10",
    "paid": "ya", "created_at": "04/10/2026 00:00",
}

INVALID_MAPPING = {"record_type": "order", "fields": {}}  # fields requires at least 1 entry


def make_bulk_orders(count: int) -> dict:
    return {
        "data": {
            "orders": [
                {
                    "order_id": f"ORD-{i}",
                    "customer": {"name": f"Customer {i}"},
                    "total": "10.00",
                    "paid": "ya",
                    "created_at": "01/10/2026 09:00",
                }
                for i in range(count)
            ],
        },
    }
