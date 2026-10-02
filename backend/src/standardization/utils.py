"""
CASE — Data Standardization & Normalization Layer
Helpers (Step 2 of the module lifecycle)

Suggested location in the repo: src/standardization/utils.py

Pure, deterministic functions used by the adapters. No network, no AI,
no extra dependencies (Python standard library + the schemas module only).

Each converter either returns a clean value or raises ValueError with a clear
message. `coerce_or_warn` turns that ValueError into None + a warning, so one
bad value does not reject a whole record set.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal, InvalidOperation
from email.utils import parseaddr, parsedate_to_datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any, Iterable, Optional
from zoneinfo import ZoneInfo

from .schemas import MAX_BODY_CHARS, FieldType

# Source systems that send dates without a timezone are assumed to be local (Malaysia).
DEFAULT_TZ = ZoneInfo("Asia/Kuala_Lumpur")

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------
def sha256_hex(data: bytes | str | dict | list) -> str:
    """SHA-256 of bytes, text, or JSON (dict/list serialized canonically)."""
    if isinstance(data, (dict, list)):
        data = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Encoding
# ---------------------------------------------------------------------------
def decode_b64url(value: str) -> bytes:
    """Decode base64url (Gmail API format). Missing padding is added."""
    if not isinstance(value, str):
        raise ValueError("base64url value must be a string")
    s = value.strip().replace("-", "+").replace("_", "/")
    s += "=" * (-len(s) % 4)
    try:
        return base64.b64decode(s, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError("invalid base64url data") from exc


def decode_b64url_text(value: str, charset: str = "utf-8") -> str:
    """Decode base64url to text. Bad bytes are replaced, not fatal."""
    raw = decode_b64url(value)
    try:
        return raw.decode(charset or "utf-8", errors="replace")
    except LookupError:  # unknown charset name
        return raw.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Text
# ---------------------------------------------------------------------------
class _TextExtractor(HTMLParser):
    _BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "ul", "ol", "blockquote", "hr"}
    _SKIP = {"script", "style", "head", "title", "noscript"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self.parts.append("\n")
        if tag == "li":
            self.parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def html_to_text(html: str) -> str:
    """Convert HTML to plain text. Scripts, styles and hidden head content are dropped."""
    if not html:
        return ""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return unescape("".join(parser.parts))


def normalize_text(value: Optional[str], max_chars: int = MAX_BODY_CHARS) -> tuple[str, bool]:
    """
    Clean free text and cap its length.
    Returns (text, truncated).
      - Unicode NFC, Windows line endings -> \\n
      - control characters removed, tabs -> spaces
      - spaces collapsed inside each line, lines trimmed
      - 3+ blank lines collapsed to 1 blank line
      - cut at max_chars on a word boundary when possible
    """
    if not value:
        return "", False
    text = unicodedata.normalize("NFC", str(value)).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\t", " ")
    text = _CONTROL_CHARS.sub("", text)
    lines = [re.sub(r" {2,}", " ", line).strip() for line in text.split("\n")]
    text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
    if len(text) <= max_chars:
        return text, False
    cut = text[:max_chars]
    space = cut.rfind(" ")
    if space > max_chars * 0.8:
        cut = cut[:space]
    return cut.rstrip(), True


def normalize_short_text(value: Optional[str], max_chars: int = 500) -> Optional[str]:
    """Single-line text (subjects, names): one line, cleaned, capped. Empty -> None."""
    if value is None:
        return None
    text, _ = normalize_text(value, max_chars)
    text = text.replace("\n", " ").strip()
    return text or None


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
def normalize_email(value: str) -> str:
    """Lowercase and validate an email address."""
    addr = (value or "").strip().lower()
    if not _EMAIL_RE.match(addr):
        raise ValueError(f"invalid email address: {value!r}")
    return addr


def parse_address(header: str) -> tuple[Optional[str], str]:
    """'Ali Rahman <Client.Ali@ABC.com>' -> ('Ali Rahman', 'client.ali@abc.com')."""
    name, addr = parseaddr(header or "")
    return (normalize_short_text(name, 200), normalize_email(addr))


def normalize_telegram_username(value: str) -> str:
    """'Ops_Bot_User' or '@Ops_Bot_User' -> '@ops_bot_user'."""
    u = (value or "").strip().lstrip("@").lower()
    if not re.fullmatch(r"[a-z0-9_]{4,32}", u):
        raise ValueError(f"invalid Telegram username: {value!r}")
    return "@" + u


# ---------------------------------------------------------------------------
# Dates
# ---------------------------------------------------------------------------
_DATE_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M",
    "%d/%m/%Y",
    "%d-%m-%Y %H:%M",
    "%d-%m-%Y",
    "%d %b %Y",
    "%d %B %Y",
)


def _attach_tz(dt: datetime, default_tz: ZoneInfo) -> datetime:
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
        dt = dt.replace(tzinfo=default_tz)
    return dt.astimezone(timezone.utc)


def parse_date(value: Any, default_tz: ZoneInfo = DEFAULT_TZ) -> datetime:
    """
    Parse many date formats into a timezone-aware UTC datetime.
      - datetime objects
      - Unix timestamps in seconds or milliseconds (int/float or numeric string)
      - ISO 8601 ('2026-10-01T09:00:00Z', '2026-10-01T09:00:00+08:00')
      - RFC 2822 email dates ('Wed, 01 Oct 2026 01:00:00 +0000')
      - common local formats ('01/10/2026 09:00', '1 Oct 2026')
    Dates without a timezone are treated as default_tz (Malaysia).
    Day-first is assumed for dd/mm/yyyy (Malaysian convention).
    """
    if value is None or value == "":
        raise ValueError("empty date")
    if isinstance(value, bool):
        raise ValueError("boolean is not a date")
    if isinstance(value, datetime):
        return _attach_tz(value, default_tz)
    if isinstance(value, (int, float)) or (isinstance(value, str) and re.fullmatch(r"\d{9,13}(\.\d+)?", value.strip())):
        ts = float(value)
        # A seconds timestamp doesn't reach 1e10 until the year 2286, so anything
        # above that is milliseconds - this also covers ms timestamps from before
        # ~2001 (e.g. 946684800000 for 2000-01-01), which a 1e12 threshold would
        # misread as seconds and overflow datetime.fromtimestamp on.
        if ts > 1e10:
            ts /= 1000
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    if not isinstance(value, str):
        raise ValueError(f"unsupported date type: {type(value).__name__}")
    s = value.strip()
    try:
        return _attach_tz(datetime.fromisoformat(s.replace("Z", "+00:00")), default_tz)
    except ValueError:
        pass
    try:
        return _attach_tz(parsedate_to_datetime(s), default_tz)
    except (TypeError, ValueError, IndexError):
        pass
    for fmt in _DATE_FORMATS:
        try:
            return _attach_tz(datetime.strptime(s, fmt), default_tz)
        except ValueError:
            continue
    raise ValueError(f"unrecognised date: {value!r}")


# ---------------------------------------------------------------------------
# Numbers, money, booleans
# ---------------------------------------------------------------------------
_CURRENCY = re.compile(r"(?i)rm|myr|usd|sgd|[$€£]")
_TWO_DP = Decimal("0.01")


def parse_number(value: Any) -> Decimal:
    """Parse a number into Decimal. Accepts '12,400.50', '(100)', ' 7 '. Floats go through str() to avoid binary noise."""
    if isinstance(value, bool) or value is None:
        raise ValueError(f"not a number: {value!r}")
    if isinstance(value, Decimal):
        result = value
    elif isinstance(value, int):
        result = Decimal(value)
    elif isinstance(value, float):
        result = Decimal(str(value))
    elif isinstance(value, str):
        s = _CURRENCY.sub("", value).replace(",", "").replace(" ", "").strip()
        negative = s.startswith("(") and s.endswith(")")
        s = s.strip("()")
        try:
            result = Decimal(s)
        except InvalidOperation as exc:
            raise ValueError(f"not a number: {value!r}") from exc
        if negative:
            result = -result
    else:
        raise ValueError(f"not a number: {value!r}")
    if not result.is_finite():
        raise ValueError(f"not a finite number: {value!r}")
    return result


def parse_money(value: Any) -> Decimal:
    """Parse an amount into Decimal with exactly 2 decimal places (half-up). 'RM 12,400' -> Decimal('12400.00')."""
    return parse_number(value).quantize(_TWO_DP, rounding=ROUND_HALF_UP)


_TRUE = {"true", "yes", "y", "1", "ya", "betul", "on"}
_FALSE = {"false", "no", "n", "0", "tidak", "tak", "salah", "off"}


def parse_bool(value: Any) -> bool:
    """Parse booleans, including common Malay words (ya / tidak)."""
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    if isinstance(value, str):
        s = value.strip().lower()
        if s in _TRUE:
            return True
        if s in _FALSE:
            return False
    raise ValueError(f"not a boolean: {value!r}")


# ---------------------------------------------------------------------------
# Field types (used for REST API and JSON file data)
# ---------------------------------------------------------------------------
def coerce_value(value: Any, ftype: FieldType) -> Any:
    """Convert a raw value to the normalized Python type for its FieldType. None stays None."""
    if value is None or (isinstance(value, str) and value.strip() == ""):
        return None
    if ftype is FieldType.STRING:
        if isinstance(value, (dict, list)):
            raise ValueError("expected text, got nested data")
        return normalize_short_text(str(value), 2000)
    if ftype is FieldType.NUMBER:
        n = parse_number(value)
        return int(n) if isinstance(value, int) else n
    if ftype is FieldType.BOOLEAN:
        return parse_bool(value)
    if ftype is FieldType.DATETIME:
        return parse_date(value)
    if ftype is FieldType.JSON:
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("invalid JSON text") from exc
            if isinstance(parsed, (dict, list)):
                return parsed
        raise ValueError("expected an object or list")
    raise ValueError(f"unknown field type: {ftype}")


def coerce_or_warn(name: str, value: Any, ftype: FieldType, warnings: list[str], record_id: str = "") -> Any:
    """Like coerce_value, but a bad value becomes None and a warning is added."""
    try:
        return coerce_value(value, ftype)
    except ValueError as exc:
        where = f"record {record_id}: " if record_id else ""
        warnings.append(f"{where}field '{name}' set to null ({exc})")
        return None


def infer_field_type(values: Iterable[Any]) -> FieldType:
    """
    Guess a FieldType from sample values (used when a JSON file has no field mapping).
    Order: BOOLEAN -> NUMBER -> DATETIME -> JSON -> STRING. Nulls are ignored.
    Strings are never guessed as BOOLEAN or NUMBER on their own, to avoid turning IDs like '007' into numbers.
    """
    samples = [v for v in values if v is not None and v != ""]
    if not samples:
        return FieldType.STRING
    if all(isinstance(v, bool) for v in samples):
        return FieldType.BOOLEAN
    if all(isinstance(v, (int, float, Decimal)) and not isinstance(v, bool) for v in samples):
        return FieldType.NUMBER
    if all(isinstance(v, (dict, list)) for v in samples):
        return FieldType.JSON
    if all(isinstance(v, str) for v in samples):
        def is_date(s: str) -> bool:
            if not re.search(r"\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}", s):
                return False
            try:
                parse_date(s)
                return True
            except ValueError:
                return False
        if all(is_date(v) for v in samples):
            return FieldType.DATETIME
    return FieldType.STRING


__all__ = [
    "DEFAULT_TZ", "sha256_hex",
    "decode_b64url", "decode_b64url_text",
    "html_to_text", "normalize_text", "normalize_short_text",
    "normalize_email", "parse_address", "normalize_telegram_username",
    "parse_date", "parse_number", "parse_money", "parse_bool",
    "coerce_value", "coerce_or_warn", "infer_field_type",
]
