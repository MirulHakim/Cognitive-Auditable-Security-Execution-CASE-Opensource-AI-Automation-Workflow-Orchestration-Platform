import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiArrowLeft,
  FiPlay,
  FiSave,
  FiPlus,
  FiEdit2,
  FiTrash2,
  FiChevronLeft,
  FiChevronRight,
  FiCheck,
  FiX,
  FiUserCheck,
  FiCheckSquare,
  FiSend,
  FiFileText,
  FiUploadCloud,
  FiInfo,
} from "react-icons/fi";
import {
  ApiError,
  approveTemplate,
  createTemplate,
  getTemplate,
  rejectTemplate,
  startInstance,
  updateTemplate,
  errorMessage,
  activateTemplate,
  deactivateTemplate,
} from "../../api/client";
import type { FileType, StepType, Template } from "../../api/types";
import { useSession } from "../../context/SessionContext";
import { formatDateTime, initials } from "../../lib/format";

interface WorkflowEditorProps {
  workflowId?: string | null;
  onBack: () => void;
  onOpenRun?: (instanceId: string) => void;
}

interface DraftStep {
  id: string;
  name: string;
  type: StepType;
  description: string;
  assignedRole?: string;
  channel?: string;
  acceptedFileTypes?: FileType[];
  instruction?: string;
}

const STEP_META: Record<
  StepType,
  { label: string; blurb: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  review: {
    label: "Review",
    blurb: "A human reviews the case before anything else happens.",
    icon: FiCheck,
    color: "text-warning bg-warning/10 border-warning/20",
  },
  validation: {
    label: "Validation",
    blurb: "Required details are checked automatically.",
    icon: FiCheckSquare,
    color: "text-demo bg-demo/10 border-demo/20",
  },
  approval: {
    label: "Approval",
    blurb: "Execution pauses until someone approves or rejects.",
    icon: FiUserCheck,
    color: "text-warning bg-warning/10 border-warning/20",
  },
  intake: {
    label: "File intake",
    blurb: "Pauses for a PDF/JPG upload; the AI reads it before the run continues.",
    icon: FiUploadCloud,
    color: "text-demo bg-demo/10 border-demo/20",
  },
  document: {
    label: "Document",
    blurb: "Renders a document from the run's case data.",
    icon: FiFileText,
    color: "text-info bg-info/10 border-info/20",
  },
  notification: {
    label: "Notification",
    blurb: "Simulated delivery to email or Telegram.",
    icon: FiSend,
    color: "text-success bg-success/10 border-success/20",
  },
};

const STEP_ORDER: StepType[] = [
  "review",
  "validation",
  "approval",
  "intake",
  "document",
  "notification",
];
const ROLES = ["officer", "approver", "coordinator"];
const CHANNELS = ["email", "telegram"];
const FILE_TYPES: FileType[] = ["pdf", "jpg", "jpeg", "png"];

/** Canvas geometry. Nodes are fixed-size so connectors can be drawn precisely. */
const NODE_W = 280;
const NODE_H = 136;
const COL_GAP = 80;
const ROW_GAP = 72;
const CANVAS_PAD = 20;
/** Above the first row, the manual start marker anchors the flow. */
const TRIGGER_RECT = { x: CANVAS_PAD, y: CANVAS_PAD, w: 248, h: 56 };
const FIRST_ROW_Y = TRIGGER_RECT.y + TRIGGER_RECT.h + 64;

interface Point {
  x: number;
  y: number;
}

interface Rect extends Point {
  w: number;
  h: number;
}

/** Fallback snake layout: down two columns, used until a step is dragged. */
function defaultSlot(index: number): Point {
  const column = index % 2;
  const row = Math.floor(index / 2);
  return {
    x: CANVAS_PAD + column * (NODE_W + COL_GAP),
    y: FIRST_ROW_Y + row * (NODE_H + ROW_GAP),
  };
}

/** Saved positions win; steps without one fall back to the snake layout. */
function layoutFor(
  steps: { id: string; position?: Point }[],
  previous: Record<string, Point> = {},
): Record<string, Point> {
  const next: Record<string, Point> = {};
  steps.forEach((step, index) => {
    next[step.id] = previous[step.id] ?? step.position ?? defaultSlot(index);
  });
  return next;
}

/**
 * Cubic connector between two node rectangles, leaving each box at the edge that
 * faces the other one, so the map stays readable at any arrangement.
 */
function edgePath(from: Rect, to: Rect): string {
  const fromCenter = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const toCenter = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;

  let sx: number;
  let sy: number;
  let ex: number;
  let ey: number;
  let c1x: number;
  let c1y: number;
  let c2x: number;
  let c2y: number;

  if (Math.abs(dx) >= Math.abs(dy)) {
    sx = dx >= 0 ? from.x + from.w : from.x;
    sy = fromCenter.y;
    ex = dx >= 0 ? to.x : to.x + to.w;
    ey = toCenter.y;
    const bend = Math.max(40, Math.abs(dx) * 0.45);
    c1x = sx + Math.sign(dx) * bend;
    c1y = sy;
    c2x = ex - Math.sign(dx) * bend;
    c2y = ey;
  } else {
    sx = fromCenter.x;
    sy = dy >= 0 ? from.y + from.h : from.y;
    ex = toCenter.x;
    ey = dy >= 0 ? to.y : to.y + to.h;
    const bend = Math.max(40, Math.abs(dy) * 0.45);
    c1x = sx;
    c1y = sy + Math.sign(dy) * bend;
    c2x = ex;
    c2y = ey - Math.sign(dy) * bend;
  }

  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
}

function newStep(type: StepType): DraftStep {
  const meta = STEP_META[type];
  return {
    id: `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
    name: meta.label,
    type,
    description:
      type === "review"
        ? "Review the submitted case."
        : type === "validation"
          ? "Check that all required details are present."
          : type === "approval"
            ? "Obtain approval before continuing."
            : type === "intake"
              ? "Upload the supporting PDF or image so the AI can read it."
              : type === "document"
                ? "Generate the output document from the case data."
                : "Notify the requester of the outcome.",
    ...(type === "notification" ? { channel: "email" } : {}),
    ...(type === "intake"
      ? {
          acceptedFileTypes: ["pdf", "jpg", "png"] as FileType[],
          instruction: "Read the document and extract the facts the approver needs.",
        }
      : {}),
  };
}

function toDraft(template: Template): DraftStep[] {
  return template.steps.map((step) => ({
    id: step.id,
    name: step.name,
    type: step.type,
    description: step.description,
    assignedRole: step.assignedRole,
    channel: step.channel,
    acceptedFileTypes: step.acceptedFileTypes,
    instruction: step.instruction,
  }));
}

function issuesFrom(caught: unknown): string[] {
  if (!(caught instanceof ApiError)) return [errorMessage(caught)];
  const messages: string[] = [];
  for (const issue of caught.details.structural ?? []) {
    messages.push(`${issue.path}: ${issue.message}`);
  }
  for (const issue of caught.details.businessRules ?? []) {
    messages.push(issue.message);
  }
  return messages.length > 0 ? messages : [caught.message];
}

const STATUS_STYLE: Record<Template["reviewStatus"], string> = {
  APPROVED: "bg-success/10 text-success border-success/20",
  PENDING: "bg-warning/10 text-warning border-warning/20",
  REJECTED: "bg-danger/10 text-danger border-danger/20",
};

/**
 * Workflow canvas — the real step editor.
 *
 * The canvas renders the stored template steps in execution order; the drawer
 * edits one step at a time. Save validates on the server (structural + business
 * rules) and shows every violation. Approve and Run only work through the
 * server's state machine: PENDING → APPROVED+active → executable.
 */
export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  workflowId,
  onBack,
  onOpenRun,
}) => {
  const { can, member } = useSession();
  const isNew = !workflowId || workflowId === "new";

  const [templateId, setTemplateId] = useState<string | null>(isNew ? null : workflowId);
  const [name, setName] = useState(isNew ? "Untitled workflow" : "");
  const [steps, setSteps] = useState<DraftStep[]>(isNew ? [newStep("review")] : []);
  /** Canvas coordinates per step id; persisted with the template on save. */
  const [positions, setPositions] = useState<Record<string, Point>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [runOpen, setRunOpen] = useState(false);
  const [runRows, setRunRows] = useState<{ key: string; value: string }[]>([
    { key: "", value: "" },
  ]);

  const load = useCallback(async () => {
    if (!templateId) return;
    setLoading(true);
    try {
      const loaded = await getTemplate(templateId);
      setTemplate(loaded);
      setName(loaded.name);
      setSteps(toDraft(loaded));
      setPositions(layoutFor(loaded.steps));
      setIssues([]);
    } catch (caught) {
      setIssues(issuesFrom(caught));
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Give every step a slot exactly once (new, added, or steps loaded without a
  // stored position); never overwrite a position the user dragged.
  useEffect(() => {
    setPositions((current) => {
      let changed = false;
      const next: Record<string, Point> = {};
      steps.forEach((step, index) => {
        const existing = current[step.id];
        if (existing) {
          next[step.id] = existing;
        } else {
          next[step.id] = defaultSlot(index);
          changed = true;
        }
      });
      if (!changed && Object.keys(next).length === Object.keys(current).length) {
        return current;
      }
      return next;
    });
  }, [steps]);

  const selected = useMemo(
    () => steps.find((step) => step.id === selectedId) ?? null,
    [steps, selectedId],
  );

  const editable = template === null || template.reviewStatus !== "APPROVED";

  const patchStep = (id: string, patch: Partial<DraftStep>) =>
    setSteps((current) =>
      current.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    );

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= steps.length) return;
    const movingId = steps[index]!.id;
    const targetId = steps[target]!.id;
    setSteps((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    // Swapping order also swaps places on the canvas, so the map keeps reading
    // top-to-bottom in execution order.
    setPositions((current) => ({
      ...current,
      [movingId]: current[targetId] ?? defaultSlot(target),
      [targetId]: current[movingId] ?? defaultSlot(index),
    }));
  };

  /** Pointer-driven arrangement: the primary way to lay the map out. */
  const startDrag = (event: React.PointerEvent<HTMLDivElement>, stepId: string) => {
    if (!canArrange) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const point = positions[stepId] ?? defaultSlot(0);
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      id: stepId,
      dx: event.clientX - rect.left + canvas.scrollLeft - point.x,
      dy: event.clientY - rect.top + canvas.scrollTop - point.y,
    };
    setDraggingId(stepId);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is an optimisation; dragging still works without it.
    }
  };

  const dragStep = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const canvas = canvasRef.current;
    if (!drag || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(
      0,
      event.clientX - rect.left + canvas.scrollLeft - drag.dx,
    );
    const y = Math.max(
      0,
      event.clientY - rect.top + canvas.scrollTop - drag.dy,
    );
    setPositions((current) => ({ ...current, [drag.id]: { x, y } }));
  };

  const endDrag = () => {
    dragRef.current = null;
    setDraggingId(null);
  };

  const removeStep = (id: string) => {
    setSteps((current) => current.filter((step) => step.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const save = async (): Promise<Template | null> => {
    setBusy(true);
    setIssues([]);
    setNotice(null);
    try {
      const payload = {
        name: name.trim(),
        // Positions travel with the steps: the arrangement is part of the template.
        steps: steps.map((step) => ({
          ...step,
          position: positions[step.id] ?? defaultSlot(0),
        })),
      };
      const result = templateId
        ? await updateTemplate(templateId, payload)
        : await createTemplate(payload);
      setTemplate(result);
      setTemplateId(result.templateId);
      setName(result.name);
      setSteps(toDraft(result));
      setPositions(layoutFor(result.steps));
      setNotice(
        templateId
          ? "Saved. The template was revalidated."
          : "Template created as a pending draft.",
      );
      return result;
    } catch (caught) {
      setIssues(issuesFrom(caught));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    const saved = await save();
    const id = saved?.templateId ?? templateId;
    if (!id) return;
    setBusy(true);
    try {
      const approved = await approveTemplate(id);
      setTemplate(approved);
      setTemplateId(approved.templateId);
      setNotice(`${approved.name} approved and activated.`);
      setIssues([]);
    } catch (caught) {
      setIssues(issuesFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    if (!templateId || !rejectReason.trim()) return;
    setBusy(true);
    try {
      const rejected = await rejectTemplate(templateId, rejectReason.trim());
      setTemplate(rejected);
      setNotice("Rejected with a reason — the template stays inactive.");
      setRejectOpen(false);
      setRejectReason("");
      setIssues([]);
    } catch (caught) {
      setIssues(issuesFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async () => {
    if (!templateId || !template) return;
    setBusy(true);
    try {
      const updated = template.isActive
        ? await deactivateTemplate(templateId)
        : await activateTemplate(templateId);
      setTemplate(updated);
      setNotice(
        updated.isActive ? "Template is active." : "Template deactivated — history kept.",
      );
    } catch (caught) {
      setIssues(issuesFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const startRun = async () => {
    if (!templateId) return;
    setBusy(true);
    setIssues([]);
    try {
      const input: Record<string, string> = {};
      runRows.forEach((row) => {
        if (row.key.trim()) input[row.key.trim()] = row.value;
      });
      const detail = await startInstance({ templateId, input });
      setRunOpen(false);
      setRunRows([{ key: "", value: "" }]);
      onOpenRun?.(detail.instance.instanceId);
    } catch (caught) {
      setIssues(issuesFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const canEdit = can("template:edit");
  const canApprove = can("template:approve");
  const canRun = can("workflow:start");
  /** Arranging the map is an edit: read-only users get a fixed layout. */
  const canArrange = editable && canEdit;

  const rectOf = (stepId: string): Rect => ({
    ...(positions[stepId] ?? defaultSlot(0)),
    w: NODE_W,
    h: NODE_H,
  });
  const graphWidth = Math.max(
    720,
    ...steps.map((step) => (positions[step.id]?.x ?? 0) + NODE_W + CANVAS_PAD),
  );
  const graphHeight = Math.max(
    380,
    ...steps.map((step) => (positions[step.id]?.y ?? 0) + NODE_H + CANVAS_PAD),
  );

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden relative">
      {/* Subheader */}
      <div className="h-14 bg-surface border-b border-subtle px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
            aria-label="Back to workflows"
          >
            <FiArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-surface-hover" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-primary truncate max-w-[40vw]">
                {name || "Untitled workflow"}
              </span>
              {template && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border ${STATUS_STYLE[template.reviewStatus]}`}
                >
                  {template.reviewStatus}
                </span>
              )}
              {template && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-surface-hover text-muted border border-strong">
                  v{template.version}
                </span>
              )}
            </div>
            <p className="text-[10px] text-faint hidden sm:block">
              {template
                ? `${template.origin === "AI_DRAFTED" ? "AI draft" : "Manual"} · created ${formatDateTime(
                    template.createdAt,
                  )}`
                : "New template — save it to start a review"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setRenameOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors"
          >
            <FiEdit2 className="w-3.5 h-3.5 text-accent-primary" />
            <span className="hidden sm:inline">Rename</span>
          </button>
          <button
            type="button"
            onClick={() => setCatalogOpen(true)}
            disabled={!editable}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors disabled:opacity-40"
          >
            <FiPlus className="w-3.5 h-3.5 text-accent-primary" />
            <span className="hidden sm:inline">Add step</span>
          </button>
          {template?.reviewStatus === "PENDING" && canApprove ? (
            <>
              <button
                type="button"
                onClick={() => setRejectOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 text-xs font-medium transition-colors"
              >
                <FiX className="w-3.5 h-3.5" />
                Reject
              </button>
              <button
                type="button"
                onClick={() => void approve()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-success/90 hover:bg-success text-white text-xs font-semibold disabled:opacity-60"
              >
                <FiCheck className="w-3.5 h-3.5" />
                Approve
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !editable}
              title={
                editable
                  ? "Save name and steps"
                  : "Approved templates are immutable — create a new version instead"
              }
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors disabled:opacity-40"
            >
              <FiSave className="w-3.5 h-3.5 text-accent-primary" />
              {busy ? "Saving…" : "Save"}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRunOpen(true)}
            disabled={!template || template.reviewStatus !== "APPROVED" || !template.isActive || !canRun}
            title={
              !template || template.reviewStatus !== "APPROVED" || !template.isActive
                ? "Only approved, active templates can run"
                : "Start a run"
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-sm shadow-accent-primary/40 disabled:opacity-40 disabled:shadow-none"
          >
            <FiPlay className="w-3.5 h-3.5" />
            Run
          </button>
        </div>
      </div>

      {/* Feedback banners */}
      {(issues.length > 0 || notice) && (
        <div className="px-4 py-3 border-b border-subtle bg-surface/60 shrink-0">
          {notice && (
            <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-xs text-success">
              {notice}
            </div>
          )}
          {issues.length > 0 && (
            <div className="mt-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger space-y-1">
              <p className="font-semibold">The server rejected this change:</p>
              {issues.map((issue, index) => (
                <p key={index} className="font-mono">
                  · {issue}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div
          className="flex-1 relative overflow-auto"
          style={{
            backgroundImage: "radial-gradient(circle, var(--border-strong) 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        >
          {loading ? (
            <p className="p-8 text-xs text-muted">Loading template…</p>
          ) : (
            <div
              ref={canvasRef}
              className="relative"
              style={{ minWidth: 720, width: graphWidth, height: graphHeight }}
            >
              <svg
                className="absolute inset-0 pointer-events-none"
                width={graphWidth}
                height={graphHeight}
                aria-hidden="true"
              >
                <defs>
                  <marker
                    id="case-step-arrow"
                    markerWidth="8"
                    markerHeight="8"
                    refX="7"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0,0 L8,4 L0,8 Z" fill="var(--accent-primary)" opacity="0.55" />
                  </marker>
                </defs>
                {steps.map((step, index) => {
                  const from =
                    index === 0 ? TRIGGER_RECT : rectOf(steps[index - 1]!.id);
                  return (
                    <path
                      key={`edge-${step.id}`}
                      d={edgePath(from, rectOf(step.id))}
                      fill="none"
                      stroke="var(--accent-primary)"
                      strokeOpacity="0.45"
                      strokeWidth="1.5"
                      markerEnd="url(#case-step-arrow)"
                    />
                  );
                })}
              </svg>

              {/* Manual start marker — the source every flow begins from. */}
              <div
                className="absolute rounded-lg border border-warning/30 bg-warning/10 px-3 py-2"
                style={{
                  left: TRIGGER_RECT.x,
                  top: TRIGGER_RECT.y,
                  width: TRIGGER_RECT.w,
                  height: TRIGGER_RECT.h,
                }}
              >
                <p className="text-[10px] font-bold tracking-wider uppercase text-warning">
                  Manual start
                </p>
                <p className="mt-1 text-[10px] text-muted leading-snug">
                  A run is created by an operator with case data.
                </p>
              </div>

              {steps.length === 0 && (
                <div
                  className="absolute w-80 border border-dashed border-subtle rounded-2xl p-6 bg-surface/80 text-center"
                  style={{ left: CANVAS_PAD, top: FIRST_ROW_Y }}
                >
                  <h3 className="text-sm font-semibold text-primary">No steps yet</h3>
                  <p className="text-xs text-muted mt-1 mb-3">
                    Every workflow starts with a review step.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setSteps([newStep("review")]);
                      setCatalogOpen(true);
                    }}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs"
                  >
                    <FiPlus className="w-4 h-4" />
                    Add first step
                  </button>
                </div>
              )}

              {steps.map((step, index) => {
                const meta = STEP_META[step.type];
                const Icon = meta.icon;
                const isSelected = selectedId === step.id;
                const point = positions[step.id] ?? defaultSlot(index);

                return (
                  <div
                    key={step.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Step ${index + 1}: ${step.name || "Untitled step"} — drag to arrange`}
                    onPointerDown={(event) => {
                      setSelectedId(step.id);
                      startDrag(event, step.id);
                    }}
                    onPointerMove={dragStep}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(step.id);
                      }
                    }}
                    style={{
                      left: point.x,
                      top: point.y,
                      width: NODE_W,
                      height: NODE_H,
                      touchAction: "none",
                    }}
                    className={`absolute select-none overflow-hidden rounded-xl border bg-surface p-3 shadow-sm text-left ${
                      canArrange ? "cursor-grab active:cursor-grabbing" : "cursor-default"
                    } ${
                      isSelected
                        ? "border-accent-primary/60 ring-1 ring-accent-primary/30"
                        : "border-subtle hover:border-strong"
                    } ${draggingId === step.id ? "shadow-lg z-20" : "z-10"} ${
                      draggingId === step.id ? "" : "transition-colors"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-mono text-faint">
                        STEP {index + 1}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.color}`}
                      >
                        <Icon className="w-3 h-3" />
                        {meta.label}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-primary truncate">
                      {step.name || "Untitled step"}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted line-clamp-2">
                      {step.description}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-faint">
                      {step.assignedRole && (
                        <span className="px-1.5 py-0.5 rounded bg-surface-hover border border-subtle">
                          role: {step.assignedRole}
                        </span>
                      )}
                      {step.channel && (
                        <span className="px-1.5 py-0.5 rounded bg-surface-hover border border-subtle">
                          via {step.channel}
                        </span>
                      )}
                      {step.acceptedFileTypes && step.acceptedFileTypes.length > 0 && (
                        <span className="px-1.5 py-0.5 rounded bg-surface-hover border border-subtle uppercase">
                          accepts {step.acceptedFileTypes.join("/")}
                        </span>
                      )}
                    </div>

                    {canArrange && (
                      <div
                        className="absolute bottom-1.5 right-1.5 flex gap-1"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => moveStep(index, -1)}
                          disabled={index === 0}
                          className="p-1 rounded border border-subtle bg-surface text-muted hover:text-primary disabled:opacity-30"
                          aria-label="Move step earlier"
                          title="Move earlier"
                        >
                          <FiChevronLeft className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(index, 1)}
                          disabled={index === steps.length - 1}
                          className="p-1 rounded border border-subtle bg-surface text-muted hover:text-primary disabled:opacity-30"
                          aria-label="Move step later"
                          title="Move later"
                        >
                          <FiChevronRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Step inspector */}
        <aside className="w-80 shrink-0 border-l border-subtle bg-surface overflow-y-auto">
          {selected ? (
            <div className="p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-primary">Step settings</h3>
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  className="p-1 text-muted hover:text-primary"
                  aria-label="Close step settings"
                >
                  <FiX className="w-4 h-4" />
                </button>
              </div>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Name
                </span>
                <input
                  value={selected.name}
                  onChange={(event) => patchStep(selected.id, { name: event.target.value })}
                  disabled={!editable}
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Type
                </span>
                <select
                  value={selected.type}
                  onChange={(event) => {
                    const type = event.target.value as StepType;
                    patchStep(selected.id, {
                      type,
                      channel: type === "notification" ? (selected.channel ?? "email") : undefined,
                      acceptedFileTypes:
                        type === "intake"
                          ? (selected.acceptedFileTypes ?? ["pdf", "jpg", "png"])
                          : undefined,
                      instruction:
                        type === "intake"
                          ? (selected.instruction ??
                            "Read the document and extract the facts the approver needs.")
                          : undefined,
                    });
                  }}
                  disabled={!editable}
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                >
                  {STEP_ORDER.map((type) => (
                    <option key={type} value={type}>
                      {STEP_META[type].label}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[10px] text-faint">{STEP_META[selected.type].blurb}</p>
              </label>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Description
                </span>
                <textarea
                  value={selected.description}
                  onChange={(event) =>
                    patchStep(selected.id, { description: event.target.value })
                  }
                  rows={4}
                  disabled={!editable}
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Assigned role (optional)
                </span>
                <select
                  value={selected.assignedRole ?? ""}
                  onChange={(event) =>
                    patchStep(selected.id, {
                      assignedRole: event.target.value || undefined,
                    })
                  }
                  disabled={!editable}
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                >
                  <option value="">No specific role</option>
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>

              {selected.type === "notification" && (
                <label className="block">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Channel
                  </span>
                  <select
                    value={selected.channel ?? "email"}
                    onChange={(event) =>
                      patchStep(selected.id, { channel: event.target.value })
                    }
                    disabled={!editable}
                    className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                  >
                    {CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>
                        {channel}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {selected.type === "intake" && (
                <>
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      Accepted files
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {FILE_TYPES.map((fileType) => {
                        const active = (selected.acceptedFileTypes ?? []).includes(fileType);
                        return (
                          <button
                            key={fileType}
                            type="button"
                            disabled={!editable}
                            onClick={() => {
                              const current = selected.acceptedFileTypes ?? [];
                              const next = active
                                ? current.filter((entry) => entry !== fileType)
                                : [...current, fileType];
                              patchStep(selected.id, {
                                acceptedFileTypes: next.length > 0 ? next : [fileType],
                              });
                            }}
                            className={`px-2 py-1 rounded border text-[10px] font-mono uppercase transition-colors disabled:opacity-60 ${
                              active
                                ? "border-accent-primary/50 bg-accent-primary/10 text-accent-primary"
                                : "border-subtle text-muted hover:border-strong"
                            }`}
                          >
                            {fileType}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                      What should the AI read?
                    </span>
                    <textarea
                      value={selected.instruction ?? ""}
                      onChange={(event) =>
                        patchStep(selected.id, { instruction: event.target.value })
                      }
                      rows={3}
                      placeholder="e.g. Extract the complaint reference, date, location and the requested remedy."
                      disabled={!editable}
                      className="mt-1 w-full bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs text-primary focus:outline-none focus:border-accent-primary/50 disabled:opacity-60"
                    />
                  </label>

                  <p className="rounded-lg border border-demo/30 bg-demo/10 px-3 py-2 text-[10px] text-demo leading-relaxed">
                    The run pauses here until an operator uploads one of these files.
                    The server extracts the text (PDF text layer or OCR) and the AI
                    reads it before the next step can run.
                  </p>
                </>
              )}

              <button
                type="button"
                onClick={() => removeStep(selected.id)}
                disabled={!editable}
                className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger/10 text-xs font-medium disabled:opacity-40"
              >
                <FiTrash2 className="w-3.5 h-3.5" />
                Remove step
              </button>

              <p className="text-[10px] text-faint leading-relaxed">
                Rules: the first step must be a review, an approval must follow a
                validation, and notification channels are limited to email and
                Telegram.
              </p>
            </div>
          ) : (
            <div className="p-5 text-xs text-muted space-y-3">
              <h3 className="text-sm font-semibold text-primary">Template</h3>
              <p>
                {steps.length} step{steps.length === 1 ? "" : "s"} in execution order.
                Select a step to edit it.
              </p>
              {template && (
                <div className="space-y-1.5 font-mono text-[10px] text-faint">
                  <p>id: {template.templateId}</p>
                  <p>origin: {template.origin}</p>
                  <p>created by: {template.createdBy?.slice(0, 12) ?? "—"}</p>
                  <p>updated: {formatDateTime(template.updatedAt)}</p>
                </div>
              )}
              {template && can("template:deactivate") && template.reviewStatus === "APPROVED" && (
                <button
                  type="button"
                  onClick={() => void toggleActive()}
                  className="w-full px-3 py-1.5 rounded-lg border border-strong text-[11px] text-secondary hover:bg-surface-hover"
                >
                  {template.isActive ? "Deactivate template" : "Activate template"}
                </button>
              )}
              {template?.reviewStatus === "PENDING" && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning flex items-start gap-2">
                  <FiInfo className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>
                    Pending review
                    {template.reviewComments ? `: ${template.reviewComments}` : "."} An
                    operator or admin must approve it before it can run.
                  </span>
                </div>
              )}
              {template?.reviews && template.reviews.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">
                    Review history
                  </h4>
                  <ul className="space-y-1">
                    {template.reviews.map((review) => (
                      <li
                        key={review.reviewId}
                        className="flex items-center justify-between gap-2 text-[10px] text-muted"
                      >
                        <span
                          className={`px-1.5 py-0.5 rounded border ${
                            review.status === "APPROVED"
                              ? "border-success/30 text-success bg-success/10"
                              : review.status === "REJECTED"
                                ? "border-danger/30 text-danger bg-danger/10"
                                : "border-warning/30 text-warning bg-warning/10"
                          }`}
                        >
                          {review.status}
                        </span>
                        <span className="truncate">
                          {review.reviewedBy ? review.reviewedBy.slice(0, 10) : "system"}
                        </span>
                        <span className="font-mono">{formatDateTime(review.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {/* Footer identity (who is saving) */}
      {member && (
        <div className="h-8 shrink-0 border-t border-subtle bg-surface px-4 flex items-center justify-between text-[10px] text-faint">
          <span>
            Acting as {member.displayName} ({initials(member.displayName)})
          </span>
          <span>
            {canEdit ? "edit allowed" : "read-only"} · server enforces permissions
          </span>
        </div>
      )}

      {/* Add-step catalog */}
      {catalogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-subtle flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">Add a step</h3>
              <button
                type="button"
                onClick={() => setCatalogOpen(false)}
                className="p-1 text-muted hover:text-primary"
                aria-label="Close catalog"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STEP_ORDER.map((type) => {
                const meta = STEP_META[type];
                const Icon = meta.icon;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      const step = newStep(type);
                      setSteps((current) => [...current, step]);
                      setSelectedId(step.id);
                      setCatalogOpen(false);
                    }}
                    className="text-left p-3 rounded-xl border border-subtle hover:border-accent-primary/50 hover:bg-surface-hover/60 transition-colors"
                  >
                    <span
                      className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-medium ${meta.color}`}
                    >
                      <Icon className="w-3 h-3" />
                      {meta.label}
                    </span>
                    <p className="mt-2 text-[11px] text-muted">{meta.blurb}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Rename */}
      {renameOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Rename template</h3>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoFocus
              className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent-primary/50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setRenameOpen(false);
                  void save();
                }}
                className="px-3 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold"
              >
                Save name
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reject with reason */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Reject template</h3>
            <p className="text-[11px] text-muted">
              A rejection must carry a reason. The template stays inactive.
            </p>
            <textarea
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              rows={3}
              autoFocus
              className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-danger/50"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void reject()}
                disabled={!rejectReason.trim() || busy}
                className="px-3 py-1.5 rounded-lg bg-danger text-white text-xs font-semibold disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start run */}
      {runOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-lg shadow-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary">Start a run</h3>
            <p className="text-[11px] text-muted">
              Case data feeds the document steps. Only approved, active templates
              can run.
            </p>
            <div className="space-y-2">
              {runRows.map((row, index) => (
                <div key={index} className="flex gap-2">
                  <input
                    value={row.key}
                    placeholder="field, e.g. complainant"
                    onChange={(event) =>
                      setRunRows((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, key: event.target.value } : entry,
                        ),
                      )
                    }
                    className="w-40 bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={row.value}
                    placeholder="value"
                    onChange={(event) =>
                      setRunRows((current) =>
                        current.map((entry, i) =>
                          i === index ? { ...entry, value: event.target.value } : entry,
                        ),
                      )
                    }
                    className="flex-1 bg-background border border-subtle rounded-lg px-2.5 py-1.5 text-xs"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-between gap-2">
              <button
                type="button"
                onClick={() =>
                  setRunRows((current) => [...current, { key: "", value: "" }])
                }
                className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
              >
                Add field
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRunOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void startRun()}
                  disabled={busy || !templateId}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold disabled:opacity-50"
                >
                  <FiPlay className="w-3.5 h-3.5" />
                  Start run
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowEditor;
