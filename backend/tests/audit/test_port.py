import inspect

import pytest

import src.audit as audit_pkg
import src.audit.port as port
import src.standardization.audit_port as old_port

pytestmark = pytest.mark.anyio


def test_old_standardization_import_path_gives_the_same_classes():
    for name in ("AuditLogger", "NullAuditLogger", "MemoryAuditLogger"):
        assert getattr(old_port, name) is getattr(port, name)


def test_port_names_exported_from_the_audit_package():
    assert audit_pkg.AuditLogger is port.AuditLogger
    assert audit_pkg.MemoryAuditLogger is port.MemoryAuditLogger
    assert audit_pkg.NullAuditLogger is port.NullAuditLogger


def test_port_has_no_imports_from_the_rest_of_the_audit_module():
    # It is the public contract: depending on it must not pull in Audit's internals.
    source = inspect.getsource(port)
    assert "from ." not in source
    assert "src.audit" not in source.replace("Location: src/audit/port.py", "")


async def test_null_logger_accepts_a_call_and_does_nothing():
    assert await port.NullAuditLogger().log_event(action="ANY") is None


async def test_memory_logger_records_calls():
    logger = port.MemoryAuditLogger()
    await logger.log_event(action="JOB_RECEIVED", outcome="SUCCESS")
    assert logger.events == [{"action": "JOB_RECEIVED", "outcome": "SUCCESS"}]
