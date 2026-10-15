export type AuditOutcome = "Success" | "Failure" | "Pending" | "In progress";
export type IntegrityStatus = "Verified" | "Not checked" | "Tampered";

export interface HashChainBlock {
  sequence: number;
  action: string;
  summary: string;
  prevHash: string;
  hash: string;
  isCurrent?: boolean;
  isLatest?: boolean;
}

export interface AuditRecord {
  id: string; // e.g. "EVT-00038"
  sequence: number; // e.g. 38
  timestamp: string; // e.g. "2026-10-15T12:30:25.965Z"
  displayTime: string; // e.g. "15 Oct 2026, 20:30:25 (MYT)"
  actor: string; // e.g. "Mei Ling"
  role: "admin" | "staff" | "auditor";
  workspace: string; // e.g. "ws_finops_01"
  action: string; // e.g. "AUDIT_INTEGRITY_VERIFIED"
  target: string; // e.g. "Audit chain"
  source: string; // e.g. "Web app"
  outcome: AuditOutcome;
  details: Record<string, any>;
  prevHash: string;
  hash: string;
  integrity: IntegrityStatus;
  requestId?: string; // e.g. "JOB-1042"
  jobType?: string; // e.g. "Gmail"
  stageBadge?: string; // e.g. "Plan review"
  gateBadge?: string; // e.g. "Gate 1"
}

export interface AuditRequestGroup {
  requestId: string;
  jobType: string;
  stageBadge: string;
  gateBadge: string;
  recordsCount: number;
  lastUpdate: string;
  outcome: AuditOutcome;
  integrity: IntegrityStatus;
  pipelineStages: {
    objective: string;
    decision: string;
    approval: string;
    result: string;
  };
  events: AuditRecord[];
}
