import pytest

from src.standardization.adapters import web_form
from src.standardization.adapters.base import StandardizationError
from tests.standardization.fixtures import web_form_payloads as fx


class TestWebFormToMessage:
    def test_sender_identity_comes_from_jwt_email_not_form_body(self):
        msg = web_form.to_message(fx.VALID_FORM, workspace_id="ws1", user_email="Officer@Example.com", user_name="Officer Tan")
        assert msg.sender.id == "officer@example.com"
        assert msg.sender.display_name == "Officer Tan"

    def test_requested_resource_and_dorm_metadata_kept(self):
        msg = web_form.to_message(fx.VALID_FORM, workspace_id="ws1", user_email="officer@example.com")
        assert msg.metadata["requested_resource"] == "Dorm Billing API"
        assert msg.metadata["requested_output"] == "PDF"
        assert msg.metadata["student_id"] == "S1234567"
        assert msg.metadata["room_no"] == "A-204"

    def test_short_description_is_validation_error(self):
        with pytest.raises(StandardizationError) as exc_info:
            web_form.to_message(fx.FORM_TOO_SHORT_DESCRIPTION, workspace_id="ws1", user_email="officer@example.com")
        assert exc_info.value.code == "VALIDATION_ERROR"

    def test_missing_form_id_generates_one(self):
        msg = web_form.to_message(fx.FORM_NO_FORM_ID, workspace_id="ws1", user_email="officer@example.com")
        assert msg.source_message_id.startswith("form-")

    def test_subject_is_always_none(self):
        msg = web_form.to_message(fx.VALID_FORM, workspace_id="ws1", user_email="officer@example.com")
        assert msg.subject is None
