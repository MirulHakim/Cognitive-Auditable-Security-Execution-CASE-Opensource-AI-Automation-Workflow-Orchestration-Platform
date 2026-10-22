import React, { useState } from "react";
import { FiArrowLeft, FiAlertTriangle } from "react-icons/fi";
import { HashChainInspector } from "./components/HashChainInspector";
import RecordDetailsCard from "./components/RecordDetailsCard";
import { AuditTrailList } from "./components/AuditTrailList";
import { type AuditRecord } from "./types/audit.types";

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
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-slate-100 animate-in fade-in duration-200">
      {/* Top Breadcrumb & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => setSelectedEventId(null)}
            className="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium mb-1"
          >
            <FiArrowLeft className="w-3.5 h-3.5" />
            <span>Audit Trail</span>
          </button>
          <h1 className="text-lg font-bold text-white tracking-wide">
            Event #{record.sequence} · {record.action}
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">{record.displayTime}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {record.outcome}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-800 text-slate-400 border border-slate-700">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
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
      <div className="border border-dashed border-purple-500/40 bg-purple-950/10 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FiAlertTriangle className="text-purple-400 w-4 h-4" />
            <h4 className="text-xs font-bold text-purple-200 uppercase tracking-wider">
              Tamper with this record
            </h4>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 font-bold">
            DEMO TOOL
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed max-w-3xl">
          Simulates someone editing the database directly, bypassing AxiomFlow.
          Then recompute the hash or run verify integrity to watch cryptographic
          detection trigger.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={tamperField}
            onChange={(e) => setTamperField(e.target.value)}
            className="bg-[#0b0f19] border border-slate-800 text-xs text-white rounded-lg px-3 py-1.5 focus:outline-none focus:border-purple-500/50"
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
            className="flex-1 min-w-[200px] bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-purple-500/50"
          />

          <button
            type="button"
            onClick={handleTamperWithoutRehash}
            className="px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-900/20 hover:bg-purple-900/40 text-purple-200 text-xs font-medium transition-colors"
          >
            Edit without re-hashing
          </button>

          <button
            type="button"
            onClick={handleTamperAndRehash}
            className="px-3 py-1.5 rounded-lg border border-purple-500/30 bg-purple-900/20 hover:bg-purple-900/40 text-purple-200 text-xs font-medium transition-colors"
          >
            Edit and re-hash (smarter attacker)
          </button>
        </div>

        {tamperNotice && (
          <div className="p-3 bg-purple-950/40 border border-purple-500/30 rounded-lg text-xs text-purple-300 font-mono">
            {tamperNotice}
          </div>
        )}
      </div>
    </div>
  );
};

export default AuditView;
