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
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-danger/10 text-danger border border-danger/20 font-semibold uppercase">
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-warning/10 text-warning border border-warning/20 font-semibold uppercase">
            Auditor
          </span>
        );
      default:
        return (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-semibold uppercase">
            Staff
          </span>
        );
    }
  };

  return (
    <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm text-secondary space-y-4">
      <div className="flex items-center gap-2 pb-3 border-b border-subtle">
        <FiFileText className="text-accent-primary w-4 h-4" />
        <h3 className="text-sm font-semibold text-primary">Record</h3>
      </div>

      {/* Structured Key-Value Fields */}
      <div className="space-y-2 text-xs font-mono">
        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Event ID</span>
          <span className="text-secondary font-semibold">{record.id}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Timestamp</span>
          <span className="text-secondary">{record.timestamp}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Actor</span>
          <div className="flex items-center gap-1.5">
            <span className="text-primary font-sans font-medium">
              {record.actor}
            </span>
            {getRoleBadge(record.role)}
          </div>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Workspace</span>
          <span className="text-secondary">{record.workspace}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Action</span>
          <span className="text-accent-primary font-semibold">{record.action}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Target</span>
          <span className="text-secondary font-sans">{record.target}</span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Source</span>
          <span className="px-2 py-0.5 rounded bg-surface-hover border border-strong text-secondary text-[11px] font-sans">
            {record.source}
          </span>
        </div>

        <div className="flex items-center justify-between py-1">
          <span className="text-muted">Outcome</span>
          <span className="inline-flex items-center gap-1.5 text-success font-sans font-medium text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            {record.outcome}
          </span>
        </div>
      </div>

      {/* Details (Obscured by default, expandable on request) */}
      <div className="pt-3 border-t border-subtle">
        <div
          onClick={() => setIsJsonExpanded(!isJsonExpanded)}
          className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-subtle/80 cursor-pointer hover:border-strong transition-colors select-none"
        >
          <div className="flex items-center gap-2">
            <FiCode className="w-3.5 h-3.5 text-accent-primary" />
            <span className="text-xs font-medium text-secondary">
              Details Payload ({Object.keys(record.details).length} keys)
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-faint hover:text-secondary">
              {isJsonExpanded ? "Hide raw JSON" : "Show raw JSON"}
            </span>
            {isJsonExpanded ? (
              <FiChevronUp className="w-3.5 h-3.5 text-muted" />
            ) : (
              <FiChevronDown className="w-3.5 h-3.5 text-muted" />
            )}
          </div>
        </div>

        {/* Collapsible raw JSON pre block */}
        {isJsonExpanded && (
          <div className="relative mt-2 p-3 bg-background border border-subtle rounded-lg font-mono text-[11px] text-accent-primary/90 leading-relaxed overflow-x-auto">
            <button
              type="button"
              onClick={copyJson}
              className="absolute top-2.5 right-2.5 p-1 rounded bg-surface-hover/80 border border-strong text-muted hover:text-primary transition-colors"
              title="Copy JSON Payload"
            >
              {copied ? (
                <FiCheck className="w-3.5 h-3.5 text-success" />
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
