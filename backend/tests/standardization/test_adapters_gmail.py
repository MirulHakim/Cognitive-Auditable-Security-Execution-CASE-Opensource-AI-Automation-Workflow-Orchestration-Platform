from datetime import datetime, timezone

import pytest

from src.standardization.adapters import gmail
from src.standardization.adapters.base import StandardizationError
from tests.standardization.fixtures import gmail_payloads as fx


class TestGmailToMessageFullFormat:
    def test_plain_text_chosen_sender_lowercased_subject_cleaned(self):
        msg = gmail.to_message(fx.FULL_WITH_ATTACHMENT, workspace_id="ws1", verified=True)
        assert msg.sender.id == "supplier@example.com"
        assert msg.sender.display_name == "ABC Supplier"
        assert msg.subject == "Invoice INV-001"
        assert msg.body_text == fx.BODY_TEXT

    def test_attachment_size_and_id_from_body(self):
        msg = gmail.to_message(fx.FULL_WITH_ATTACHMENT, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        att = msg.attachments[0]
        assert att.attachment_id == "att-001"
        assert att.filename == "invoice.pdf"
        assert att.size_bytes == 45231

    def test_no_attachment_message(self):
        msg = gmail.to_message(fx.FULL_NO_ATTACHMENT, workspace_id="ws1", verified=True)
        assert msg.attachments == []
        assert msg.body_text == fx.BODY_TEXT

    def test_html_only_body_falls_back_to_stripped_text(self):
        msg = gmail.to_message(fx.FULL_HTML_ONLY, workspace_id="ws1", verified=True)
        assert msg.body_text == "Please process the attached invoice."

    def test_quoted_display_name_with_comma_parsed_correctly(self):
        msg = gmail.to_message(fx.FULL_QUOTED_SENDER, workspace_id="ws1", verified=True)
        assert msg.sender.id == "john@example.com"
        assert msg.sender.display_name == "Doe, John"

    def test_attachment_without_attachment_id_is_included_not_dropped(self):
        msg = gmail.to_message(fx.FULL_MALFORMED_ATTACHMENT, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id is None
        assert msg.attachments[0].filename == "broken.pdf"

    def test_missing_sender_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.FULL_MISSING_SENDER, workspace_id="ws1", verified=True)

    def test_missing_id_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.MISSING_ID, workspace_id="ws1", verified=True)

    def test_missing_timestamp_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.FULL_MISSING_TIMESTAMP, workspace_id="ws1", verified=True)

    def test_neither_raw_nor_payload_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.NEITHER_RAW_NOR_PAYLOAD, workspace_id="ws1", verified=True)

    def test_unverified_sender_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.FULL_WITH_ATTACHMENT, workspace_id="ws1", verified=False)


class TestGmailToMessageRawFormat:
    def test_html_multipart_with_attachment(self):
        msg = gmail.to_message(fx.RAW_HTML_WITH_ATTACHMENT, workspace_id="ws1", verified=True)
        assert msg.sender.id == "supplier@example.com"
        assert msg.subject == "Invoice INV-002"
        assert "evil()" not in msg.body_text
        assert "attached" in msg.body_text
        assert msg.received_at == datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id == "att0"

    def test_plain_body_no_attachment(self):
        msg = gmail.to_message(fx.RAW_PLAIN_NO_ATTACHMENT, workspace_id="ws1", verified=True)
        assert msg.attachments == []
        assert msg.body_text == fx.BODY_TEXT

    def test_missing_date_raises(self):
        with pytest.raises(StandardizationError):
            gmail.to_message(fx.RAW_MISSING_DATE, workspace_id="ws1", verified=True)


class TestAuthResults:
    def test_reads_dkim_and_spf(self):
        assert gmail.auth_results(fx.FULL_WITH_ATTACHMENT) == {"dkim": "pass", "spf": "fail"}


class TestGmailToRecord:
    def test_email_record_fields(self):
        record = gmail.to_record(fx.FULL_WITH_ATTACHMENT)
        assert record.record_type == "email"
        assert record.data["sender"] == "supplier@example.com"
        assert record.data["attachment_count"] == 1
