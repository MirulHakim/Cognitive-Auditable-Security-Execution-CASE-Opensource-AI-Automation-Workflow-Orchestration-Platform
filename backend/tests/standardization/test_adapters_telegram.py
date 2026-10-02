import pytest

from src.standardization.adapters import telegram
from src.standardization.adapters.base import StandardizationError
from tests.standardization.fixtures import telegram_payloads as fx


class TestTelegramToMessage:
    def test_username_normalized_into_metadata(self):
        msg = telegram.to_message(fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True)
        assert msg.metadata["telegram_username"] == "@supplier"

    def test_source_message_id_is_chat_colon_message(self):
        msg = telegram.to_message(fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True)
        assert msg.source_message_id == "456:123"

    def test_subject_is_always_none(self):
        msg = telegram.to_message(fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True)
        assert msg.subject is None

    def test_edited_message_is_unsupported_input(self):
        with pytest.raises(StandardizationError) as exc_info:
            telegram.to_message(fx.EDITED_MESSAGE_UPDATE, workspace_id="ws1", verified=True)
        assert exc_info.value.code == "UNSUPPORTED_INPUT"

    def test_channel_post_is_unsupported_input(self):
        with pytest.raises(StandardizationError) as exc_info:
            telegram.to_message(fx.CHANNEL_POST_UPDATE, workspace_id="ws1", verified=True)
        assert exc_info.value.code == "UNSUPPORTED_INPUT"

    def test_unrecognised_shape_is_unsupported_input(self):
        with pytest.raises(StandardizationError) as exc_info:
            telegram.to_message(fx.GARBAGE_UPDATE, workspace_id="ws1", verified=True)
        assert exc_info.value.code == "UNSUPPORTED_INPUT"

    def test_missing_sender_raises(self):
        with pytest.raises(StandardizationError):
            telegram.to_message(fx.MISSING_SENDER, workspace_id="ws1", verified=True)

    def test_missing_message_id_raises(self):
        with pytest.raises(StandardizationError):
            telegram.to_message(fx.MISSING_MESSAGE_ID, workspace_id="ws1", verified=True)

    def test_missing_date_raises(self):
        with pytest.raises(StandardizationError):
            telegram.to_message(fx.MISSING_DATE, workspace_id="ws1", verified=True)

    def test_document_without_file_id_is_included_not_dropped(self):
        msg = telegram.to_message(fx.MALFORMED_DOCUMENT, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id is None
        assert msg.attachments[0].filename == "broken.pdf"

    def test_audio_attachment(self):
        msg = telegram.to_message(fx.AUDIO_MESSAGE, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id == "AUDIO123"
        assert msg.attachments[0].mime_type == "audio/mpeg"

    def test_video_attachment(self):
        msg = telegram.to_message(fx.VIDEO_MESSAGE, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id == "VIDEO123"

    def test_photo_keeps_largest(self):
        msg = telegram.to_message(fx.PHOTO_MESSAGE, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id == "PHOTO_BIG"

    def test_photo_without_file_id_is_included_not_dropped(self):
        msg = telegram.to_message(fx.MALFORMED_PHOTO_NO_FILE_ID, workspace_id="ws1", verified=True)
        assert len(msg.attachments) == 1
        assert msg.attachments[0].attachment_id is None


class TestTelegramAdapterChanges:
    """The 3 adapter changes made after the initial port: Optional attachment_id
    (covered above), tg:<id> numeric sender identity, and bare-message support."""

    def test_sender_id_is_tg_prefixed_numeric_id(self):
        msg = telegram.to_message(fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True)
        assert msg.sender.id == "tg:456"

    def test_sender_without_username_is_allowed(self):
        msg = telegram.to_message(fx.UPDATE_TEXT_ONLY_NO_USERNAME, workspace_id="ws1", verified=True)
        assert msg.sender.id == "tg:789"
        assert msg.sender.display_name == "Jane"
        assert "telegram_username" not in msg.metadata

    def test_sender_with_username_keeps_tg_id_as_identity(self):
        msg = telegram.to_message(fx.UPDATE_WITH_DOCUMENT, workspace_id="ws1", verified=True)
        # identity is always the numeric id, never the username, even when a username exists
        assert msg.sender.id == "tg:456"
        assert msg.metadata["telegram_username"] == "@supplier"

    def test_missing_sender_id_still_raises(self):
        with pytest.raises(StandardizationError):
            telegram.to_message(fx.MISSING_SENDER, workspace_id="ws1", verified=True)

    def test_bare_message_without_envelope_is_accepted(self):
        msg = telegram.to_message(fx.BARE_MESSAGE_NO_USERNAME, workspace_id="ws1", verified=True)
        assert msg.sender.id == "tg:789"
        assert msg.source_message_id == "789:124"

    def test_bare_message_and_enveloped_message_are_equivalent(self):
        enveloped = telegram.to_message(fx.UPDATE_TEXT_ONLY_NO_USERNAME, workspace_id="ws1", verified=True)
        bare = telegram.to_message(fx.BARE_MESSAGE_NO_USERNAME, workspace_id="ws1", verified=True)
        assert enveloped.sender.id == bare.sender.id
        assert enveloped.source_message_id == bare.source_message_id
        assert enveloped.body_text == bare.body_text
