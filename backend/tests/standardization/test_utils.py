from datetime import datetime, timezone
from decimal import Decimal

import pytest

from src.standardization.schemas import FieldType
from src.standardization.utils import (
    decode_b64url,
    html_to_text,
    infer_field_type,
    normalize_text,
    parse_bool,
    parse_date,
    parse_money,
    sha256_hex,
)


class TestDecodeB64url:
    def test_decodes_without_padding(self):
        assert decode_b64url("aGVsbG8") == b"hello"

    def test_invalid_base64_raises(self):
        with pytest.raises(ValueError):
            decode_b64url("not base64!!!")


class TestHtmlToText:
    def test_drops_script_content(self):
        text = html_to_text("<p>safe</p><script>evil()</script>")
        assert "evil" not in text
        assert "safe" in text

    def test_list_items_become_dash_prefixed(self):
        text = html_to_text("<ul><li>first</li><li>second</li></ul>")
        assert "- first" in text
        assert "- second" in text


class TestNormalizeText:
    def test_collapses_spaces_and_blank_lines(self):
        text, truncated = normalize_text("a    b\n\n\n\n\nc")
        assert "a b" in text
        assert "\n\n\n" not in text
        assert truncated is False

    def test_removes_control_characters(self):
        text, _ = normalize_text("a\x00b\x01c")
        assert "\x00" not in text
        assert "\x01" not in text

    def test_truncates_on_word_boundary_with_flag(self):
        text, truncated = normalize_text("word " * 3000, max_chars=100)
        assert truncated is True
        assert len(text) <= 100
        assert not text.endswith("wor")


class TestParseDate:
    def test_unix_seconds(self):
        assert parse_date(946684800) == datetime(2000, 1, 1, 0, 0, tzinfo=timezone.utc)

    def test_unix_milliseconds(self):
        assert parse_date(946684800000) == datetime(2000, 1, 1, 0, 0, tzinfo=timezone.utc)

    def test_iso_z(self):
        assert parse_date("2026-10-01T09:00:00Z") == datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)

    def test_iso_with_offset(self):
        assert parse_date("2026-10-01T09:00:00+08:00") == datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)

    def test_rfc_2822(self):
        assert parse_date("Wed, 01 Oct 2026 01:00:00 +0000") == datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)

    def test_day_first_with_time_is_myt(self):
        assert parse_date("01/10/2026 09:00") == datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)

    def test_date_only_is_midnight_myt(self):
        assert parse_date("2026-10-01") == datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)

    def test_unparseable_raises(self):
        with pytest.raises(ValueError):
            parse_date("next tuesday")


class TestParseMoney:
    def test_rm_with_comma(self):
        assert parse_money("RM 12,400") == Decimal("12400.00")

    def test_parentheses_are_negative(self):
        assert parse_money("(100.5)") == Decimal("-100.50")

    def test_float_addition_rounds_cleanly(self):
        assert parse_money(0.1 + 0.2) == Decimal("0.30")

    def test_myr_prefix_rounds_half_up(self):
        assert parse_money("MYR1,234.565") == Decimal("1234.57")

    def test_non_numeric_string_raises(self):
        with pytest.raises(ValueError):
            parse_money("abc")

    def test_bool_raises(self):
        with pytest.raises(ValueError):
            parse_money(True)

    def test_nan_string_raises(self):
        with pytest.raises(ValueError):
            parse_money("NaN")


class TestParseBool:
    def test_ya_is_true(self):
        assert parse_bool("Ya") is True

    def test_tidak_is_false(self):
        assert parse_bool("tidak") is False

    def test_maybe_raises(self):
        with pytest.raises(ValueError):
            parse_bool("maybe")


class TestInferFieldType:
    def test_numeric_looking_strings_stay_string(self):
        assert infer_field_type(["007", "042"]) == FieldType.STRING

    def test_iso_dates_become_datetime(self):
        assert infer_field_type(["2026-01-01", "2026-02-01"]) == FieldType.DATETIME


class TestSha256Hex:
    def test_dict_hash_independent_of_key_order(self):
        assert sha256_hex({"a": 1, "b": 2}) == sha256_hex({"b": 2, "a": 1})
