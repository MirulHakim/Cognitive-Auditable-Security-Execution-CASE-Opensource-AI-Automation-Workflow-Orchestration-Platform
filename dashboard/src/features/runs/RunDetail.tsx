import React, { useCallback, useEffect, useState } from "react";
import {
  FiArrowLeft,
  FiCheckCircle,
  FiXCircle,
  FiClock,
  FiFileText,
  FiAlertTriangle,
  FiRefreshCw,
  FiUploadCloud,
} from "react-icons/fi";
import {
  cancelInstance,
  errorMessage,
  getInstance,
  openInstanceDocument,
  respondInstance,
  uploadIntake,
} from "../../api/client";
import type { InstanceDetail, StepRunStatus, StepType } from "../../api/types";
import { formatDateTime } from "../../lib/format";
import { StatusBadge } from "./RunsView";

interface RunDetailProps {
  instanceId: string;
  canRespond: boolean;
  canCancel: boolean;
  onBack: () => void;
  onNotice?: (message: string) => void;
}

const RUN_STATUS_LABEL: Record<StepRunStatus, string> = {
  COMPLETED: "Completed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SIMULATED: "Simulated — nothing sent",
  FAILED: "Failed",
};

const RUN_STATUS_STYLE: Record<StepRunStatus, string> = {
  COMPLETED: "border-success/30 bg-success/10 text-success",
  APPROVED: "border-success/30 bg-success/10 text-success",
  REJECTED: "border-danger/30 bg-danger/10 text-danger",
  SIMULATED: "border-demo/30 bg-demo/10 text-demo",
  FAILED: "border-danger/30 bg-danger/10 text-danger",
};

const STEP_ICON: Record<StepType, React.ComponentType<{ className?: string }>> = {
  review: FiCheckCircle,
  validation: FiRefreshCw,
  approval: FiClock,
  intake: FiUploadCloud,
  document: FiFileText,
  notification: FiAlertTriangle,
};

const TERMINAL = ["COMPLETED", "REJECTED", "CANCELLED"];

export const RunDetail: React.FC<RunDetailProps> = ({
  instanceId,
  canRespond,
  canCancel,
  onBack,
  onNotice,
}) => {
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);
  const [intakeFile, setIntakeFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const refresh = useCallback(() => {
    setError(null);
    getInstance(instanceId)
      .then(setDetail)
      .catch((caught) => setError(errorMessage(caught)));
  }, [instanceId]);

  useEffect(() => {
    setDetail(null);
    refresh();
  }, [refresh]);

  const respond = async (approved: boolean) => {
    if (!approved && !comments.trim()) {
      setError("A rejection needs a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await respondInstance(instanceId, {
        approved,
        comments: comments.trim() || undefined,
      });
      setDetail(updated);
      setComments("");
      onNotice?.(
        approved
          ? `Run continued — now ${updated.instance.status.toLowerCase()}.`
          : "Run rejected at the gate; no later step executed.",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const submitIntake = async () => {
    if (!intakeFile) {
      setDocError("Choose a PDF, JPG or PNG file first.");
      return;
    }
    setUploading(true);
    setDocError(null);
    try {
      const updated = await uploadIntake(instanceId, intakeFile);
      setDetail(updated);
      setIntakeFile(null);
      onNotice?.(
        `File read — the run continued to ${updated.instance.status.toLowerCase()}.`,
      );
    } catch (caught) {
      setDocError(errorMessage(caught));
    } finally {
      setUploading(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await cancelInstance(instanceId);
      setDetail(updated);
      onNotice?.("Run cancelled; its history was kept.");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async (stepId: string) => {
    setDocError(null);
    try {
      await openInstanceDocument(instanceId, stepId);
    } catch (caught) {
      setDocError(errorMessage(caught));
    }
  };

  if (!detail && !error) {
    return <p className="p-6 text-xs text-muted">Loading run…</p>;
  }

  if (!detail) {
    return (
      <div className="p-6 space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-primary"
        >
          <FiArrowLeft className="w-3.5 h-3.5" />
          Back to runs
        </button>
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      </div>
    );
  }

  const { instance, stepRuns, pendingApproval } = detail;
  const runsByStep = new Map(stepRuns.map((run) => [run.stepId, run]));
  const isTerminal = TERMINAL.includes(instance.status);
  const inputEntries = Object.entries(instance.input);

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-primary"
      >
        <FiArrowLeft className="w-3.5 h-3.5" />
        Back to runs
      </button>

      <header className="rounded-xl border border-subtle bg-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold text-primary tracking-tight">
              {instance.templateName}
            </h1>
            <p className="mt-1 font-mono text-[10px] text-faint">{instance.instanceId}</p>
          </div>
          <StatusBadge status={instance.status} />
        </div>
        <dl className="mt-4 grid gap-4 text-xs sm:grid-cols-3">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Template version</dt>
            <dd className="mt-0.5 text-secondary">v{instance.templateVersion}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Started by</dt>
            <dd className="mt-0.5 font-mono text-secondary">
              {instance.createdBy ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-faint">Started</dt>
            <dd className="mt-0.5 text-secondary">{formatDateTime(instance.createdAt)}</dd>
          </div>
        </dl>
      </header>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}
      {docError && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {docError}
        </div>
      )}

      {pendingApproval && instance.status === "PAUSED" && pendingApproval.kind === "intake" && (
        <section className="rounded-xl border border-demo/40 bg-demo/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-demo flex items-center gap-2">
              <FiUploadCloud className="w-4 h-4" />
              File intake — step {pendingApproval.stepNumber} of {pendingApproval.totalSteps}
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-demo/40 text-demo">
              Run paused — upload required
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-demo/30 bg-surface p-4">
            <p className="text-sm font-medium text-primary">{pendingApproval.step.name}</p>
            <p className="mt-1 text-xs text-muted">{pendingApproval.step.description}</p>
            {pendingApproval.instruction && (
              <p className="mt-2 text-[11px] text-demo">
                AI will read: {pendingApproval.instruction}
              </p>
            )}
            <p className="mt-1 text-[10px] text-faint uppercase tracking-wider">
              Accepts {pendingApproval.acceptedFileTypes.join(" / ")}
            </p>
          </div>

          {canRespond ? (
            <>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <input
                  type="file"
                  accept={pendingApproval.acceptedFileTypes
                    .map((type) => `.${type === "jpeg" ? "jpg" : type}`)
                    .join(",")}
                  onChange={(event) => {
                    setIntakeFile(event.target.files?.[0] ?? null);
                    setDocError(null);
                  }}
                  disabled={uploading}
                  className="block w-full text-xs text-secondary file:mr-3 file:rounded-lg file:border file:border-strong file:bg-surface file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-secondary hover:file:bg-surface-hover"
                />
                <button
                  type="button"
                  onClick={() => void submitIntake()}
                  disabled={!intakeFile || uploading}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-demo hover:opacity-90 text-white text-xs font-semibold disabled:opacity-50 shrink-0"
                >
                  <FiUploadCloud className="w-3.5 h-3.5" />
                  {uploading ? "Reading file…" : "Upload & read"}
                </button>
              </div>

              <p className="mt-2 text-[11px] text-demo/80">
                The run does not continue until the file has been read. PDFs use their
                text layer; JPG/PNG use OCR; the extracted text is then read by the AI.
              </p>
            </>
          ) : (
            <p className="mt-3 text-xs text-demo">
              Only an operator or admin can upload this file — auditors are read-only.
            </p>
          )}
        </section>
      )}

      {pendingApproval && instance.status === "PAUSED" && pendingApproval.kind === "approval" && (
        <section className="rounded-xl border border-warning/40 bg-warning/10 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-warning flex items-center gap-2">
              <FiClock className="w-4 h-4" />
              Approval gate — step {pendingApproval.stepNumber} of{" "}
              {pendingApproval.totalSteps}
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border border-warning/40 text-warning">
              Waiting for a decision
            </span>
          </div>

          <div className="mt-3 rounded-lg border border-warning/30 bg-surface p-4">
            <p className="text-sm font-medium text-primary">{pendingApproval.step.name}</p>
            <p className="mt-1 text-xs text-muted">{pendingApproval.step.description}</p>
            {pendingApproval.step.assignedRole && (
              <p className="mt-1 text-[10px] text-faint">
                Role: {pendingApproval.step.assignedRole}
              </p>
            )}
          </div>

          {canRespond ? (
            <>
              <textarea
                value={comments}
                onChange={(event) => setComments(event.target.value)}
                rows={2}
                placeholder="Comments (required to reject)"
                className="mt-3 w-full bg-background border border-warning/40 rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-warning"
              />
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => void respond(true)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-success hover:bg-success-fill text-white text-xs font-semibold disabled:opacity-60"
                >
                  <FiCheckCircle className="w-3.5 h-3.5" />
                  Approve &amp; continue
                </button>
                <button
                  type="button"
                  onClick={() => void respond(false)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 text-xs font-semibold disabled:opacity-60"
                >
                  <FiXCircle className="w-3.5 h-3.5" />
                  Reject run
                </button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs text-warning">
              Only an operator or admin can answer this gate — auditors are read-only.
            </p>
          )}
        </section>
      )}

      {inputEntries.length > 0 && (
        <section className="rounded-xl border border-subtle bg-surface p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-primary">Case input</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {inputEntries.map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="w-36 shrink-0 text-muted">{key}</dt>
                <dd className="min-w-0 flex-1 break-words text-secondary">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="rounded-xl border border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-primary">
          Execution timeline ({stepRuns.length} of {instance.steps.length} steps run)
        </h2>
        <ol className="mt-3 space-y-3">
          {instance.steps.map((step, index) => {
            const run = runsByStep.get(step.id);
            const isCurrent = instance.status === "PAUSED" && instance.currentStep === step.id;
            const file = run?.result.file;
            const hasDocument = typeof file === "string" && file.length > 0;
            const Icon = STEP_ICON[step.type];

            return (
              <li
                key={step.id}
                className={`flex gap-3 rounded-lg border p-3 ${
                  isCurrent ? "border-warning/40 bg-warning/5" : "border-subtle"
                }`}
              >
                <span className="w-6 shrink-0 text-xs font-semibold text-faint">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted" />
                    <span className="text-xs font-medium text-primary">{step.name}</span>
                    <span className="px-1.5 py-0.5 rounded border border-subtle bg-surface-hover text-[10px] text-muted">
                      {step.type}
                    </span>
                    {run ? (
                      <span
                        className={`px-2 py-0.5 rounded-full border text-[10px] ${RUN_STATUS_STYLE[run.status]}`}
                      >
                        {RUN_STATUS_LABEL[run.status]}
                        {run.performedBy ? ` · ${run.performedBy}` : ""}
                      </span>
                    ) : isCurrent ? (
                      <span className="px-2 py-0.5 rounded-full border border-warning/40 bg-warning/10 text-[10px] text-warning">
                        Waiting at this step
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full border border-subtle text-[10px] text-faint">
                        Not run yet
                      </span>
                    )}
                    {hasDocument && (
                      <button
                        type="button"
                        onClick={() => void openDocument(step.id)}
                        className="px-2 py-0.5 rounded border border-accent-primary/40 text-[10px] text-accent-primary hover:bg-accent-primary/10"
                      >
                        Open document
                      </button>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-muted">{step.description}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {!isTerminal && canCancel && (
        <button
          type="button"
          onClick={() => void cancel()}
          disabled={busy}
          className="px-4 py-2 rounded-lg border border-strong bg-surface text-xs text-secondary hover:bg-surface-hover disabled:opacity-60"
        >
          Cancel run
        </button>
      )}
    </div>
  );
};

export default RunDetail;
