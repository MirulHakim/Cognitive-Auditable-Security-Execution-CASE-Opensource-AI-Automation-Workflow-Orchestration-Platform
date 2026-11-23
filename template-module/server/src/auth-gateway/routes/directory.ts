import type { RequestHandler } from "express";
import type { Role } from "../../auth/operators.js";
import type { AuthGatewayConfig } from "../config.js";
import { asyncHandler, GatewayError } from "../errors.js";
import { invitationStatus } from "../invitations.js";
import { displayNameFromEmail } from "../names.js";
import type { AuthStore, InvitationRecord } from "../store.js";

/**
 * GET /api/operators — one directory for active members and pending invites.
 *
 * The legacy route remains the source of truth for real members; the gateway
 * only reads it over HTTP and merges its own `auth_invitations` table into the
 * response. Neither backend learns that invitations exist.
 *
 * Pending entries are visible to admins only: an invitee's address is personnel
 * data, and the legacy directory is readable by every signed-in member. The
 * merged shape is additive — every legacy field is preserved, plus `status`,
 * `isPending`, `invitationId`, `invitedAt` and `expiresAt`.
 */

const LEGACY_DIRECTORY_TIMEOUT_MS = 10_000;

/** The subset of the legacy member shape the gateway relies on. */
interface LegacyMember {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  revokedAt: string | null;
  [key: string]: unknown;
}

export interface PendingDirectoryMember {
  /** Prefixed so it can never collide with a real operator id. */
  id: string;
  displayName: string;
  email: string;
  role: Role;
  revokedAt: null;
  status: "pending";
  isPending: true;
  invitationId: string;
  invitedBy: string | null;
  invitedAt: string;
  expiresAt: string;
}

function isLegacyMember(value: unknown): value is LegacyMember {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.email === "string" &&
    typeof entry.role === "string"
  );
}

function toPending(invitation: InvitationRecord): PendingDirectoryMember {
  return {
    id: `invitation:${invitation.invitationId}`,
    // Same derivation acceptance uses, so the name does not change on accept.
    displayName: displayNameFromEmail(invitation.email),
    email: invitation.email,
    role: invitation.role,
    revokedAt: null,
    status: "pending",
    isPending: true,
    invitationId: invitation.invitationId,
    invitedBy: invitation.invitedBy,
    invitedAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
  };
}

async function fetchLegacyMembers(
  config: AuthGatewayConfig,
  operatorId: string,
  doFetch: typeof fetch,
): Promise<LegacyMember[]> {
  if (!config.nodeApiUrl) {
    throw new GatewayError(
      503,
      "UPSTREAM_NOT_CONFIGURED",
      "This API route has no configured backend.",
    );
  }

  try {
    const response = await doFetch(`${config.nodeApiUrl}/api/operators`, {
      headers: {
        accept: "application/json",
        // The legacy API authenticates this header. The value comes from the
        // gateway's verified session, never from the browser.
        "x-operator-id": operatorId,
      },
      signal: AbortSignal.timeout(LEGACY_DIRECTORY_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`legacy directory responded ${response.status}`);
    }
    const payload = (await response.json()) as { operators?: unknown };
    if (!Array.isArray(payload.operators)) {
      throw new Error("legacy directory response had no operators array");
    }
    return payload.operators.filter(isLegacyMember);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[auth-gateway][directory] legacy members unavailable:", message);
    throw new GatewayError(
      502,
      "DIRECTORY_UNAVAILABLE",
      "The member directory could not be loaded. Try again shortly.",
      { upstream: "operators", reason: message },
    );
  }
}

export function createDirectoryHandler(deps: {
  config: AuthGatewayConfig;
  store: AuthStore;
  now?: () => Date;
  /** Injection point for tests; production uses global fetch. */
  fetchImpl?: typeof fetch;
}): RequestHandler {
  const now = deps.now ?? (() => new Date());
  const doFetch = deps.fetchImpl ?? fetch;

  return asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (!auth) {
      throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const members = await fetchLegacyMembers(deps.config, auth.operator.id, doFetch);

    // Revoked rows stay in the legacy list for history; `status` makes the
    // lifecycle explicit without changing any existing field.
    const active = members.map((entry) => ({
      ...entry,
      status: entry.revokedAt ? ("revoked" as const) : ("active" as const),
      isPending: false as const,
    }));

    let pending: PendingDirectoryMember[] = [];
    let pendingUnavailable = false;
    if (auth.operator.role === "admin") {
      try {
        const at = now();
        const knownEmails = new Set(members.map((entry) => entry.email.toLowerCase()));
        const seen = new Set<string>();
        pending = (await deps.store.listInvitations(200))
          .filter((invitation) => invitation.workspaceId === deps.config.workspaceId)
          .filter((invitation) => invitationStatus(invitation, at) === "PENDING")
          // A consumed invite becomes an operator; a race between acceptance
          // and this read must not list the same person twice.
          .filter((invitation) => {
            const email = invitation.email.toLowerCase();
            if (knownEmails.has(email) || seen.has(email)) return false;
            seen.add(email);
            return true;
          })
          .map(toPending);
      } catch (error) {
        // The active directory is still useful; surface the partial result
        // instead of failing the whole page.
        pendingUnavailable = true;
        console.error(
          "[auth-gateway][directory] pending invitations unavailable:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    const operators = [...pending, ...active];
    res.setHeader("cache-control", "private, no-store");
    res.json({
      operators,
      count: operators.length,
      pendingCount: pending.length,
      ...(pendingUnavailable ? { pendingUnavailable: true } : {}),
    });
  });
}
