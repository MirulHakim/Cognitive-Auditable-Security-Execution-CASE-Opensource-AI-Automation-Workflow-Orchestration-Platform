import React, { useCallback, useEffect, useState } from "react";
import {
  FiLock,
  FiSearch,
  FiChevronRight,
  FiCheckCircle,
  FiAlertTriangle,
  FiRefreshCw,
} from "react-icons/fi";
import {
  errorMessage,
  listAuditEvents,
  listMembers,
  verifyAudit,
} from "../../../api/client";
import type {
  AuditEvent,
  AuditOutcome,
  AuditVerification,
  Member,
} from "../../../api/types";
import { formatDateTime, humanizeAction, shortHash } from "../../../lib/format";

interface AuditTrailListProps {
  onSelectRecord: (
    event: AuditEvent,
    previous: AuditEvent | null,
    next: AuditEvent | null,
  ) => void;
}

const OUTCOME_STYLE: Record<AuditOutcome, string> = {
  SUCCESS: "bg-success/10 text-success border-success/20",
  FAILURE: "bg-danger/10 text-danger border-danger/20",
  PENDING: "bg-warning/10 text-warning border-warning/20",
};

const OUTCOME_LABEL: Record<AuditOutcome, string> = {
  SUCCESS: "Success",
  FAILURE: "Failure",
  PENDING: "Pending",
};

/**
 * Audit trail — the real, append-only, hash-chained event log served by
 * GET /api/audit. Grouping is dropped: every stored event is one record, and
 * the chain (prev_hash → hash) is what links them.
 */
export const AuditTrailList: React.FC<AuditTrailListProps> = ({ onSelectRecord }) => {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [outcome, setOutcome] = useState<"" | AuditOutcome>("");
  const [verification, setVerification] = useState<AuditVerification | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      listAuditEvents({ limit: 100 }),
      listMembers().catch(() => []),
    ])
      .then(([page, memberList]) => {
        setEvents(page.events);
        setTotal(page.total);
        setMembers(memberList);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    setVerifying(true);
    try {
      setVerification(await verifyAudit());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setVerifying(false);
    }
  };

  const resolveActor = (id: string): string =>
    members.find(
      (member) =>
        member.id === id || member.email.toLowerCase() === id.toLowerCase(),
    )?.displayName ?? id;

  const filtered = events.filter((event) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      event.action.toLowerCase().includes(query) ||
      event.actorId.toLowerCase().includes(query) ||
      resolveActor(event.actorId).toLowerCase().includes(query) ||
      event.targetId.toLowerCase().includes(query);
    const matchesOutcome = outcome === "" || event.outcome === outcome;
    return matchesSearch && matchesOutcome;
  });

  return (
    <div className="p-6 max-w-7xl mx-auto text-primary space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h1 className="text-xl font-bold text-primary tracking-wide">Audit Trail</h1>
          <p className="text-xs text-muted mt-1 leading-relaxed">
            Append-only. Every template, run and membership action is stored as its
            own record, and each record holds the SHA-256 hash of the one before it,
            so changing or deleting any record breaks the chain.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const json = JSON.stringify(events, null, 2);
            const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
            const anchor = document.createElement("a");
            anchor.href = url;
            anchor.download = "case-audit-trail.json";
            anchor.click();
            URL.revokeObjectURL(url);
          }}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-strong bg-surface hover:bg-surface-hover text-xs font-medium text-secondary transition-colors shrink-0"
        >
          <FiLock className="w-3.5 h-3.5" />
          <span>Export report (JSON)</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}

      <div
        className={`rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border shadow-sm ${
          verification === null
            ? "bg-surface border-subtle"
            : verification.verified
              ? "bg-success/10 border-success/30"
              : "bg-danger/10 border-danger/30"
        }`}
      >
        <div className="flex items-start gap-3">
          {verification === null ? (
            <FiLock className="w-5 h-5 text-muted mt-0.5 shrink-0" />
          ) : verification.verified ? (
            <FiCheckCircle className="w-5 h-5 text-success mt-0.5 shrink-0" />
          ) : (
            <FiAlertTriangle className="w-5 h-5 text-danger mt-0.5 shrink-0" />
          )}
          <div>
            <h3
              className={`text-sm font-semibold ${
                verification === null
                  ? "text-primary"
                  : verification.verified
                    ? "text-success"
                    : "text-danger"
              }`}
            >
              {verification === null
                ? "Chain integrity not checked yet"
                : verification.verified
                  ? `Hash chain intact: all ${verification.checked} events verified`
                  : `Chain broken at event #${verification.brokenAt}`}
            </h3>
            <p className="text-xs text-muted mt-0.5">
              {verification === null
                ? "Run verification to recompute every SHA-256 link from the database rows."
                : verification.verified
                  ? `Checked ${formatDateTime(verification.checkedAt)} · head ${shortHash(verification.headHash)}`
                  : `Checked ${formatDateTime(verification.checkedAt)} · the stored hash no longer matches the recomputed one.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void verify()}
          disabled={verifying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-strong bg-surface hover:bg-surface-hover text-xs font-medium text-secondary transition-colors disabled:opacity-60 shrink-0"
        >
          <FiRefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
          {verifying ? "Verifying…" : "Verify integrity"}
        </button>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-3">
        <div className="relative flex-1 w-full min-w-[200px]">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search action, actor or target"
            className="w-full bg-surface border border-subtle rounded-lg pl-9 pr-3 py-2 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
          />
        </div>
        <select
          value={outcome}
          onChange={(event) => setOutcome(event.target.value as "" | AuditOutcome)}
          className="bg-surface border border-subtle text-xs text-primary rounded-lg px-3 py-2 focus:outline-none focus:border-accent-primary/50"
        >
          <option value="">All outcomes</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILURE">Failure</option>
          <option value="PENDING">Pending</option>
        </select>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface hover:bg-surface-hover text-xs text-secondary"
        >
          <FiRefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="text-[11px] text-faint px-1">
        Showing {filtered.length} of {total} recorded event{total === 1 ? "" : "s"}
      </div>

      <div className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-subtle text-[11px] text-muted bg-surface-sunken/30 uppercase tracking-wider">
              <th className="py-3 px-4 font-medium w-full">Event</th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">Actor</th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">Time</th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">Outcome</th>
              <th className="py-3 px-4 font-medium whitespace-nowrap">Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/60 text-xs">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-faint">
                  {loading
                    ? "Loading audit records…"
                    : "No audit records yet — actions in this workspace will appear here."}
                </td>
              </tr>
            ) : (
              filtered.map((event, index) => {
                const previous = filtered[index + 1] ?? null;
                const next = filtered[index - 1] ?? null;
                return (
                  <tr
                    key={event.id}
                    onClick={() => onSelectRecord(event, previous, next)}
                    className="hover:bg-surface-hover/40 transition-colors cursor-pointer group"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-start gap-2">
                        <FiChevronRight className="w-4 h-4 text-faint/50 mt-0.5 shrink-0 group-hover:text-accent-primary" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-[10px] text-faint">
                              EVT-{String(event.sequence).padStart(5, "0")}
                            </span>
                            <span className="font-medium text-secondary group-hover:text-primary">
                              {humanizeAction(event.action)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded bg-surface-hover border border-subtle text-[10px] text-muted font-mono">
                              {event.action}
                            </span>
                          </div>
                          <p className="text-[11px] text-faint mt-0.5 truncate">
                            {event.targetType || "workspace"}
                            {event.targetId ? ` · ${event.targetId.slice(0, 14)}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 align-top">
                      <div className="text-secondary">{resolveActor(event.actorId)}</div>
                      <div className="text-[10px] text-faint">{event.actorRole}</div>
                    </td>
                    <td className="py-3 px-4 align-top text-muted whitespace-nowrap">
                      {formatDateTime(event.recordedAt)}
                    </td>
                    <td className="py-3 px-4 align-top whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${OUTCOME_STYLE[event.outcome]}`}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-current" />
                        {OUTCOME_LABEL[event.outcome]}
                      </span>
                    </td>
                    <td className="py-3 px-4 align-top font-mono text-[10px] text-faint whitespace-nowrap">
                      {shortHash(event.hash)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditTrailList;
