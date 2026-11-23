import type { Invitation, Member, Role, UiRole } from "../api/types";

/** The three labels the UI shows: operator is "staff" in this design. */
export function uiRole(role: Role): UiRole {
  return role === "operator" ? "staff" : role;
}

export function roleLabel(role: Role): string {
  return role === "operator" ? "Staff (operator)" : role === "admin" ? "Admin" : "Auditor";
}

/** "farid.hakim@agency.gov.my" → "Farid Hakim" (matches the gateway). */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return email;
  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Optimistic directory row for a just-sent invitation, so the admin sees the
 * person as Pending immediately instead of waiting for the next directory read.
 */
export function pendingMemberFromInvitation(invitation: Invitation): Member {
  return {
    id: `invitation:${invitation.invitationId}`,
    displayName: displayNameFromEmail(invitation.email),
    email: invitation.email,
    role: invitation.role,
    revokedAt: null,
    status: "pending",
    isPending: true,
    invitationId: invitation.invitationId,
    invitedBy: invitation.invitedBy,
    invitedAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
  };
}

export function initials(name: string): string {
  const parts = name
    .replace(/\(.*?\)/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

export function displayNameFor(members: Member[], id: string | null): string {
  if (!id) return "—";
  const member = members.find(
    (entry) => entry.id === id || entry.email.toLowerCase() === id.toLowerCase(),
  );
  return member ? member.displayName : id.slice(0, 8);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return formatDateTime(iso).split(",")[0] ?? iso;
}

export function shortHash(hash: string): string {
  if (hash.length <= 18) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

/** "TEMPLATE_APPROVED" → "Template approved". */
export function humanizeAction(action: string): string {
  const text = action.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
