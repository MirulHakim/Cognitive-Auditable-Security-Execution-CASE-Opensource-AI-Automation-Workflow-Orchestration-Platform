from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from src.standardization.schemas import (
    AttachmentMeta,
    FieldType,
    MessageSource,
    ResourceType,
    Sender,
    StandardMessage,
    StandardRecord,
    StandardRecordSet,
    VerificationMethod,
)
from src.standardization.utils import sha256_hex

VALID_HASH = sha256_hex("hello world")
MYT = timezone(timedelta(hours=8))


def _message(**overrides) -> StandardMessage:
    kwargs = dict(
        workspace_id="ws1",
        source=MessageSource.GMAIL,
        source_message_id="m1",
        sender=Sender(id="Supplier@Example.com", verified=True, verification_method=VerificationMethod.WHITELIST_DKIM_SPF),
        received_at=datetime(2026, 10, 1, 9, 0, tzinfo=MYT),
        subject="Invoice",
        body_text="hello",
        raw_hash=VALID_HASH,
    )
    kwargs.update(overrides)
    return StandardMessage(**kwargs)


def _record_set(**overrides) -> StandardRecordSet:
    kwargs = dict(
        workspace_id="ws1",
        execution_id="exec1",
        resource_id="r1",
        resource_name="Orders",
        resource_type=ResourceType.REST_API,
        fetched_at=datetime(2026, 10, 1, tzinfo=timezone.utc),
        field_types={"amount": FieldType.NUMBER},
        records=[StandardRecord(record_id="1", record_type="order", data={"amount": Decimal("10.00")})],
        record_count=1,
        raw_hash=VALID_HASH,
    )
    kwargs.update(overrides)
    return StandardRecordSet(**kwargs)


class TestStandardMessage:
    def test_valid_message_passes(self):
        msg = _message()
        assert msg.schema_version == "1.0"

    def test_sender_id_is_lowercased(self):
        assert _message().sender.id == "supplier@example.com"

    def test_plus_eight_offset_converted_to_utc(self):
        assert _message().received_at == datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)

    def test_rejects_naive_datetime(self):
        with pytest.raises(ValidationError):
            _message(received_at=datetime(2026, 10, 1, 9, 0))

    def test_rejects_wrong_verification_method_for_source(self):
        with pytest.raises(ValidationError):
            _message(sender=Sender(id="a@b.com", verified=True, verification_method=VerificationMethod.WHITELIST))

    def test_rejects_subject_on_telegram(self):
        with pytest.raises(ValidationError):
            _message(
                source=MessageSource.TELEGRAM,
                sender=Sender(id="tg:1", verified=True, verification_method=VerificationMethod.WHITELIST),
            )

    def test_rejects_body_over_max_chars(self):
        with pytest.raises(ValidationError):
            _message(body_text="x" * 10_001)

    def test_rejects_bad_raw_hash(self):
        with pytest.raises(ValidationError):
            _message(raw_hash="not-a-hash")

    def test_rejects_unknown_extra_field(self):
        with pytest.raises(ValidationError):
            _message(unexpected_field="nope")

    def test_rejects_unverified_sender(self):
        with pytest.raises(ValidationError):
            _message(sender=Sender(id="a@b.com", verified=False, verification_method=VerificationMethod.WHITELIST_DKIM_SPF))


class TestAttachmentMeta:
    def test_attachment_id_defaults_to_none(self):
        att = AttachmentMeta(filename="x.pdf", mime_type="application/pdf", size_bytes=10)
        assert att.attachment_id is None

    def test_attachment_id_can_be_set(self):
        att = AttachmentMeta(attachment_id="abc", filename="x.pdf", mime_type="application/pdf", size_bytes=10)
        assert att.attachment_id == "abc"


class TestStandardRecordSet:
    def test_valid_record_set_passes(self):
        assert _record_set().record_count == 1

    def test_rejects_float_in_number_field(self):
        with pytest.raises(ValidationError):
            _record_set(records=[StandardRecord(record_id="1", record_type="order", data={"amount": 10.5})])

    def test_rejects_field_not_in_field_types(self):
        with pytest.raises(ValidationError):
            _record_set(records=[StandardRecord(record_id="1", record_type="order", data={"unexpected": Decimal("1")})])

    def test_rejects_database_resource_type(self):
        with pytest.raises(ValidationError):
            _record_set(resource_type="DATABASE")

    def test_rejects_record_count_mismatch(self):
        with pytest.raises(ValidationError):
            _record_set(record_count=2)
