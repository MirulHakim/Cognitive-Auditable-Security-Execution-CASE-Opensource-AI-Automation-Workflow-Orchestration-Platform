import React, { useState } from "react";
import {
  FiFileText,
  FiChevronDown,
  FiChevronUp,
  FiCopy,
  FiCheck,
  FiCode,
} from "react-icons/fi";
import { type AuditRecord } from "../types/audit.types";

interface RecordDetailsCardProps {
  record: AuditRecord;
}

export const RecordDetailsCard: React.FC<RecordDetailsCardProps> = ({
  record,
}) => {
  const [isJsonExpanded, setIsJsonExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(record.details, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case "admin":
        return (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20 font-semibold uppercase">
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-semibold uppercase">
            Auditor
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold uppercase">
            Staff
          </span>
        );
    }
  };

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm text-slate-200 space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-800">
        <FiFileText className="text-cyan-400 w-4 h-4" />
        <h3 className="text-sm font-semibold text-white">Record</h3>
      </div>

      {/* Structured Key-Value Fields */}
      <div className="space-y-2 text-xs font-mono">
        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Event ID</span>
          <span className="text-slate-200 font-semibold">{record.id}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Timestamp</span>
          <span className="text-slate-300">{record.timestamp}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Actor</span>
          <div className="flex items-center gap-1.5">
            <span className="text-white font-sans font-medium">
              {record.actor}
            </span>
            {getRoleBadge(record.role)}
          </div>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Workspace</span>
          <span className="text-slate-300">{record.workspace}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Action</span>
          <span className="text-cyan-400 font-semibold">{record.action}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Target</span>
          <span className="text-slate-300 font-sans">{record.target}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Source</span>
          <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[11px] font-sans">
            {record.source}
          </span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-slate-400">Outcome</span>
          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-sans font-medium text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {record.outcome}
          </span>
        </div>
      </div>

      {/* Details (Obscured by default, expandable on request) */}
      <div className="pt-3 border-t border-slate-800">
        <div
          onClick={() => setIsJsonExpanded(!isJsonExpanded)}
          className="flex items-center justify-between p-2.5 rounded-lg bg-[#0b0f19] border border-slate-800/80 cursor-pointer hover:border-slate-700 transition-colors select-none"
        >
          <div className="flex items-center gap-2">
            <FiCode className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-xs font-medium text-slate-300">
              Details Payload ({Object.keys(record.details).length} keys)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500 hover:text-slate-300">
              {isJsonExpanded ? "Hide raw JSON" : "Show raw JSON"}
            </span>
            {isJsonExpanded ? (
              <FiChevronUp className="w-3.5 h-3.5 text-slate-400" />
            ) : (
              <FiChevronDown className="w-3.5 h-3.5 text-slate-400" />
            )}
          </div>
        </div>

        {/* Collapsible raw JSON pre block */}
        {isJsonExpanded && (
          <div className="relative mt-2 p-3 bg-[#080c14] border border-slate-800 rounded-lg font-mono text-[11px] text-cyan-300/90 leading-relaxed overflow-x-auto">
            <button
              type="button"
              onClick={copyJson}
              className="absolute top-2.5 right-2.5 p-1 rounded bg-slate-800/80 border border-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Copy JSON Payload"
            >
              {copied ? (
                <FiCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <FiCopy className="w-3.5 h-3.5" />
              )}
            </button>
            <pre>{JSON.stringify(record.details, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
};

export default RecordDetailsCard;
