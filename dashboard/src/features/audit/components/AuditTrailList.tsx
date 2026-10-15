import React, { useState } from "react";
import {
  FiLock,
  FiSearch,
  FiChevronRight,
  FiChevronDown,
  FiCheckCircle,
  FiDownload,
} from "react-icons/fi";

// Mock data shaped exactly like the screenshot
const mockAuditEntries = [
  {
    id: "EVT-00038",
    type: "single",
    action: "AUDIT_INTEGRITY_VERIFIED",
    subtitle: "Mei Ling · Audit chain · single event",
    records: 1,
    lastUpdate: "15 Oct, 20:30",
    outcome: "Success",
    integrity: "Not checked",
  },
  {
    id: "JOB-1042",
    type: "group",
    action: "JOB-1042",
    tags: [
      {
        label: "Gmail",
        color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      },
      {
        label: "Plan review",
        dot: true,
        color: "text-amber-400 border-amber-500/20",
      },
      {
        label: "Gate 1",
        outline: true,
        color: "text-slate-400 border-slate-700",
      },
    ],
    pipeline: [
      { step: "OBJECTIVE", value: "Weekly orders summary" },
      { step: "DECISION", value: "Summary → PDF" },
      { step: "APPROVAL", value: "Pending" },
      { step: "RESULT", value: "In progress" },
    ],
    records: 3,
    lastUpdate: "15 Oct, 20:25",
    outcome: "Success",
    integrity: "Verified",
  },
  {
    id: "EVT-00034",
    type: "single",
    action: "INGRESS_REJECTED_DKIM_FAIL",
    subtitle: "CASE System · client.ali@abccorp.com · single event",
    records: 1,
    lastUpdate: "15 Oct, 20:00",
    outcome: "Failure",
    integrity: "Verified",
  },
  {
    id: "JOB-1041",
    type: "group",
    action: "JOB-1041",
    tags: [
      {
        label: "Gmail",
        color: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      },
      {
        label: "Final review",
        dot: true,
        color: "text-amber-400 border-amber-500/20",
      },
      {
        label: "Gate 2",
        outline: true,
        color: "text-slate-400 border-slate-700",
      },
    ],
    pipeline: [
      { step: "OBJECTIVE", value: "Invoice discrepancy" },
      { step: "DECISION", value: "Flag for manual review" },
      { step: "APPROVAL", value: "Approved" },
      { step: "RESULT", value: "Completed" },
    ],
    records: 8,
    lastUpdate: "15 Oct, 19:10",
    outcome: "Success",
    integrity: "Verified",
  },
];

interface AuditTrailListProps {
  onSelectRecord: (id: string) => void;
}

export const AuditTrailList: React.FC<AuditTrailListProps> = ({
  onSelectRecord,
}) => {
  const [viewMode, setViewMode] = useState<"grouped" | "flat">("grouped");
  const [searchQuery, setSearchQuery] = useState("");

  const getOutcomeBadge = (outcome: string) => {
    const isSuccess = outcome === "Success";
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
          isSuccess
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-rose-500/10 text-rose-400 border-rose-500/20"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isSuccess ? "bg-emerald-400" : "bg-rose-400"
          }`}
        />
        {outcome}
      </span>
    );
  };

  const getIntegrityBadge = (status: string) => {
    const isVerified = status === "Verified";
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
          isVerified
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
            : "bg-slate-800 text-slate-400 border-slate-700"
        }`}
      >
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            isVerified ? "bg-emerald-400" : "bg-slate-500"
          }`}
        />
        {status}
      </span>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto text-slate-100 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-xl font-bold text-white tracking-wide">
            Audit Trail
          </h1>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Append-only. Every step is stored as its own record, and each record
            holds the SHA-256 hash of the one before it, so changing or deleting
            any record breaks the chain. Records are grouped by request so each
            activity reads as one lineage.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-[#0f172a] hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors shrink-0"
        >
          <FiLock className="w-3.5 h-3.5" />
          <span>Export report (JSON)</span>
        </button>
      </div>

      {/* Integrity Banner */}
      <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-xl p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-start gap-3">
          <FiCheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-emerald-400">
              Hash chain intact: all 38 events verified
            </h3>
            <p className="text-xs text-emerald-400/70 mt-0.5">
              Checked 15 Oct 2026, 20:30:25. Events added since then are linked
              to this chain and are checked on the next run.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 hover:bg-emerald-500/10 text-emerald-400 text-xs font-medium transition-colors"
        >
          <FiLock className="w-3.5 h-3.5" />
          Verify integrity
        </button>
      </div>

      {/* Filters & Toggles */}
      <div className="flex flex-col md:flex-row items-center gap-3">
        <div className="flex items-center bg-[#0f172a] border border-slate-800 rounded-lg p-1 shrink-0">
          <button
            onClick={() => setViewMode("grouped")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === "grouped"
                ? "bg-indigo-500/20 text-indigo-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Group by request
          </button>
          <button
            onClick={() => setViewMode("flat")}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewMode === "flat"
                ? "bg-slate-800 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Show every record
          </button>
        </div>

        <div className="relative flex-1 w-full min-w-[200px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search action, actor or job"
            className="w-full bg-[#0f172a] border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <select className="bg-[#0f172a] border border-slate-800 text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/50">
            <option>All outcomes</option>
            <option>Success</option>
            <option>Failure</option>
          </select>
          <select className="bg-[#0f172a] border border-slate-800 text-xs text-white rounded-lg px-3 py-2 focus:outline-none focus:border-cyan-500/50">
            <option>All roles</option>
            <option>Admin</option>
            <option>Auditor</option>
          </select>
        </div>
      </div>

      <div className="text-[11px] text-slate-500 px-1">
        4 requests and 11 single events · 38 of 38 records
      </div>

      {/* Main Table */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] text-slate-400 bg-[#0b0f19]/50">
              <th className="py-3 px-4 font-medium w-full">
                Activity (Objective → Decision → Approval → Result)
              </th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">
                Records
              </th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">
                Last update
              </th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">
                Outcome
              </th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">
                Integrity
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs">
            {mockAuditEntries.map((entry, idx) => (
              <tr
                key={entry.id}
                onClick={() => onSelectRecord(entry.id)}
                className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
              >
                <td className="py-4 px-4 flex items-start gap-2">
                  <FiChevronRight className="w-4 h-4 text-slate-600 mt-0.5 shrink-0 group-hover:text-cyan-400 transition-colors" />

                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Event/Job Title Line */}
                    <div className="flex items-center flex-wrap gap-2">
                      <span
                        className={`font-mono text-xs font-semibold ${
                          entry.outcome === "Failure"
                            ? "text-rose-400"
                            : "text-slate-200 group-hover:text-white"
                        }`}
                      >
                        {entry.action}
                      </span>

                      {/* Render Badges if Grouped */}
                      {entry.tags?.map((tag, i) => (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                            tag.outline ? "bg-transparent" : ""
                          } ${tag.color}`}
                        >
                          {tag.dot && (
                            <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          )}
                          {tag.label}
                        </span>
                      ))}
                    </div>

                    {/* Subtitle (Single events) */}
                    {entry.subtitle && (
                      <p className="text-[11px] text-slate-500">
                        {entry.subtitle}
                      </p>
                    )}

                    {/* Pipeline Lineage Viewer (Grouped jobs) */}
                    {entry.pipeline && (
                      <div className="flex items-center flex-wrap gap-1 mt-2">
                        {entry.pipeline.map((step, i) => (
                          <React.Fragment key={step.step}>
                            <div className="bg-[#0b0f19] border border-slate-700/60 rounded flex flex-col p-1.5 min-w-[100px]">
                              <span className="text-[9px] font-bold text-slate-500 tracking-wider">
                                {step.step}
                              </span>
                              <span className="text-[11px] text-slate-300 font-medium mt-0.5">
                                {step.value}
                              </span>
                            </div>
                            {i < entry.pipeline!.length - 1 && (
                              <span className="text-slate-600 text-[10px] font-mono mx-1">
                                →
                              </span>
                            )}
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                </td>

                <td className="py-4 px-4 text-slate-400 align-top whitespace-nowrap">
                  {entry.records} record{entry.records > 1 ? "s" : ""}
                </td>
                <td className="py-4 px-4 text-slate-300 font-medium align-top whitespace-nowrap">
                  {entry.lastUpdate}
                </td>
                <td className="py-4 px-4 align-top whitespace-nowrap">
                  {getOutcomeBadge(entry.outcome)}
                </td>
                <td className="py-4 px-4 align-top whitespace-nowrap">
                  {getIntegrityBadge(entry.integrity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditTrailList;
