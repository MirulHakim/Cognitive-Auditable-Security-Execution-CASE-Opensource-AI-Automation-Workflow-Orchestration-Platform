import pytest

from src.standardization.audit_port import MemoryAuditLogger


@pytest.fixture
def memory_audit() -> MemoryAuditLogger:
    return MemoryAuditLogger()
