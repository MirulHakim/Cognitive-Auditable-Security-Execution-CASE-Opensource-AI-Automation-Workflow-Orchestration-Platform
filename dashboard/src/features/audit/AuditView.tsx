import React, { useState } from "react";
import { FiArrowLeft, FiAlertTriangle } from "react-icons/fi";
import { HashChainInspector } from "./components/HashChainInspector";
import RecordDetailsCard from "./components/RecordDetailsCard";
import { AuditTrailList } from "./components/AuditTrailList";
import { type AuditRecord } from "./types/audit.types";

// UI-REGION: Audit Detail View — single inspected event record.
// TODO[BACKEND]: Replace this hard-coded mockEvent38 with a data fetch from
// GET /api/audit/events/:id — load it in a useEffect keyed on
// selectedEventId and seed the `record` state below from the JSON response
// (sequence, actor, prev_hash, hash, details) instead of this literal.
// The mock event for the detailed view
const mockEvent38: AuditRecord = {
  id: "EVT-00038",
  sequence: 38,
  timestamp: "2026-10-15T12:30:25.965Z",
  displayTime: "15 Oct 2026, 20:30:25 (MYT)",
  actor: "Mei Ling",
  role: "auditor",
  workspace: "ws_finops_01",
  action: "AUDIT_INTEGRITY_VERIFIED",
  target: "Audit chain",
  source: "Web app",
  outcome: "Success",
  integrity: "Not checked",
  prevHash: "d53039a945e2526135d96fdc092ccbd77727a80ee103d70646f1351e39f0c19b",
  hash: "c7dc2202b9985a41e73d9e50a2d51b83d519faaf98e37ba1c5d8f9591f7429c9",
  details: {
    events_checked: 37,
    algorithm: "SHA-256",
    last_hash:
      "d53039a945e2526135d96fdc092ccbd77727a80ee103d70646f1351e39f0c19b",
  },
};

export const AuditView: React.FC = () => {
  // If null, show the list. If populated, show the detail inspector.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Detail View State
  const [record, setRecord] = useState<AuditRecord>(mockEvent38);
  const [tamperField, setTamperField] = useState("actor");
  const [tamperValue, setTamperValue] = useState("");
  const [tamperNotice, setTamperNotice] = useState<string | null>(null);

  const handleTamperWithoutRehash = () => {
    if (!tamperValue.trim()) return;
    setRecord((prev) => ({
      ...prev,
      [tamperField]: tamperValue,
    }));
    setTamperNotice(
      `Tampered ${tamperField} directly in memory without recomputing SHA-256 hash. The hash chain verification will fail.`,
    );
  };

  const handleTamperAndRehash = () => {
    if (!tamperValue.trim()) return;
    const fakeHash = "e912ab" + Math.random().toString(16).substring(2, 60);
    setRecord((prev) => ({
      ...prev,
      [tamperField]: tamperValue,
      hash: fakeHash,
    }));
    setTamperNotice(
      `Altered ${tamperField} and forged a new record hash. The subsequent record's prev_hash pointer is now broken.`,
    );
  };

  // 1. RENDER MASTER LIST
  if (!selectedEventId) {
    return <AuditTrailList onSelectRecord={(id) => setSelectedEventId(id)} />;
  }

  // 2. RENDER DETAIL INSPECTOR
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-primary animate-in fade-in duration-200">
      {/* Top Breadcrumb & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => setSelectedEventId(null)}
            className="inline-flex items-center gap-1.5 text-xs text-accent-primary hover:text-accent-primary transition-colors font-medium mb-1"
          >
            <FiArrowLeft className="w-3.5 h-3.5" />
            <span>Audit Trail</span>
          </button>
          <h1 className="text-lg font-bold text-primary tracking-wide">
            Event #{record.sequence} · {record.action}
          </h1>
          <p className="text-xs text-muted mt-0.5">{record.displayTime}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/10 text-success border border-success/20">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            {record.outcome}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-hover text-muted border border-strong">
            <span className="w-1.5 h-1.5 rounded-full bg-muted" />
            {record.integrity}
          </span>
        </div>
      </div>

      {/* Main Grid: Left Details & Right Hash Chain Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecordDetailsCard record={record} />
        <HashChainInspector currentRecord={record} />
      </div>

      {/* Bottom: Interactive Tamper Simulation Sandbox */}
      <div className="border border-dashed border-demo/40 bg-demo/10 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FiAlertTriangle className="text-demo w-4 h-4" />
            <h4 className="text-xs font-bold text-demo uppercase tracking-wider">
              Tamper with this record
            </h4>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-demo/10 text-demo border border-demo/20 font-bold">
            DEMO TOOL
          </span>
        </div>

        <p className="text-xs text-muted leading-relaxed max-w-3xl">
          Simulates someone editing the database directly, bypassing AxiomFlow.
          Then recompute the hash or run verify integrity to watch cryptographic
          detection trigger.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={tamperField}
            onChange={(e) => setTamperField(e.target.value)}
            className="bg-background border border-subtle text-xs text-primary rounded-lg px-3 py-1.5 focus:outline-none focus:border-demo/50"
          >
            <option value="actor">actor</option>
            <option value="action">action</option>
            <option value="workspace">workspace</option>
            <option value="target">target</option>
          </select>

          <input
            type="text"
            value={tamperValue}
            onChange={(e) => setTamperValue(e.target.value)}
            placeholder="New value, e.g. Unknown Attacker"
            className="flex-1 min-w-[200px] bg-background border border-subtle rounded-lg px-3 py-1.5 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-demo/50"
          />

          <button
            type="button"
            onClick={handleTamperWithoutRehash}
            className="px-3 py-1.5 rounded-lg border border-demo/30 bg-demo/10 hover:bg-demo/10 text-demo text-xs font-medium transition-colors"
          >
            Edit without re-hashing
          </button>

          <button
            type="button"
            onClick={handleTamperAndRehash}
            className="px-3 py-1.5 rounded-lg border border-demo/30 bg-demo/10 hover:bg-demo/10 text-demo text-xs font-medium transition-colors"
          >
            Edit and re-hash (smarter attacker)
          </button>
        </div>

        {tamperNotice && (
          <div className="p-3 bg-demo/10 border border-demo/30 rounded-lg text-xs text-demo font-mono">
            {tamperNotice}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditView;
