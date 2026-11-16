"""
Exports (Phase 5, AUDIT_MODULE_PLAN.md §8.6, §10 "Exports").

- JSON contains the chain head and re-verifies offline with canonical.py alone
- tampering with the file is caught offline
- PDF has the chain head box on page 1
- every export writes an audit_exports row and logs AUDIT_EXPORTED (fail-closed)
"""

import base64
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zlib
from pathlib import Path
from uuid import UUID

import pytest

from src.audit import export as export_module
from src.audit.canonical import GENESIS_HASH, compute_event_hash
from src.audit.errors import AuditValidationError
from src.audit.export import Exporter, build_story, create_export, head_box_lines
from src.audit.offline_verify import verify_export
from src.audit.schemas import ActorRoleEnum, ExportFormatEnum, ExportRequest
from tests.audit.api_client import api_client, as_role
from tests.audit.conftest import WS
from tests.audit.scenarios import scenario_a, scenario_b, scenario_c, scenario_g

pytestmark = pytest.mark.anyio

AUDIT_SRC = Path(__file__).resolve().parents[2] / "src" / "audit"
AUDITOR = Exporter(user_id="u-aud-1", role=ActorRoleEnum.AUDITOR, workspace_id=UUID(WS))


@pytest.fixture(autouse=True)
def mock_auth(monkeypatch):
    monkeypatch.setenv("AUTH_MODE", "mock")


async def two_requests(service):
    """job-a sealed and lineage-checked, job-b sealed, then a chain verification."""
    await scenario_a(service)
    await service.seal_provenance(WS, "job-a")
    await scenario_b(service)
    await service.seal_provenance(WS, "job-b")
    await service.verify_chain(WS, actor="u-aud-1", role="AUDITOR")


async def json_export(service, **filters):
    file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.JSON, **filters))
    return file, json.loads(file.content)


def stored(repo):
    return repo._events[UUID(WS)]


def pdf_pages(content: bytes) -> list[bytes]:
    """The decompressed drawing instructions of a reportlab PDF, one entry per
    stream (ASCII85 + Flate, reportlab's default), so the tests can search the text."""
    pages = []
    for raw in re.findall(rb"stream\r?\n(.*?)endstream", content, re.S):
        data = raw.strip()
        if data.endswith(b"~>"):
            data = base64.a85decode(data[:-2], adobe=False)   # strip the "~>" end marker
        try:
            pages.append(zlib.decompress(data))
        except zlib.error:
            pages.append(data)
    return pages


def pdf_text(content: bytes) -> bytes:
    return b"\n".join(pdf_pages(content))


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

class TestJsonExport:
    async def test_contains_the_head_and_everything_up_to_it(self, service, repo):
        await two_requests(service)
        head = await repo.get_head(UUID(WS))
        file, doc = await json_export(service)
        assert doc["chain_head"]["head_seq"] == head.last_seq
        assert doc["chain_head"]["head_hash"] == head.last_hash
        assert [e["seq"] for e in doc["events"]] == list(range(1, head.last_seq + 1))
        assert {r["execution_id"] for r in doc["provenance_records"]} == {"job-a", "job-b"}
        assert doc["latest_verification"]["status"] == "VERIFIED"
        assert doc["scope"] == {"complete": True, "filters": {}}
        assert doc["exported_by"] == "u-aud-1" and doc["exported_role"] == "AUDITOR"
        assert file.record.record_count == len(doc["events"])

    async def test_re_verifies_offline(self, service):
        await two_requests(service)
        _, doc = await json_export(service)
        report = verify_export(doc)
        assert report.ok, report.problems
        assert report.complete_chain and report.events_checked == len(doc["events"])
        assert report.records_checked == 2

    async def test_re_verifies_with_canonical_py_alone(self, service, tmp_path):
        """Copy ONLY canonical.py + offline_verify.py to an empty folder and run them there.
        -E -s: ignore PYTHONPATH and user site-packages, so nothing from the CASE backend
        can be imported; only the folder itself (where canonical.py now is) is on the path."""
        await two_requests(service)
        file, _ = await json_export(service)
        work = tmp_path / "auditor"
        work.mkdir()
        for name in ("canonical.py", "offline_verify.py"):
            shutil.copy(AUDIT_SRC / name, work / name)
        (work / "export.json").write_bytes(file.content)
        run = subprocess.run([sys.executable, "-E", "-s", "offline_verify.py", "export.json"], cwd=work,
                             capture_output=True, text=True)
        assert run.returncode == 0, run.stdout + run.stderr
        assert "RESULT: OK" in run.stdout

        doc = json.loads(file.content)
        doc["events"][2]["details"]["forged"] = True
        (work / "export.json").write_text(json.dumps(doc), encoding="utf-8")
        run = subprocess.run([sys.executable, "-E", "-s", "offline_verify.py", "export.json"], cwd=work,
                             capture_output=True, text=True)
        assert run.returncode == 1 and "seq 3: RECORD_MODIFIED" in run.stdout

    async def test_file_hash_and_headers(self, service, repo):
        await two_requests(service)
        async with api_client(service) as client:
            r = await client.post("/api/v1/audit/export", json={"format": "JSON"}, headers=as_role("AUDITOR"))
        assert r.status_code == 200
        assert r.headers["content-type"] == "application/json"
        digest = hashlib.sha256(r.content).hexdigest()
        [record] = repo._exports[UUID(WS)]
        assert r.headers["x-file-sha256"] == digest == record.file_hash
        assert r.headers["x-export-id"] == str(record.export_id)
        assert r.headers["content-disposition"] == f'attachment; filename="case-audit-{record.export_id}.json"'
        assert int(r.headers["x-chain-head-seq"]) == json.loads(r.content)["chain_head"]["head_seq"]

    async def test_filtered_by_request(self, service):
        await two_requests(service)
        file, doc = await json_export(service, execution_id="job-b")
        assert {e["execution_id"] for e in doc["events"]} == {"job-b"}
        assert [r["execution_id"] for r in doc["provenance_records"]] == ["job-b"]
        assert doc["scope"] == {"complete": False, "filters": {"execution_id": "job-b"}}
        assert file.record.filters == {"execution_id": "job-b"}
        report = verify_export(doc)
        assert report.ok and not report.complete_chain

    async def test_filtered_by_date(self, service):
        req = await scenario_a(service)
        since = req.events[5].event_timestamp
        file, doc = await json_export(service, date_from=since)
        assert doc["events"][0]["seq"] == 6
        assert file.record.filters == {"date_from": doc["scope"]["filters"]["date_from"]}
        assert verify_export(doc).ok

    async def test_empty_workspace(self, service):
        file, doc = await json_export(service)
        assert doc["chain_head"] == {"head_seq": 0, "head_hash": GENESIS_HASH, "updated_at": None}
        assert doc["events"] == [] and doc["latest_verification"] is None
        assert verify_export(doc).ok
        assert file.record.head_seq == 0

    async def test_too_large(self, service, monkeypatch):
        await scenario_b(service)
        monkeypatch.setattr(export_module, "MAX_EXPORT_EVENTS", 3)
        with pytest.raises(AuditValidationError) as err:
            await json_export(service)
        assert err.value.code == "EXPORT_TOO_LARGE"

    async def test_too_large_via_api(self, service, monkeypatch):
        await scenario_b(service)
        monkeypatch.setattr(export_module, "MAX_EXPORT_EVENTS", 3)
        async with api_client(service) as client:
            r = await client.post("/api/v1/audit/export", json={"format": "PDF"}, headers=as_role("AUDITOR"))
        assert r.status_code == 400 and r.json()["error"]["code"] == "EXPORT_TOO_LARGE"


# ---------------------------------------------------------------------------
# Offline tamper detection (the file was changed after export)
# ---------------------------------------------------------------------------

class TestOfflineTamperDetection:
    @pytest.fixture
    async def doc(self, service):
        await two_requests(service)
        return (await json_export(service))[1]

    @staticmethod
    def problems(doc):
        return verify_export(doc).problems

    async def test_edit_without_rehash(self, doc):
        doc["events"][4]["actor_id"] = "someone-else"
        assert self.problems(doc) == ["seq 5: RECORD_MODIFIED (hash does not recompute)"]

    async def test_edit_and_rehash_breaks_the_next_link(self, doc):
        event = doc["events"][4]
        event["actor_id"] = "someone-else"
        event["current_hash"] = compute_event_hash(event)
        problems = self.problems(doc)
        assert "seq 6: LINK_BROKEN (previous_hash != hash of seq 5)" in problems
        assert "request job-a: EVENT_MODIFIED (seq 5)" in problems

    async def test_delete_middle(self, doc):
        del doc["events"][3]
        assert "seq 4: GAP (next event in the file is seq 5)" in self.problems(doc)

    async def test_delete_last(self, doc):
        last = doc["events"].pop()
        assert f"TAIL_TRUNCATED (head says seq {last['seq']}, file ends at seq {last['seq'] - 1})" \
            in self.problems(doc)

    async def test_extra_event_after_head(self, doc):
        extra = copy.deepcopy(doc["events"][-1])
        extra["seq"] += 1
        extra["previous_hash"] = doc["events"][-1]["current_hash"]
        extra["current_hash"] = compute_event_hash(extra)
        doc["events"].append(extra)
        assert any("INSERTED_OUTSIDE_LOG_EVENT" in p for p in self.problems(doc))

    async def test_head_changed(self, doc):
        doc["chain_head"]["head_hash"] = "f" * 64
        assert any("HEAD_MISMATCH" in p for p in self.problems(doc))

    async def test_provenance_field_changed(self, doc):
        doc["provenance_records"][0]["result"]["final_status"] = "FAILED"
        assert self.problems(doc) == ["request job-a: RECORD_HASH_MISMATCH"]

    async def test_lineage_list_changed(self, doc):
        doc["provenance_records"][0]["event_hashes"][0] = "e" * 64
        problems = self.problems(doc)
        assert "request job-a: RECORD_HASH_MISMATCH" in problems
        assert "request job-a: LINEAGE_HASH_MISMATCH" in problems

    async def test_unknown_format_version(self, doc):
        doc["export_format_version"] = 99
        assert self.problems(doc) == ["unknown export_format_version 99"]


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

class TestPdfExport:
    async def test_pdf_with_the_head_box_on_page_1(self, service, repo):
        await two_requests(service)
        await scenario_c(service)
        head = await repo.get_head(UUID(WS))
        file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        assert file.content.startswith(b"%PDF") and file.media_type == "application/pdf"
        assert file.record.head_seq == head.last_seq and file.record.head_hash == head.last_hash
        pages = pdf_pages(file.content)
        assert len(pages) >= 2                     # long enough to prove "page 1" means something
        assert f"Chain head at export: seq {head.last_seq}".encode() in pages[0]
        assert head.last_hash.encode() in pages[0]
        assert b"Keep this value." in pages[0]
        assert head.last_hash.encode() not in b"".join(pages[1:])

    async def test_box_comes_first_and_says_keep_this_value(self, service, repo):
        await two_requests(service)
        snapshot = await export_module._read_snapshot(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        first, hash_line, keep = head_box_lines(snapshot)
        head = await repo.get_head(UUID(WS))
        assert first.startswith(f"Chain head at export: seq {head.last_seq} · ")
        assert hash_line == head.last_hash
        assert keep == (f"Keep this value. If a later export shows a different hash for seq {head.last_seq}, "
                        "the records were altered.")
        story = build_story(snapshot)
        kinds = [type(f).__name__ for f in story]
        assert kinds.index("Table") == 4   # title, 2 info lines, spacer, then the box

    async def test_pdf_without_verification_or_records(self, service):
        await scenario_b(service)
        file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        text = pdf_text(file.content)
        assert b"No chain verification has been run" in text
        assert b"No sealed requests in this export." in text

    async def test_pdf_notes_broken_chain_and_events_after_verification(self, service, repo):
        await scenario_a(service)
        stored(repo)[3] = stored(repo)[3].model_copy(update={"details": {"forged": True}})
        await service.verify_chain(WS, actor="u-aud-1", role="AUDITOR")
        await scenario_b(service)
        file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        text = pdf_text(file.content)
        assert b"Broken at seq 4: RECORD_MODIFIED" in text
        assert b"were added after that verification" in text

    async def test_requests_table_shows_the_lineage_check(self, service):
        """A request whose lineage FAILED must not look fine in the PDF (scenario G = gate skipped)."""
        for play, job in [(scenario_a, "job-a"), (scenario_g, "job-g"), (scenario_b, "job-b")]:
            await play(service, execution_id=job)
            await service.seal_provenance(WS, job)
        await service.verify_lineage(WS, "job-a", actor="u-aud-1", role="AUDITOR")
        await service.verify_lineage(WS, "job-g", actor="u-aud-1", role="AUDITOR")
        file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        text = pdf_text(file.content)
        assert b"Lineage check" in text
        # Each label starts a PDF text string "(VALID ..." (the date may wrap to the next line).
        assert b"(VALID" in text and b"(INVALID" in text and b"(not run)" in text

    async def test_markup_in_ids_is_escaped(self, service):
        await service.log_event(workspace_id=WS, actor="<b>x</b>", role="OPERATOR", action="REQUEST_UNSUPPORTED",
                                target="execution:j1", source="WEB_APP", outcome="SUCCESS",
                                details={"reason_code": "X"}, execution_id="j1")
        file = await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.PDF))
        assert file.content.startswith(b"%PDF")

    async def test_pdf_via_api(self, service):
        await two_requests(service)
        async with api_client(service) as client:
            r = await client.post("/api/v1/audit/export", json={"format": "PDF"}, headers=as_role("AUDITOR"))
        assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
        assert r.headers["x-file-sha256"] == hashlib.sha256(r.content).hexdigest()


# ---------------------------------------------------------------------------
# audit_exports row + AUDIT_EXPORTED
# ---------------------------------------------------------------------------

class TestExportIsLogged:
    async def test_row_and_event(self, service, repo):
        await two_requests(service)
        file, doc = await json_export(service)
        [record] = await repo.list_exports(UUID(WS))
        assert record == file.record
        assert (record.exported_by, record.exported_role, record.format) == \
            ("u-aud-1", ActorRoleEnum.AUDITOR, ExportFormatEnum.JSON)
        logged = stored(repo)[-1]
        assert logged.action == "AUDIT_EXPORTED" and logged.event_type.value == "INTEGRITY_EVENT"
        assert logged.seq == record.head_seq + 1          # logged after the file: never inside it
        assert logged.details == {"export_id": str(record.export_id), "format": "JSON",
                                  "record_count": len(doc["events"]), "head_seq": record.head_seq,
                                  "head_hash": record.head_hash, "file_hash": record.file_hash}
        assert logged.execution_id is None

    async def test_filtered_export_event_names_the_request(self, service, repo):
        await two_requests(service)
        await json_export(service, execution_id="job-a")
        assert stored(repo)[-1].execution_id == "job-a"

    async def test_next_export_contains_the_previous_one(self, service):
        await two_requests(service)
        await json_export(service)
        _, doc = await json_export(service)
        assert doc["events"][-1]["action"] == "AUDIT_EXPORTED"
        assert verify_export(doc).ok

    async def test_fail_closed_when_the_log_fails(self, service, repo, monkeypatch):
        await scenario_b(service)
        before = len(stored(repo))

        async def broken(*_, **__):
            raise ConnectionError("database down")
        monkeypatch.setattr(repo, "save_export", broken)
        with pytest.raises(ConnectionError):
            await json_export(service)
        assert len(stored(repo)) == before   # no AUDIT_EXPORTED, and no file was returned

    async def test_bad_source_rejected(self, service):
        with pytest.raises(AuditValidationError):
            await create_export(service, AUDITOR, ExportRequest(format=ExportFormatEnum.JSON), source="FAX")
