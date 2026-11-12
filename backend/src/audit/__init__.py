"""
CASE — Audit & Transparency Layer

Records what every module did as an append-only, SHA-256 hash-chained log.
See docs/audit/AUDIT_MODULE_PLAN.md.
"""

from .catalogue import AuditAction
from .errors import AuditValidationError, ProvenanceError
from .port import AuditLogger, MemoryAuditLogger, NullAuditLogger
from .repository import AuditRepository, ChainHead, InMemoryAuditRepository, PostgresAuditRepository
from .schemas import (AuditEvent, ChainBreakReasonEnum, ChainVerificationResult, LineageProblemEnum,
                      LineageStatusEnum, LineageVerificationResult, ProvenanceRecord, TemplateChoiceEnum,
                      VerificationStatusEnum)
from .service import AuditService
from .verifier import verify_chain, verify_lineage

__all__ = [
    "AuditAction",
    "AuditEvent",
    "ChainBreakReasonEnum",
    "ChainVerificationResult",
    "VerificationStatusEnum",
    "verify_chain",
    "LineageProblemEnum",
    "LineageStatusEnum",
    "LineageVerificationResult",
    "ProvenanceError",
    "ProvenanceRecord",
    "TemplateChoiceEnum",
    "verify_lineage",
    "AuditLogger",
    "AuditRepository",
    "AuditService",
    "AuditValidationError",
    "ChainHead",
    "InMemoryAuditRepository",
    "MemoryAuditLogger",
    "NullAuditLogger",
    "PostgresAuditRepository",
]
