"""
CASE — Audit & Transparency Layer
JSON and PDF export (AUDIT_MODULE_PLAN.md §8.6)

Location: src/audit/export.py

create_export() does, in order:
  1. read the chain head FIRST (the file only contains events up to it)
  2. read the events (filtered), their provenance records, the latest verification
  3. build the file: JSON (machine-checkable) or PDF (for people)
  4. file_hash = SHA-256 of the exact bytes
  5. AuditService.record_export: audit_exports row + AUDIT_EXPORTED, one transaction
  6. only then return the file (fail-closed: no log, no file)

The AUDIT_EXPORTED event is logged after the file is built, so it is never
inside the file it describes; it shows up in the NEXT export.
"""

# export.py - Understanding Notes
#
# JSON = evidence for machines. Holds everything offline_verify.py needs:
#   events (all fields), provenance records, the chain head, the hashing rules.
#   Values are written with canonical.normalize, the SAME rules used for hashing,
#   so the hashes recompute from the file alone.
#
# PDF = evidence for people. Page 1 has the "chain head box":
#   "Chain head at export: seq N ... Keep this value."
#   If someone later edits the database and re-hashes everything, the new head
#   hash for seq N will differ from the one printed on this old PDF.
#
# file_hash (stored in audit_exports) = proof of WHICH file was handed out.

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional, Sequence
from uuid import UUID
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from .canonical import (GENESIS_HASH, HASH_FIELDS, HASH_VERSION, RECORD_HASH_FIELDS, format_timestamp,
                        normalize)
from .errors import AuditValidationError
from .offline_verify import EXPORT_FORMAT_VERSION
from .queries import integrity_of, summarize
from .schemas import (ActorRoleEnum, AuditEvent, ChainVerificationResult, EventFilter, ExecutionIntegrityEnum,
                      ExportFormatEnum, ExportRecord, ExportRequest, ProvenanceRecord)
from .service import AuditService

# A bigger export must be narrowed with filters (keeps memory and PDF size sane).
MAX_EXPORT_EVENTS = 50_000

_MEDIA_TYPES = {ExportFormatEnum.JSON: "application/json", ExportFormatEnum.PDF: "application/pdf"}


@dataclass(frozen=True)
class Exporter:
    """Who asks for the export (from auth: CurrentUser has these three fields)."""
    user_id: str
    role: ActorRoleEnum
    workspace_id: UUID


@dataclass(frozen=True)
class ExportFile:
    content: bytes
    media_type: str
    filename: str
    record: ExportRecord


@dataclass(frozen=True)
class _Snapshot:
    """Everything that goes into one export, read once."""
    export_id: UUID
    exported_at: datetime
    exporter: Exporter
    filters: dict[str, Any]
    head_seq: int
    head_hash: str
    head_updated_at: Optional[datetime]
    events: Sequence[AuditEvent]
    records: Sequence[ProvenanceRecord]
    latest_verification: Optional[ChainVerificationResult]

    @property
    def complete(self) -> bool:
        return not self.filters


async def create_export(service: AuditService, exporter: Exporter, request: ExportRequest, *,
                        source: str = "WEB_APP") -> ExportFile:
    snapshot = await _read_snapshot(service, exporter, request)
    content = build_json(snapshot) if request.format is ExportFormatEnum.JSON else build_pdf(snapshot)
    record = ExportRecord(
        export_id=snapshot.export_id, workspace_id=exporter.workspace_id, exported_by=exporter.user_id,
        exported_role=exporter.role, exported_at=snapshot.exported_at, format=request.format,
        filters=snapshot.filters, record_count=len(snapshot.events), head_seq=snapshot.head_seq,
        head_hash=snapshot.head_hash, file_hash=hashlib.sha256(content).hexdigest())
    await service.record_export(record, source=source)  # raises -> the caller gets no file
    return ExportFile(content=content, media_type=_MEDIA_TYPES[request.format],
                      filename=f"case-audit-{snapshot.export_id}.{request.format.value.lower()}", record=record)


async def _read_snapshot(service: AuditService, exporter: Exporter, request: ExportRequest) -> _Snapshot:
    repository = service.repository
    workspace_id = exporter.workspace_id

    # 1. Head first: events logged while we read are left out, so the file matches its head.
    head = await repository.get_head(workspace_id)
    head_seq, head_hash = (head.last_seq, head.last_hash) if head else (0, GENESIS_HASH)

    # 2. Events (oldest first), their requests' provenance records, the latest verification.
    filters = EventFilter(execution_id=request.execution_id, date_from=request.date_from, date_to=request.date_to)
    events, total = await repository.query_events(workspace_id, filters, limit=MAX_EXPORT_EVENTS,
                                                  to_seq=head_seq, newest_first=False)
    if total > MAX_EXPORT_EVENTS:
        raise AuditValidationError(f"{total} events match; the limit for one export is {MAX_EXPORT_EVENTS}. "
                                   "Narrow it with execution_id or a date range.", code="EXPORT_TOO_LARGE")
    execution_ids = list(dict.fromkeys(e.execution_id for e in events if e.execution_id is not None))
    records = [r for r in [await repository.get_provenance(workspace_id, x) for x in execution_ids] if r]
    latest = await repository.list_verifications(workspace_id, limit=1)

    return _Snapshot(
        export_id=service.new_id(), exported_at=service.now(), exporter=exporter,
        filters=normalize(request.model_dump(exclude={"format"}, exclude_none=True)),
        head_seq=head_seq, head_hash=head_hash, head_updated_at=head.updated_at if head else None,
        events=events, records=records, latest_verification=latest[0] if latest else None)


# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

def build_json(s: _Snapshot) -> bytes:
    document = {
        "export_format_version": EXPORT_FORMAT_VERSION,
        "export_id": s.export_id,
        "workspace_id": s.exporter.workspace_id,
        "exported_at": s.exported_at,
        "exported_by": s.exporter.user_id,
        "exported_role": s.exporter.role,
        "scope": {"complete": s.complete, "filters": s.filters},
        "chain_head": {"head_seq": s.head_seq, "head_hash": s.head_hash, "updated_at": s.head_updated_at},
        "hashing": {
            "algorithm": "SHA-256 over canonical JSON (AUDIT_MODULE_PLAN.md §5.2); see canonical.py",
            "hash_version": HASH_VERSION,
            "hash_fields": list(HASH_FIELDS),
            "record_hash_fields": list(RECORD_HASH_FIELDS),
            "genesis_hash": GENESIS_HASH,
        },
        "latest_verification": s.latest_verification.model_dump() if s.latest_verification else None,
        "events": [e.model_dump() for e in s.events],
        "provenance_records": [r.model_dump() for r in s.records],
    }
    # normalize = the hashing rules, so every value in the file hashes exactly as stored.
    return json.dumps(normalize(document), indent=2, ensure_ascii=False).encode("utf-8")


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------

def _time(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M:%S UTC")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": base["Title"],
        "h2": base["Heading2"],
        "body": base["BodyText"],
        "small": ParagraphStyle("small", parent=base["BodyText"], fontSize=8, leading=10),
        "mono": ParagraphStyle("mono", parent=base["BodyText"], fontName="Courier", fontSize=8.5, leading=11),
        "box": ParagraphStyle("box", parent=base["BodyText"], fontName="Helvetica-Bold", fontSize=11, leading=14),
    }


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text), style)  # escape: ids come from callers and must not be read as markup


def head_box_lines(s: _Snapshot) -> list[str]:
    """The text of the box on page 1 (§8.6), one line each."""
    return [
        f"Chain head at export: seq {s.head_seq} · {_time(s.exported_at)}",
        s.head_hash,
        f"Keep this value. If a later export shows a different hash for seq {s.head_seq}, "
        "the records were altered.",
    ]


def _integrity_lines(s: _Snapshot) -> list[str]:
    v = s.latest_verification
    if v is None:
        return ["No chain verification has been run in this workspace yet (run Verify before exporting)."]
    scope = f"seq {v.from_seq} to {v.to_seq if v.to_seq is not None else 'end'}"
    lines = [f"Latest chain verification: {v.status.value} at {_time(v.verified_at)} "
             f"by {v.verified_by} ({v.verified_role.value}), {scope}, {v.events_checked} events checked."]
    if not v.is_verified:
        lines.append(f"Broken at seq {v.broken_at_seq}: {v.reason.value}; "
                     f"{v.unverifiable_after} later record(s) could not be checked.")
    lines.append(f"Head at that time: seq {v.head_seq}; last record found: seq {v.last_found_seq}.")
    # +1: the verification's own log event (AUDIT_INTEGRITY_VERIFIED / _FAILED) comes right after it.
    if s.head_seq > v.head_seq + 1:
        lines.append(f"Note: {s.head_seq - v.head_seq - 1} event(s) were added after that verification "
                     "and are not covered by it.")
    return lines


_LINEAGE_LABELS = {
    ExecutionIntegrityEnum.NOT_VERIFIED: "not run",
    ExecutionIntegrityEnum.LINEAGE_VALID: "VALID",
    ExecutionIntegrityEnum.LINEAGE_INVALID: "INVALID",
}


def _lineage_label(s: _Snapshot, record: ProvenanceRecord) -> str:
    """Result of the last verify-lineage run on this request that is inside the export."""
    events = tuple(e for e in s.events if e.execution_id == record.execution_id)
    status, checked = integrity_of(events, record)
    label = _LINEAGE_LABELS.get(status, status.value)
    return f"{label} ({_time(checked.event_timestamp)})" if checked else label


def build_story(s: _Snapshot) -> list[Any]:
    """The PDF content, in order. Page 1: title, the chain head box, integrity status."""
    st = _styles()
    width = A4[0] - 30 * mm
    scope = ("whole workspace" if s.complete
             else "filtered: " + ", ".join(f"{k}={v}" for k, v in sorted(s.filters.items())))
    story: list[Any] = [
        _p("CASE Audit Export", st["title"]),
        _p(f"Workspace {s.exporter.workspace_id} · exported by {s.exporter.user_id} "
           f"({s.exporter.role.value}) · export {s.export_id}", st["small"]),
        _p(f"Scope: {scope} · {len(s.events)} events · {len(s.records)} sealed requests", st["small"]),
        Spacer(1, 6 * mm),
    ]

    first, hash_line, keep = head_box_lines(s)
    box = Table([[_p(first, st["box"])], [_p(hash_line, st["mono"])], [_p(keep, st["body"])]], colWidths=[width])
    box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 1.5, colors.black),
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F2F2F2")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    story += [box, Spacer(1, 6 * mm), _p("Integrity status", st["h2"])]
    story += [_p(line, st["body"]) for line in _integrity_lines(s)]

    # Request summaries: Objective -> Decision -> Approval -> Result.
    story += [Spacer(1, 4 * mm), _p("Requests (Objective → Decision → Approval → Result)", st["h2"])]
    if s.records:
        rows = [[_p(h, st["small"]) for h in ("Request", "Objective", "Decision", "Approvals",
                                              "Lineage check", "Result")]]
        for r in s.records:
            line = summarize(r)
            rows.append([_p(r.execution_id, st["small"]), _p(line.objective, st["small"]),
                         _p(line.decision, st["small"]), _p("; ".join(line.approvals) or "none", st["small"]),
                         _p(_lineage_label(s, r), st["small"]), _p(line.result, st["small"])])
        story.append(_table(rows, [0.1, 0.19, 0.24, 0.19, 0.13, 0.15], width))
    else:
        story.append(_p("No sealed requests in this export.", st["body"]))

    # The event table.
    story += [Spacer(1, 4 * mm), _p("Events", st["h2"])]
    if s.events:
        cell = ParagraphStyle("cell", parent=st["small"], fontSize=7, leading=8.5)
        rows = [["Seq", "Time (UTC)", "Action", "Actor (role)", "Outcome", "Hash (first 16)"]]
        # Action and actor are Paragraphs so long values wrap instead of running into the next column.
        rows += [[str(e.seq), e.event_timestamp.strftime("%Y-%m-%d %H:%M:%S"), _p(e.action, cell),
                  _p(f"{e.actor_id} ({e.actor_role.value})", cell), e.outcome.value, e.current_hash[:16]]
                 for e in s.events]
        story.append(_table(rows, [0.05, 0.16, 0.37, 0.18, 0.1, 0.14], width, font_size=7))
    else:
        story.append(_p("No events in this export.", st["body"]))
    return story


def _table(rows: list[list[Any]], fractions: list[float], width: float, *, font_size: float = 8) -> Table:
    table = Table(rows, colWidths=[f * width for f in fractions], repeatRows=1)
    table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), font_size),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#DDDDDD")),
        ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def build_pdf(s: _Snapshot) -> bytes:
    buffer = io.BytesIO()

    def footer(canvas, doc) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 7)
        canvas.drawString(15 * mm, 8 * mm, f"CASE audit export {s.export_id} · head seq {s.head_seq} "
                                           f"· page {doc.page}")
        canvas.restoreState()

    # invariant=1: no random document id / creation time, so the same data gives the same bytes.
    doc = SimpleDocTemplate(buffer, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm, invariant=1,
                            title=f"CASE audit export {s.export_id}", author="CASE Audit & Transparency")
    doc.build(build_story(s), onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()


__all__ = ["MAX_EXPORT_EVENTS", "Exporter", "ExportFile", "create_export", "build_json", "build_pdf",
           "build_story", "head_box_lines"]
