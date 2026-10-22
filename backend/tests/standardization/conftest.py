import pytest

from src.standardization.audit_port import MemoryAuditLogger


@pytest.fixture
def anyio_backend() -> str:
    """Run `pytest.mark.anyio` tests on asyncio only (anyio's plugin, no pytest-asyncio)."""
    return "asyncio"


@pytest.fixture
def memory_audit() -> MemoryAuditLogger:
    return MemoryAuditLogger()
