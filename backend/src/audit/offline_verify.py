"""
CASE — Audit & Transparency Layer
Offline check of a JSON export (AUDIT_MODULE_PLAN.md §8.6)

Location: src/audit/offline_verify.py

Needs ONLY this file and canonical.py (Python standard library, no database,
no CASE server). An auditor can copy the two files into an empty folder and run:

    python offline_verify.py audit-export.json

or, inside the backend folder:

    python -m src.audit.offline_verify audit-export.json

Exit code 0 = every check passed, 1 = problems found (they are printed).
"""

# offline_verify.py - Understanding Notes
#
# Why this exists: the export is evidence that leaves the system. Someone who
# does not trust our server must be able to re-check it with their own copy
# of the hashing rules (canonical.py), nothing else.
#
# What it re-checks:
#   events     : each hash recomputes (RECORD_MODIFIED); each event links to the one
#                before it (LINK_BROKEN)
#   full export: also seq 1..head_seq with nothing missing (GAP / TAIL_TRUNCATED),
#                and the last hash = the chain head in the file (HEAD_MISMATCH)
#   provenance : record_hash and lineage_hash recompute; listed events in the file
#                still have their listed hash
#
# What it can NOT prove: that the head in the file is the real head. That is why
# the PDF says "keep this value": compare it with a later export.

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

try:  # inside the CASE backend
    from .canonical import GENESIS_HASH, compute_event_hash, compute_lineage_hash, compute_record_hash
except ImportError:  # copied next to canonical.py, run as a plain script
    from canonical import GENESIS_HASH, compute_event_hash, compute_lineage_hash, compute_record_hash  # type: ignore

EXPORT_FORMAT_VERSION = 1


@dataclass
class OfflineReport:
    events_checked: int = 0
    records_checked: int = 0
    complete_chain: bool = False      # True when the file holds the whole chain (no filters)
    problems: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems


def verify_export(document: Mapping[str, Any]) -> OfflineReport:
    """Re-check a parsed JSON export. Never raises on bad content; it is reported."""
    report = OfflineReport()
    if document.get("export_format_version") != EXPORT_FORMAT_VERSION:
        report.problems.append(f"unknown export_format_version {document.get('export_format_version')!r}")
        return report

    events = sorted(document.get("events", []), key=lambda e: e["seq"])
    head = document["chain_head"]
    report.complete_chain = bool(document["scope"]["complete"])

    # 1. Every event: its own hash, and the link to the event just before it (if that one is in the file).
    previous = None
    for event in events:
        report.events_checked += 1
        if compute_event_hash(event) != event["current_hash"]:
            report.problems.append(f"seq {event['seq']}: RECORD_MODIFIED (hash does not recompute)")
        if previous is not None and previous["seq"] + 1 == event["seq"] \
                and event["previous_hash"] != previous["current_hash"]:
            report.problems.append(f"seq {event['seq']}: LINK_BROKEN (previous_hash != hash of seq {previous['seq']})")
        previous = event

    # 2. Whole-chain export: nothing missing from 1 to the head, and it ends at the head.
    if report.complete_chain:
        expected = 1
        for event in events:
            if event["seq"] != expected:
                report.problems.append(f"seq {expected}: GAP (next event in the file is seq {event['seq']})")
            expected = event["seq"] + 1
        if events and events[0]["seq"] == 1 and events[0]["previous_hash"] != GENESIS_HASH:
            report.problems.append("seq 1: LINK_BROKEN (first event does not start from the genesis hash)")
        last_seq = events[-1]["seq"] if events else 0
        last_hash = events[-1]["current_hash"] if events else GENESIS_HASH
        if last_seq < head["head_seq"]:
            report.problems.append(f"TAIL_TRUNCATED (head says seq {head['head_seq']}, file ends at seq {last_seq})")
        elif last_seq > head["head_seq"]:
            report.problems.append(f"seq {last_seq}: INSERTED_OUTSIDE_LOG_EVENT (after the head seq {head['head_seq']})")
        elif last_hash != head["head_hash"]:
            report.problems.append(f"seq {last_seq}: HEAD_MISMATCH (last hash != head_hash)")

    # 3. Provenance records: both seals recompute, and listed events in the file are unchanged.
    by_id = {event["event_id"]: event for event in events}
    for record in document.get("provenance_records", []):
        report.records_checked += 1
        name = record.get("execution_id")
        if compute_record_hash(record) != record["record_hash"]:
            report.problems.append(f"request {name}: RECORD_HASH_MISMATCH")
        if compute_lineage_hash(record["event_hashes"]) != record["lineage_hash"]:
            report.problems.append(f"request {name}: LINEAGE_HASH_MISMATCH")
        for event_id, listed in zip(record["event_ids"], record["event_hashes"]):
            event = by_id.get(event_id)
            if event is not None and event["current_hash"] != listed:
                report.problems.append(f"request {name}: EVENT_MODIFIED (seq {event['seq']})")
    return report


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python offline_verify.py <audit-export.json>")
        return 2
    with open(argv[1], encoding="utf-8") as f:
        report = verify_export(json.load(f))
    scope = "whole chain" if report.complete_chain else "filtered export (links checked between neighbours only)"
    print(f"Checked {report.events_checked} events and {report.records_checked} provenance records ({scope}).")
    if report.ok:
        print("RESULT: OK - every hash recomputes.")
        return 0
    print(f"RESULT: {len(report.problems)} problem(s):")
    for problem in report.problems:
        print(f"  - {problem}")
    return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv))


__all__ = ["EXPORT_FORMAT_VERSION", "OfflineReport", "verify_export", "main"]
