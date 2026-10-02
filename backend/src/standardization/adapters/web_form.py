"""
CASE — Data Standardization & Normalization Layer
Web form adapter (Step 3)

Location: src/standardization/adapters/web_form.py

Input: a "New request" submitted from the CASE dashboard. The sender identity
comes from the validated JWT (passed in by the Secure API), never from the form body.

Expected form payload:
  {"form_id": "optional", "description": "...", "resource": "Client Orders API", "output": "PDF",
   "metadata": {... optional domain fields, e.g. dorm student_id ...}}
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import ValidationError

from ..schemas import MessageSource, Sender, StandardMessage, VerificationMethod
from ..utils import normalize_email, normalize_short_text, normalize_text, sha256_hex
from .base import StandardizationError


def to_message(form: dict[str, Any], *, workspace_id: str, user_email: str, user_name: Optional[str] = None,
               submitted_at: Optional[datetime] = None) -> StandardMessage:
    """Web form submission + JWT identity -> StandardMessage."""
    if not isinstance(form, dict):
        raise StandardizationError("form payload must be an object", source="WEB_FORM")
    try:
        body, truncated = normalize_text(form.get("description"))
        if len(body) < 10:
            raise StandardizationError("request description must be at least 10 characters", code="VALIDATION_ERROR", source="WEB_FORM")
        meta = dict(form.get("metadata") or {})
        if form.get("resource"):
            meta["requested_resource"] = normalize_short_text(str(form["resource"]), 255)
        if form.get("output"):
            meta["requested_output"] = normalize_short_text(str(form["output"]), 20)
        submitted = submitted_at or datetime.now(timezone.utc)
        source_id = str(form.get("form_id") or "form-" + sha256_hex({"u": user_email, "t": submitted.isoformat(), "d": body})[:16])
        return StandardMessage(
            workspace_id=workspace_id, source=MessageSource.WEB_FORM, source_message_id=source_id,
            sender=Sender(id=normalize_email(user_email), display_name=normalize_short_text(user_name, 200),
                          verified=True, verification_method=VerificationMethod.JWT),
            received_at=submitted, subject=None, body_text=body, body_truncated=truncated,
            metadata=meta, raw_hash=sha256_hex({"form": form, "user_email": user_email}),
        )
    except StandardizationError:
        raise
    except (ValueError, TypeError, ValidationError) as exc:
        msg = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
        raise StandardizationError(f"could not standardize web form: {msg}", source="WEB_FORM") from exc
