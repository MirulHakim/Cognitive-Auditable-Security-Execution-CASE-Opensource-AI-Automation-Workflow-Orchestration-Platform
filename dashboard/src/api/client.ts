import type {
  ApiErrorDetails,
  AuditEvent,
  AuditPage,
  AuditOutcome,
  AuditVerification,
  InstanceDetail,
  Me,
  Member,
  Template,
  WorkflowInstance,
} from "./types";

/**
 * Same-origin by default: the Vite dev server proxies `/api` to the workflow
 * API (see vite.config.ts). Set VITE_API_BASE to call a different origin.
 */
const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

/** "Signed in" identity: a member id or a whitelisted email. */
const IDENTITY_KEY = "case.identity";

export const DEMO_IDENTITIES: { identifier: string; label: string; role: string }[] = [
  { identifier: "aisyah@workspace.local", label: "Aisyah — Admin", role: "admin" },
  { identifier: "aiman@workspace.local", label: "Aiman — Operator", role: "operator" },
  { identifier: "chong@workspace.local", label: "Chong — Auditor", role: "auditor" },
];

export function getIdentity(): string | null {
  return localStorage.getItem(IDENTITY_KEY);
}

export function setIdentity(identifier: string): void {
  localStorage.setItem(IDENTITY_KEY, identifier);
}

export function clearIdentity(): void {
  localStorage.removeItem(IDENTITY_KEY);
}

/** Error carrying the server's structured payload so the UI can render it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: ApiErrorDetails;

  constructor(status: number, code: string, message: string, details: ApiErrorDetails) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Human-readable message for anything thrown by the client. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const identity = getIdentity();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (identity) headers["x-operator-id"] = identity;

  const response = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Request failed (${response.status}).`,
      error?.details ?? {},
    );
  }
  return payload as T;
}

/* ---------------- session & members ---------------- */

export function getMe(): Promise<Me> {
  return request<Me>("/api/operators/me");
}

export async function listMembers(): Promise<Member[]> {
  const payload = await request<{ operators: Member[] }>("/api/operators");
  return payload.operators;
}

/** Admin only: whitelist an email. Re-inviting a revoked email restores it. */
export async function addMember(body: {
  email: string;
  displayName?: string;
  role: "operator" | "auditor";
}): Promise<Member> {
  const payload = await request<{ operator: Member }>("/api/operators", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return payload.operator;
}

/** Admin only: remove access (soft delete; history is kept). */
export async function revokeMember(id: string): Promise<Member> {
  const payload = await request<{ operator: Member }>(
    `/api/operators/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  return payload.operator;
}

/** Admin only: switch a member between operator and auditor. */
export async function setMemberRole(
  id: string,
  role: "operator" | "auditor",
): Promise<Member> {
  const payload = await request<{ operator: Member }>(
    `/api/operators/${encodeURIComponent(id)}/role`,
    { method: "PATCH", body: JSON.stringify({ role }) },
  );
  return payload.operator;
}

/* ---------------- templates ---------------- */

export interface TemplateFilters {
  origin?: string;
  status?: string;
  is_active?: string;
}

export async function listTemplates(filters: TemplateFilters = {}): Promise<Template[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  const payload = await request<{ templates: Template[] }>(
    `/api/templates${query ? `?${query}` : ""}`,
  );
  return payload.templates;
}

export async function getTemplate(id: string): Promise<Template> {
  const payload = await request<{ template: Template }>(`/api/templates/${id}`);
  return payload.template;
}

export async function createTemplate(body: {
  name: string;
  steps: unknown[];
}): Promise<Template> {
  const payload = await request<{ template: Template }>("/api/templates", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return payload.template;
}

export async function updateTemplate(
  id: string,
  body: { name?: string; steps?: unknown[] },
): Promise<Template> {
  const payload = await request<{ template: Template }>(`/api/templates/${id}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return payload.template;
}

/**
 * Drafts a template from a natural-language request. When the request is too
 * vague the AI answers with a clarifying question instead of inventing a
 * workflow, so callers must handle both outcomes.
 */
export type GenerateResult =
  | { kind: "template"; template: Template }
  | { kind: "clarification"; question: string };

export async function generateTemplate(prompt: string): Promise<GenerateResult> {
  const payload = await request<
    { template: Template } | { needsClarification: true; question: string }
  >("/api/templates/generate", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  });

  if ("needsClarification" in payload) {
    return { kind: "clarification", question: payload.question };
  }
  return { kind: "template", template: payload.template };
}

export async function approveTemplate(id: string, comments?: string): Promise<Template> {
  const payload = await request<{ template: Template }>(
    `/api/templates/${id}/approve`,
    { method: "POST", body: JSON.stringify({ comments }) },
  );
  return payload.template;
}

export async function rejectTemplate(id: string, comments: string): Promise<Template> {
  const payload = await request<{ template: Template }>(
    `/api/templates/${id}/reject`,
    { method: "POST", body: JSON.stringify({ comments }) },
  );
  return payload.template;
}

/** Re-enable a deactivated template that is still APPROVED. */
export async function activateTemplate(id: string): Promise<Template> {
  const payload = await request<{ template: Template }>(
    `/api/templates/${id}/activate`,
    { method: "POST" },
  );
  return payload.template;
}

/** Soft deactivation — never a physical delete. */
export async function deactivateTemplate(id: string): Promise<Template> {
  const payload = await request<{ template: Template }>(`/api/templates/${id}`, {
    method: "DELETE",
  });
  return payload.template;
}

/* ---------------- runs ---------------- */

export interface InstanceFilters {
  status?: string;
  template_id?: string;
}

export async function listInstances(
  filters: InstanceFilters = {},
): Promise<WorkflowInstance[]> {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  const query = params.toString();
  const payload = await request<{ instances: WorkflowInstance[] }>(
    `/api/instances${query ? `?${query}` : ""}`,
  );
  return payload.instances;
}

export function getInstance(id: string): Promise<InstanceDetail> {
  return request<InstanceDetail>(`/api/instances/${id}`);
}

export function startInstance(body: {
  templateId: string;
  input?: Record<string, string>;
}): Promise<InstanceDetail> {
  return request<InstanceDetail>("/api/instances", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function respondInstance(
  id: string,
  body: { approved: boolean; comments?: string },
): Promise<InstanceDetail> {
  return request<InstanceDetail>(`/api/instances/${id}/respond`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function cancelInstance(id: string): Promise<InstanceDetail> {
  return request<InstanceDetail>(`/api/instances/${id}/cancel`, { method: "POST" });
}

/**
 * Uploads the PDF/JPG an intake step is waiting for. The server reads the file
 * and only then resumes the run, so a successful response means the file was
 * readable. The browser must not set content-type: multipart needs a boundary.
 */
export async function uploadIntake(
  instanceId: string,
  file: File,
): Promise<InstanceDetail> {
  const identity = getIdentity();
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${BASE}/api/instances/${instanceId}/intake`, {
    method: "POST",
    headers: identity ? { "x-operator-id": identity } : {},
    body,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `The file could not be read (${response.status}).`,
      error?.details ?? {},
    );
  }
  return payload as InstanceDetail;
}

/**
 * Opens the file a `document` step produced. Fetched with the identity header
 * (a plain link would drop it), then shown via a blob URL.
 */
export async function openInstanceDocument(
  instanceId: string,
  stepId: string,
): Promise<void> {
  const identity = getIdentity();
  const response = await fetch(
    `${BASE}/api/instances/${instanceId}/documents/${stepId}`,
    { headers: identity ? { "x-operator-id": identity } : {} },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const error = payload?.error;
    throw new ApiError(
      response.status,
      error?.code ?? "UNKNOWN",
      error?.message ?? `Could not open the document (${response.status}).`,
      error?.details ?? {},
    );
  }

  const url = URL.createObjectURL(await response.blob());
  const opened = window.open(url, "_blank", "noopener");
  if (!opened) {
    URL.revokeObjectURL(url);
    throw new ApiError(
      0,
      "POPUP_BLOCKED",
      "The browser blocked the document tab — allow popups for this site and try again.",
      {},
    );
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/* ---------------- audit trail ---------------- */

export async function listAuditEvents(
  options: {
    limit?: number;
    offset?: number;
    action?: string;
    outcome?: AuditOutcome;
    actor?: string;
  } = {},
): Promise<AuditPage> {
  const params = new URLSearchParams();
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== "") params.set(key, String(value));
  });
  const query = params.toString();
  return request<AuditPage>(`/api/audit${query ? `?${query}` : ""}`);
}

export async function getAuditEvent(id: string): Promise<AuditEvent> {
  const payload = await request<{ event: AuditEvent }>(
    `/api/audit/events/${encodeURIComponent(id)}`,
  );
  return payload.event;
}

export function verifyAudit(): Promise<AuditVerification> {
  return request<AuditVerification>("/api/audit/verify", { method: "POST" });
}
