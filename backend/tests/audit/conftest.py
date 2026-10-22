from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest

from src.audit.repository import InMemoryAuditRepository
from src.audit.service import AuditService

WS = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b"
WS_OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-8e9f0a1b2c3d"
HASH_A = "a" * 64
HASH_B = "b" * 64


class StepClock:
    """Deterministic clock: each call is 1 ms after the previous one."""

    def __init__(self, start: datetime = datetime(2026, 10, 22, 1, 2, 3, 456789, tzinfo=timezone.utc)) -> None:
        self.now = start

    def __call__(self) -> datetime:
        current = self.now
        self.now += timedelta(milliseconds=1)
        return current


class CountingIds:
    def __init__(self) -> None:
        self.n = 0

    def __call__(self) -> UUID:
        self.n += 1
        return UUID(int=self.n)


@pytest.fixture
def anyio_backend() -> str:
    """Run `pytest.mark.anyio` tests on asyncio only (anyio's plugin, no pytest-asyncio)."""
    return "asyncio"


@pytest.fixture
def repo() -> InMemoryAuditRepository:
    return InMemoryAuditRepository()


@pytest.fixture
def service(repo) -> AuditService:
    return AuditService(repo, clock=StepClock(), new_id=CountingIds())


def event_kwargs(**overrides):
    """A valid log_event call (free-form details action); override any field."""
    kwargs = dict(
        workspace_id=WS, actor="u-123", role="OPERATOR", action="REQUEST_UNSUPPORTED",
        target="execution:job-1", source="WEB_APP", outcome="SUCCESS",
        details={"reason_code": "NO_TEMPLATE"}, execution_id="job-1",
    )
    kwargs.update(overrides)
    return kwargs
