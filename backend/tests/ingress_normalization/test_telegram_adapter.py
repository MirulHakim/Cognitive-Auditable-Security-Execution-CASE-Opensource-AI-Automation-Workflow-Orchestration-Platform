import pytest

from src.ingress_normalization.telegram_adapter import normalize_telegram
from tests.ingress_normalization.test_fixtures import (
    TELEGRAM_RAW_MALFORMED_DOCUMENT,
    TELEGRAM_RAW_MISSING_DATE,
    TELEGRAM_RAW_MISSING_MESSAGE_ID,
    TELEGRAM_RAW_MISSING_SENDER,
    TELEGRAM_RAW_TEXT_ONLY,
    TELEGRAM_RAW_UPDATE,
)


class TestNormalizeTelegram:
    def test_extracts_sender(self):
        result = normalize_telegram(TELEGRAM_RAW_UPDATE)
        assert result.source == "TELEGRAM"
        assert result.sender_id == "456"
        assert result.sender_name == "supplier"

    def test_falls_back_to_first_name_when_no_username(self):
        result = normalize_telegram(TELEGRAM_RAW_TEXT_ONLY)
        assert result.sender_name == "Jane"

    def test_no_subject_concept(self):
        result = normalize_telegram(TELEGRAM_RAW_UPDATE)
        assert result.subject is None

    def test_extracts_document_attachment(self):
        result = normalize_telegram(TELEGRAM_RAW_UPDATE)
        assert len(result.attachments) == 1
        attachment = result.attachments[0]
        assert attachment.attachment_id == "BAACAgIAAxkBAA"
        assert attachment.filename == "invoice.pdf"

    def test_uses_message_id_as_source_message_id(self):
        result = normalize_telegram(TELEGRAM_RAW_UPDATE)
        assert result.source_message_id == "123"

    def test_accepts_bare_message_without_update_wrapper(self):
        bare_message = TELEGRAM_RAW_UPDATE["message"]
        result = normalize_telegram(bare_message)
        assert result.sender_id == "456"

    def test_workspace_id_not_set_by_adapter(self):
        result = normalize_telegram(TELEGRAM_RAW_UPDATE)
        assert result.workspace_id is None

    def test_document_without_file_id_is_skipped_not_crashed(self):
        result = normalize_telegram(TELEGRAM_RAW_MALFORMED_DOCUMENT)
        assert result.attachments == []
        assert result.content == "See attached"

    def test_missing_sender_raises(self):
        with pytest.raises(ValueError):
            normalize_telegram(TELEGRAM_RAW_MISSING_SENDER)

    def test_missing_message_id_raises(self):
        with pytest.raises(ValueError):
            normalize_telegram(TELEGRAM_RAW_MISSING_MESSAGE_ID)

    def test_missing_date_raises(self):
        with pytest.raises(ValueError):
            normalize_telegram(TELEGRAM_RAW_MISSING_DATE)
