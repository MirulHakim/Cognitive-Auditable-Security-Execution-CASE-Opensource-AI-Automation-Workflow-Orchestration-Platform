/* Shapes returned by the CASE workflow API (template-module/server). */

export type StepType =
  | "review"
  | "validation"
  | "approval"
  | "intake"
  | "document"
  | "notification";

/** File kinds an intake step may require. */
export type FileType = "pdf" | "jpg" | "jpeg" | "png";
export type Origin = "MANUAL" | "AI_DRAFTED";
export type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";
export type Role = "admin" | "operator" | "auditor";

/** The UI groups roles into three labels; staff == operator. */
export type UiRole = "admin" | "staff" | "auditor";

export interface Member {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  revokedAt: string | null;
}

export interface Me {
  operator: Member;
  permissions: string[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  description: string;
  assignedRole?: string;
  channel?: string;
  /** intake only — which uploads the step accepts. */
  acceptedFileTypes?: FileType[];
  /** intake only — what the AI should read from the upload. */
  instruction?: string;
  /** Canvas arrangement from the step editor; execution order stays array order. */
  position?: { x: number; y: number };
}

export interface Review {
  reviewId: string;
  templateId: string;
  status: ReviewStatus;
  reviewedBy: string | null;
  comments: string | null;
  createdAt: string;
}

export interface Template {
  templateId: string;
  name: string;
  version: number;
  steps: WorkflowStep[];
  origin: Origin;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  reviewStatus: ReviewStatus;
  reviewedBy: string | null;
  reviewComments: string | null;
  reviewedAt: string | null;
  reviews?: Review[];
}

export type InstanceStatus = "RUNNING" | "PAUSED" | "COMPLETED" | "REJECTED" | "CANCELLED";
export type StepRunStatus = "COMPLETED" | "APPROVED" | "REJECTED" | "SIMULATED" | "FAILED";

export interface WorkflowInstance {
  instanceId: string;
  templateId: string;
  templateName: string;
  templateVersion: number;
  steps: WorkflowStep[];
  status: InstanceStatus;
  currentStep: string | null;
  cursorIndex: number;
  input: Record<string, string>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StepRun {
  runId: string;
  instanceId: string;
  stepId: string;
  stepType: StepType;
  status: StepRunStatus;
  performedBy: string | null;
  result: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
}

export interface PendingApproval {
  kind: "approval";
  instanceId: string;
  stepNumber: number;
  totalSteps: number;
  step: WorkflowStep;
}

/** A run paused at an intake step: it needs a readable PDF/JPG to continue. */
export interface PendingIntake {
  kind: "intake";
  instanceId: string;
  stepNumber: number;
  totalSteps: number;
  step: WorkflowStep;
  acceptedFileTypes: string[];
  instruction: string | null;
}

export type PendingGate = PendingApproval | PendingIntake;

export interface InstanceDetail {
  instance: WorkflowInstance;
  stepRuns: StepRun[];
  /** Either gate a PAUSED run is waiting on, or null. */
  pendingApproval: PendingGate | null;
}

/* ---------------- audit trail ---------------- */

export type AuditOutcome = "SUCCESS" | "FAILURE" | "PENDING";

export interface AuditEvent {
  id: string;
  sequence: number;
  recordedAt: string;
  actorId: string;
  actorRole: "admin" | "operator" | "auditor" | "system";
  action: string;
  targetType: string;
  targetId: string;
  outcome: AuditOutcome;
  details: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export interface AuditPage {
  events: AuditEvent[];
  total: number;
  limit: number;
  offset: number;
}

export interface AuditVerification {
  verified: boolean;
  checked: number;
  brokenAt: number | null;
  checkedAt: string;
  headHash: string;
}

export interface ApiErrorDetails {
  structural?: { path: string; message: string; code: string }[];
  businessRules?: { rule: string; message: string; stepId?: string }[];
  reviewStatus?: ReviewStatus;
  requiredPermission?: string;
  reason?: string;
  instanceStatus?: InstanceStatus;
}
