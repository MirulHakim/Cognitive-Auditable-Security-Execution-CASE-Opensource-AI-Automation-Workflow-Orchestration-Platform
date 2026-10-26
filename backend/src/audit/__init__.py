"""
CASE — Audit & Transparency Layer

Records what every module did as an append-only, SHA-256 hash-chained log.
See docs/audit/AUDIT_MODULE_PLAN.md.
"""

from .catalogue import AuditAction
from .errors import AuditValidationError
from .port import AuditLogger, MemoryAuditLogger, NullAuditLogger
from .repository import AuditRepository, ChainHead, InMemoryAuditRepository
from .schemas import AuditEvent, ChainBreakReasonEnum, ChainVerificationResult, VerificationStatusEnum
from .service import AuditService
from .verifier import verify_chain

__all__ = [
    "AuditAction",
    "AuditEvent",
    "ChainBreakReasonEnum",
    "ChainVerificationResult",
    "VerificationStatusEnum",
    "verify_chain",
    "AuditLogger",
    "AuditRepository",
    "AuditService",
    "AuditValidationError",
    "ChainHead",
    "InMemoryAuditRepository",
    "MemoryAuditLogger",
    "NullAuditLogger",
]
