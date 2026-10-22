from datetime import datetime, timedelta, timezone
from decimal import Decimal
from enum import Enum
from uuid import UUID

import pytest

from src.audit.canonical import (
    GENESIS_HASH, HASH_FIELDS, HASH_VERSION, CanonicalizationError, canonical_json, compute_event_hash,
    format_timestamp, normalize,
)

# The §5.2 formula, written out independently of the implementation.
PLAN_HASH_FIELDS = (
    "seq", "workspace_id", "event_timestamp", "execution_id", "event_type", "action",
    "actor_type", "actor_id", "actor_role", "target_type", "target_id", "source",
    "outcome", "details", "previous_hash",
)

GOLDEN_EVENT = {
    "seq": 1, "workspace_id": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    "event_timestamp": "2026-10-22T01:02:03.456789Z", "execution_id": "job-1",
    "event_type": "USER_ACTION", "action": "REQUEST_UNSUPPORTED", "actor_type": "USER",
    "actor_id": "u-123", "actor_role": "OPERATOR", "target_type": "execution", "target_id": "job-1",
    "source": "WEB_APP", "outcome": "SUCCESS", "details": {"reason_code": "NO_TEMPLATE", "count": 2},
    "previous_hash": "0" * 64,
}
# Computed once and fixed. If this changes, every stored chain stops verifying:
# bump HASH_VERSION instead of editing this value.
GOLDEN_HASH = "adac86307ec17e280ea2574c64483227db3583432b92d61e92da5f9f2cbd5528"


class TestConstants:
    def test_hash_fields_match_the_plan_exactly(self):
        assert HASH_FIELDS == PLAN_HASH_FIELDS

    def test_event_id_is_not_hashed(self):
        assert "event_id" not in HASH_FIELDS
        assert "current_hash" not in HASH_FIELDS

    def test_hash_version_and_genesis(self):
        assert HASH_VERSION == 1
        assert GENESIS_HASH == "0" * 64


class TestCanonicalJson:
    def test_sorted_keys_and_no_spaces(self):
        assert canonical_json({"b": 1, "a": [True, None, "x"]}) == '{"a":[true,null,"x"],"b":1}'

    def test_key_order_does_not_matter(self):
        assert canonical_json({"a": 1, "b": {"y": 2, "x": 3}}) == canonical_json({"b": {"x": 3, "y": 2}, "a": 1})

    def test_non_ascii_kept_as_utf8(self):
        assert canonical_json({"name": "Pejabat Asrama é"}) == '{"name":"Pejabat Asrama é"}'

    @pytest.mark.parametrize("value", [
        0.5, {"score": 0.87}, {"nested": {"deep": [1, 2, 0.1]}}, [1.0], float("nan"), float("inf"),
    ])
    def test_floats_rejected_anywhere(self, value):
        with pytest.raises(CanonicalizationError, match="float"):
            canonical_json(value)

    def test_float_error_names_the_path_not_the_value(self):
        with pytest.raises(CanonicalizationError) as exc_info:
            canonical_json({"meta": [{"ok": 1}, {"score": 0.123456}]})
        assert exc_info.value.path == "$.meta[1].score"
        assert "0.123456" not in str(exc_info.value)

    def test_decimal_as_string(self):
        assert canonical_json({"amount": Decimal("12.50")}) == '{"amount":"12.50"}'

    def test_non_finite_decimal_rejected(self):
        with pytest.raises(CanonicalizationError):
            canonical_json({"x": Decimal("NaN")})

    def test_uuid_lowercase(self):
        assert normalize(UUID("6F1C2A3B-4D5E-4F60-8A7B-9C0D1E2F3A4B")) == "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"

    def test_datetime_utc_microseconds_z(self):
        dt = datetime(2026, 10, 22, 9, 2, 3, 456789, tzinfo=timezone(timedelta(hours=8)))
        assert normalize(dt) == "2026-10-22T01:02:03.456789Z"

    def test_same_instant_in_different_zones_is_identical(self):
        utc = datetime(2026, 10, 22, 1, 0, tzinfo=timezone.utc)
        myt = utc.astimezone(timezone(timedelta(hours=8)))
        assert canonical_json({"t": utc}) == canonical_json({"t": myt})

    def test_whole_second_still_has_microseconds(self):
        assert format_timestamp(datetime(2026, 1, 1, tzinfo=timezone.utc)) == "2026-01-01T00:00:00.000000Z"

    def test_naive_datetime_rejected(self):
        with pytest.raises(CanonicalizationError, match="timezone-aware"):
            canonical_json({"t": datetime(2026, 1, 1)})

    @pytest.mark.parametrize("value", [{"note": "a\x00b"}, {"a\x00": 1}, ["\x00"]])
    def test_nul_rejected_in_values_and_keys(self, value):
        with pytest.raises(CanonicalizationError, match="u0000"):
            canonical_json(value)

    def test_lone_surrogate_rejected(self):
        with pytest.raises(CanonicalizationError, match="UTF-8"):
            canonical_json({"x": "\ud800"})

    def test_str_enum_uses_value(self):
        class Colour(str, Enum):
            RED = "RED"
        assert canonical_json({Colour.RED: Colour.RED}) == '{"RED":"RED"}'

    @pytest.mark.parametrize("value", [{1: "int key"}, {"s": {1, 2}}, {"b": b"bytes"}, {"o": object()}])
    def test_unsupported_types_and_non_string_keys_rejected(self, value):
        with pytest.raises(CanonicalizationError):
            canonical_json(value)

    def test_bool_is_not_turned_into_int(self):
        assert canonical_json([True, 1]) == "[true,1]"


class TestComputeEventHash:
    def test_golden_vector(self):
        assert compute_event_hash(GOLDEN_EVENT) == GOLDEN_HASH

    def test_same_event_same_hash_regardless_of_details_key_order(self):
        reordered = dict(GOLDEN_EVENT, details={"count": 2, "reason_code": "NO_TEMPLATE"})
        assert compute_event_hash(reordered) == GOLDEN_HASH

    def test_typed_values_hash_like_their_exported_strings(self):
        typed = dict(GOLDEN_EVENT, workspace_id=UUID(GOLDEN_EVENT["workspace_id"]),
                     event_timestamp=datetime(2026, 10, 22, 1, 2, 3, 456789, tzinfo=timezone.utc))
        assert compute_event_hash(typed) == GOLDEN_HASH

    @pytest.mark.parametrize("field", PLAN_HASH_FIELDS)
    def test_every_hashed_field_changes_the_hash(self, field):
        changed = dict(GOLDEN_EVENT)
        changed[field] = {"different": True} if field == "details" else (2 if field == "seq" else "changed")
        assert compute_event_hash(changed) != GOLDEN_HASH

    def test_event_id_does_not_change_the_hash(self):
        assert compute_event_hash(dict(GOLDEN_EVENT, event_id="anything")) == GOLDEN_HASH
