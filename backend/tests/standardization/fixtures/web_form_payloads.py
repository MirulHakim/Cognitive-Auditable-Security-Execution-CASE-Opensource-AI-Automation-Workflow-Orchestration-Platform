"""Sample web form submissions for standardization tests."""

VALID_FORM = {
    "form_id": "form-abc123",
    "description": "Please generate a PDF summary of this month's room arrears for Block A.",
    "resource": "Dorm Billing API",
    "output": "PDF",
    "metadata": {"student_id": "S1234567", "room_no": "A-204"},
}

FORM_TOO_SHORT_DESCRIPTION = {
    "description": "fix it",
    "resource": "Dorm Billing API",
}

FORM_NO_FORM_ID = {
    "description": "Please check my outstanding dorm fees and email me a breakdown.",
}
