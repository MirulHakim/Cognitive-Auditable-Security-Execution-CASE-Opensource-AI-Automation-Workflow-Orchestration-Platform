"""
CASE — Audit & Transparency Layer
Errors

Location: src/audit/errors.py
"""
#when other module send wrong event to audit, this error will be raised to tell the caller to fix their input.

from __future__ import annotations

class AuditValidationError(ValueError):
    """The caller passed an event Audit will not record (bad action, target,
    details, ...). Kept apart from storage failures so callers using the §8.2
    logging patterns can tell "fix your input" from "audit is unavailable".
    Messages name fields and paths, never values."""

    def __init__(self, message: str, code: str) -> None:
        super().__init__(message)
        self.code = code


__all__ = ["AuditValidationError"]
