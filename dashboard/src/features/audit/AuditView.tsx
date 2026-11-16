import React, { useEffect, useState } from "react";
import { FiArrowLeft, FiCheckCircle, FiAlertTriangle } from "react-icons/fi";
import { HashChainInspector } from "./components/HashChainInspector";
import RecordDetailsCard from "./components/RecordDetailsCard";
import { AuditTrailList } from "./components/AuditTrailList";
import { type AuditRecord } from "./types/audit.types";
import { errorMessage, listMembers, verifyAudit } from "../../api/client";
import type { AuditEvent, AuditOutcome, Member } from "../../api/types";
import { formatDateTime } from "../../lib/format";

const OUTCOME_LABEL: Record<AuditOutcome, AuditRecord["outcome"]> = {
  SUCCESS: "Success",
  FAILURE: "Failure",
  PENDING: "Pending",
};

const ROLE_LABEL: Record<AuditEvent["actorRole"], AuditRecord["role"]> = {
  admin: "admin",
  operator: "staff",
  auditor: "auditor",
  system: "staff",
};

interface Selection {
  event: AuditEvent;
  previous: AuditEvent | null;
  next: AuditEvent | null;
}

export const AuditView: React.FC = () => {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [check, setCheck] = useState<{ verified: boolean; checkedAt: string } | null>(
    null,
  );

  useEffect(() => {
    listMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, []);

  const actorName = (id: string): string =>
    members.find(
      (member) =>
        member.id === id || member.email.toLowerCase() === id.toLowerCase(),
    )?.displayName ?? id;

  const toRecord = (event: AuditEvent): AuditRecord => ({
    id: `EVT-${String(event.sequence).padStart(5, "0")}`,
    sequence: event.sequence,
    timestamp: event.recordedAt,
    displayTime: formatDateTime(event.recordedAt),
    actor: actorName(event.actorId),
    role: ROLE_LABEL[event.actorRole],
    workspace: "case_workspace",
    action: event.action,
    target: event.targetType ? `${event.targetType}/${event.targetId || "—"}` : "Workspace",
    source: "CASE API",
    outcome: OUTCOME_LABEL[event.outcome],
    details: event.details,
    prevHash: event.prevHash,
    hash: event.hash,
    integrity: check?.verified ? "Verified" : "Not checked",
  });

  if (!selection) {
    return <AuditTrailList onSelectRecord={(event, previous, next) => setSelection({ event, previous, next })} />;
  }

  const record = toRecord(selection.event);
  const previousRecord = selection.previous ? toRecord(selection.previous) : undefined;
  const nextRecord = selection.next ? toRecord(selection.next) : null;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-primary">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={() => setSelection(null)}
            className="inline-flex items-center gap-1.5 text-xs text-accent-primary hover:underline font-medium mb-1"
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
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
              record.outcome === "Success"
                ? "bg-success/10 text-success border-success/20"
                : "bg-danger/10 text-danger border-danger/20"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {record.outcome}
          </span>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-surface-hover text-muted border border-strong">
            <span className="w-1.5 h-1.5 rounded-full bg-muted" />
            {record.integrity}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecordDetailsCard record={record} />
        <HashChainInspector
          currentRecord={record}
          previousRecord={previousRecord}
          nextRecord={nextRecord}
          onVerify={async () => {
            try {
              const result = await verifyAudit();
              setCheck({ verified: result.verified, checkedAt: result.checkedAt });
              return result.verified
                ? {
                    verified: true,
                    message: `Match. All ${result.checked} links verify — this record is unchanged.`,
                  }
                : {
                    verified: false,
                    message: `Mismatch. The chain breaks at event #${result.brokenAt}.`,
                  };
            } catch (caught) {
              return { verified: false, message: errorMessage(caught) };
            }
          }}
        />
      </div>

      <div className="rounded-2xl border border-subtle bg-surface p-5 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          {check?.verified ? (
            <FiCheckCircle className="w-4 h-4 text-success" />
          ) : (
            <FiAlertTriangle className="w-4 h-4 text-muted" />
          )}
          <h4 className="text-xs font-bold text-secondary uppercase tracking-wider">
            How this record is protected
          </h4>
        </div>
        <p className="text-xs text-muted leading-relaxed max-w-3xl">
          The stored <span className="font-mono text-accent-primary">hash</span> is
          SHA-256 over this record&apos;s fields plus the previous record&apos;s hash.
          Verification recomputes the whole chain from the database rows: editing a
          row (or deleting one) makes every later link fail, which is what the
          verify action above reports. There is no write endpoint for audit
          records — they are appended by the API as actions happen.
        </p>
        {check && (
          <p className="text-[11px] font-mono text-faint">
            last checked {formatDateTime(check.checkedAt)} ·{" "}
            {check.verified ? "chain intact" : "chain broken"}
          </p>
        )}
      </div>
    </div>
  );
};

export default AuditView;
