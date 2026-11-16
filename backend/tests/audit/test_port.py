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
    assert audit_pkg.ProvenanceSealer is port.ProvenanceSealer


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


async def test_null_logger_seal_does_nothing():
    assert await port.NullAuditLogger().seal_provenance("ws-1", "exec-1") is None


async def test_memory_logger_records_seal_calls():
    logger = port.MemoryAuditLogger()
    await logger.seal_provenance("ws-1", "exec-1")
    await logger.seal_provenance("ws-1", "exec-2")
    assert logger.sealed == [("ws-1", "exec-1"), ("ws-1", "exec-2")]
    assert logger.events == []      # sealing is not logging


def test_audit_service_matches_the_sealer_contract():
    # The app passes AuditService wherever a ProvenanceSealer is expected, so the
    # method names and parameters must stay the same as in port.py.
    contract = inspect.signature(port.ProvenanceSealer.seal_provenance)
    real = inspect.signature(audit_pkg.AuditService.seal_provenance)
    assert list(real.parameters) == list(contract.parameters)
    assert inspect.iscoroutinefunction(audit_pkg.AuditService.seal_provenance)
