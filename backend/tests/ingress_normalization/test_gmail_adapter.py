import pytest

from src.ingress_normalization.gmail_adapter import normalize_gmail
from tests.ingress_normalization.test_fixtures import (
    GMAIL_RAW_MESSAGE,
    GMAIL_RAW_MESSAGE_HTML_ONLY,
    GMAIL_RAW_MESSAGE_MALFORMED_ATTACHMENT,
    GMAIL_RAW_MESSAGE_MISSING_ID,
    GMAIL_RAW_MESSAGE_MISSING_SENDER,
    GMAIL_RAW_MESSAGE_MISSING_TIMESTAMP,
    GMAIL_RAW_MESSAGE_NO_ATTACHMENT,
    GMAIL_RAW_MESSAGE_QUOTED_SENDER,
)


class TestNormalizeGmail:
    def test_extracts_sender_and_subject(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE)
        assert result.source == "GMAIL"
        assert result.sender_id == "supplier@example.com"
        assert result.sender_name == "ABC Supplier"
        assert result.subject == "Invoice INV-001"

    def test_decodes_plain_text_body(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE)
        assert result.content == "Please process the attached invoice."

    def test_extracts_attachment_from_parts(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE)
        assert len(result.attachments) == 1
        attachment = result.attachments[0]
        assert attachment.attachment_id == "att-001"
        assert attachment.filename == "invoice.pdf"
        assert attachment.mime_type == "application/pdf"
        assert attachment.size_bytes == 45231

    def test_uses_gmail_id_as_source_message_id(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE)
        assert result.source_message_id == "18abc123def"

    def test_no_attachment_message(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE_NO_ATTACHMENT)
        assert result.attachments == []
        assert result.content == "Please process the attached invoice."

    def test_workspace_id_not_set_by_adapter(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE)
        assert result.workspace_id is None

    def test_html_only_body_falls_back_to_stripped_text(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE_HTML_ONLY)
        assert result.content == "Please process the attached invoice."

    def test_quoted_display_name_with_comma_parsed_correctly(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE_QUOTED_SENDER)
        assert result.sender_id == "john@example.com"
        assert result.sender_name == "Doe, John"

    def test_attachment_without_id_is_skipped_not_crashed(self):
        result = normalize_gmail(GMAIL_RAW_MESSAGE_MALFORMED_ATTACHMENT)
        assert result.attachments == []
        assert result.content == "Please process the attached invoice."

    def test_missing_sender_raises(self):
        with pytest.raises(ValueError):
            normalize_gmail(GMAIL_RAW_MESSAGE_MISSING_SENDER)

    def test_missing_id_raises(self):
        with pytest.raises(ValueError):
            normalize_gmail(GMAIL_RAW_MESSAGE_MISSING_ID)

    def test_missing_timestamp_raises(self):
        with pytest.raises(ValueError):
            normalize_gmail(GMAIL_RAW_MESSAGE_MISSING_TIMESTAMP)
