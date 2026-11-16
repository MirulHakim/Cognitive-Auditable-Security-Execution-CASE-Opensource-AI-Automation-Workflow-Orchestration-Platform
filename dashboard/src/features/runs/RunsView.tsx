import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiPlay, FiRefreshCw, FiArrowRight } from "react-icons/fi";
import {
  errorMessage,
  listInstances,
  listTemplates,
  startInstance,
} from "../../api/client";
import type { InstanceStatus, Template, WorkflowInstance } from "../../api/types";
import { formatDateTime, timeAgo } from "../../lib/format";
import RunDetail from "./RunDetail";

interface RunsViewProps {
  initialInstanceId?: string | null;
  onConsumedInitial?: () => void;
  canStart: boolean;
  canRespond: boolean;
  canCancel: boolean;
}

export const STATUS_STYLE: Record<InstanceStatus, string> = {
  RUNNING: "bg-info/10 text-info border-info/20",
  PAUSED: "bg-warning/10 text-warning border-warning/20",
  COMPLETED: "bg-success/10 text-success border-success/20",
  REJECTED: "bg-danger/10 text-danger border-danger/20",
  CANCELLED: "bg-surface-hover text-muted border-strong",
};

export const StatusBadge: React.FC<{ status: InstanceStatus }> = ({ status }) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_STYLE[status]}`}
  >
    <span className="w-1.5 h-1.5 rounded-full bg-current" />
    {status}
  </span>
);

export const RunsView: React.FC<RunsViewProps> = ({
  initialInstanceId,
  onConsumedInitial,
  canStart,
  canRespond,
  canCancel,
}) => {
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(initialInstanceId ?? null);
  const [startOpen, setStartOpen] = useState(Boolean(initialInstanceId));
  const [templateId, setTemplateId] = useState("");
  const [rows, setRows] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" },
  ]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([
      listInstances(),
      listTemplates({ status: "APPROVED", is_active: "true" }),
    ])
      .then(([nextInstances, nextTemplates]) => {
        setInstances(nextInstances);
        setTemplates(nextTemplates);
        setTemplateId((current) => current || nextTemplates[0]?.templateId || "");
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!initialInstanceId) return;
    setOpenId(initialInstanceId);
    onConsumedInitial?.();
  }, [initialInstanceId, onConsumedInitial]);

  const waitingLabel = useMemo(
    () => (instance: WorkflowInstance) => {
      const step = instance.steps.find((entry) => entry.id === instance.currentStep);
      return step ? `Step ${instance.cursorIndex + 1}: ${step.name}` : "—";
    },
    [],
  );

  const start = async () => {
    if (!templateId) return;
    setBusy(true);
    setError(null);
    try {
      const input: Record<string, string> = {};
      rows.forEach((row) => {
        if (row.key.trim()) input[row.key.trim()] = row.value;
      });
      const detail = await startInstance({ templateId, input });
      setStartOpen(false);
      setRows([{ key: "", value: "" }]);
      setNotice(
        `${detail.instance.templateName} is ${
          detail.instance.status === "PAUSED"
            ? `waiting at step ${detail.instance.cursorIndex + 1}`
            : detail.instance.status.toLowerCase()
        }.`,
      );
      setOpenId(detail.instance.instanceId);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  if (openId) {
    return (
      <RunDetail
        instanceId={openId}
        canRespond={canRespond}
        canCancel={canCancel}
        onBack={() => {
          setOpenId(null);
          refresh();
        }}
        onNotice={setNotice}
      />
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-tight">Workflow Runs</h1>
          <p className="text-xs text-muted mt-1">
            Start an approved template with case data, watch each step, and answer
            approval gates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface hover:bg-surface-hover text-xs font-medium text-secondary"
          >
            <FiRefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          {canStart && (
            <button
              type="button"
              onClick={() => setStartOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs shadow-sm shadow-accent-primary/40"
            >
              <FiPlay className="w-3.5 h-3.5" />
              Start run
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-xs text-success">
          {notice}
        </div>
      )}

      <div className="bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-subtle text-[11px] uppercase tracking-wider text-muted bg-surface-sunken/30">
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Template</th>
              <th className="py-3 px-4 font-medium">Waiting on</th>
              <th className="py-3 px-4 font-medium">Started</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/60 text-xs">
            {instances.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-10 text-center text-faint">
                  {loading ? "Loading runs…" : "No runs yet."}
                </td>
              </tr>
            ) : (
              instances.map((instance) => (
                <tr key={instance.instanceId} className="hover:bg-surface-sunken/40">
                  <td className="py-3 px-4">
                    <StatusBadge status={instance.status} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-secondary">{instance.templateName}</div>
                    <div className="font-mono text-[10px] text-faint">
                      {instance.instanceId.slice(0, 8)}… · v{instance.templateVersion}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {instance.status === "PAUSED" ? waitingLabel(instance) : "—"}
                  </td>
                  <td className="py-3 px-4 text-muted">
                    {timeAgo(instance.createdAt)}
                    <div className="text-[10px] text-faint">
                      {formatDateTime(instance.createdAt)}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setOpenId(instance.instanceId);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-subtle text-[11px] text-secondary hover:bg-surface-hover hover:text-primary"
                    >
                      Open
                      <FiArrowRight className="w-3 h-3" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {startOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-lg shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">Start a workflow run</h3>
              <button
                type="button"
                onClick={() => setStartOpen(false)}
                className="text-xs text-muted hover:text-primary"
              >
                Close
              </button>
            </div>

            {templates.length === 0 ? (
              <p className="text-xs text-muted">
                No approved, active templates yet — approve one first.
              </p>
            ) : (
              <>
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Template
                  </span>
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary"
                  >
                    {templates.map((template) => (
                      <option key={template.templateId} value={template.templateId}>
                        {template.name} (v{template.version})
                      </option>
                    ))}
                  </select>
                </label>

                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Case input (feeds document steps)
                  </span>
                  <div className="mt-1 space-y-2">
                    {rows.map((row, index) => (
                      <div key={index} className="flex gap-2">
                        <input
                          value={row.key}
                          placeholder="field"
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, key: event.target.value } : entry,
                              ),
                            )
                          }
                          className="w-36 bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary"
                        />
                        <input
                          value={row.value}
                          placeholder="value"
                          onChange={(event) =>
                            setRows((current) =>
                              current.map((entry, i) =>
                                i === index ? { ...entry, value: event.target.value } : entry,
                              ),
                            )
                          }
                          className="flex-1 bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary"
                        />
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setRows((current) => [...current, { key: "", value: "" }])}
                    className="mt-2 px-3 py-1 rounded-lg border border-strong text-[11px] text-secondary hover:bg-surface-hover"
                  >
                    Add field
                  </button>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setStartOpen(false)}
                    className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void start()}
                    disabled={busy || !templateId}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold disabled:opacity-50"
                  >
                    <FiPlay className="w-3.5 h-3.5" />
                    {busy ? "Starting…" : "Start run"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RunsView;
