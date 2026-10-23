"""
CASE — Audit & Transparency Layer

Records what every module did as an append-only, SHA-256 hash-chained log.
See docs/audit/AUDIT_MODULE_PLAN.md.
"""

from .catalogue import AuditAction
from .errors import AuditValidationError
from .port import AuditLogger, MemoryAuditLogger, NullAuditLogger
from .repository import AuditRepository, ChainHead, InMemoryAuditRepository
from .schemas import AuditEvent
from .service import AuditService

__all__ = [
    "AuditAction",
    "AuditEvent",
    "AuditLogger",
    "AuditRepository",
    "AuditService",
    "AuditValidationError",
    "ChainHead",
    "InMemoryAuditRepository",
    "MemoryAuditLogger",
    "NullAuditLogger",
]
