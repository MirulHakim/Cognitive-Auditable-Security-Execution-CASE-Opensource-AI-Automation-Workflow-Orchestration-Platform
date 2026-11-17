import type { AuditEventInput, AuditRecorder } from "../audit/auditLog.js";
import type { Role } from "../auth/operators.js";
import type { DeliveryChannel } from "./mailer.js";
import { hashEmail } from "./tokens.js";

/**
 * Audit consumer for the auth gateway.
 *
 * The zero-modification rule means this module may CALL the existing audit
 * writer but may not change it. `PostgresAuditLog` owns serialisation under its
 * advisory lock, canonicalisation of details, and the SHA-256 chain; we only
 * hand it plain JSON-safe primitives.
 *
 * Payload rules honoured here (matching both backends' conventions):
 *  - strings, booleans and integers only — no Date, float, undefined or Buffer;
 *  - timestamps are ISO-8601 strings;
 *  - no raw email, token, password or secret in details, and no key whose name
 *    is or ends with token/secret/password/api_key/credentials;
 *  - failure details carry a stable `reason_code`, not a free-text message.
 */

export type AuthAuditAction =
  | "ROOT_ADMIN_INITIALIZED"
  | "OPERATOR_INVITED"
  | "OPERATOR_INVITATION_WITHDRAWN"
  | "INVITATION_ACCEPTED"
  | "AUTHENTICATION_SUCCESS"
  | "AUTHENTICATION_FAILED"
  | "AUTHENTICATION_LOGOUT"
  | "OPERATOR_REVOKED";

export interface AuthAuditor {
  rootAdminInitialized(input: {
    operatorId: string;
    role: Role;
    workspaceId: string;
  }): void;
  operatorInvited(input: {
    actorId: string;
    actorRole: Role;
    invitationId: string;
    email: string;
    role: Role;
    expiresAt: Date;
    delivery: "SENT" | "FAILED";
    /** Which transport carried (or failed to carry) the invitation. */
    channel: DeliveryChannel;
  }): void;
  /** An admin withdrew a still-pending invitation; its magic link is dead. */
  invitationWithdrawn(input: {
    actorId: string;
    actorRole: Role;
    invitationId: string;
    email: string;
    role: Role;
    workspaceId: string;
  }): void;
  invitationAccepted(input: {
    invitationId: string;
    operatorId: string;
    role: Role;
    workspaceId: string;
  }): void;
  authenticationSucceeded(input: {
    operatorId: string;
    role: Role;
    email: string;
    workspaceId: string;
  }): void;
  authenticationFailed(input: {
    reasonCode: string;
    email?: string | null;
    operator?: { id: string; role: Role } | null;
    workspaceId: string;
  }): void;
  /** Explicit sign-out only — never heartbeat or presence transitions. */
  authenticationLogout(input: {
    operatorId: string;
    role: Role;
    workspaceId: string;
  }): void;
  operatorRevoked(input: {
    actorId: string;
    actorRole: Role;
    operatorId: string;
    role: Role;
    email: string;
    reasonCode: string;
    accountsDeleted: number;
    refreshTokensDeleted: number;
    invitationsUnlinked: number;
    workspaceId: string;
  }): void;
}

export function createAuthAuditor(
  recorder: AuditRecorder | undefined,
  workspaceId: string,
): AuthAuditor {
  const emit = (input: AuditEventInput): void => {
    if (!recorder) return;
    void recorder.record(input).catch((error: unknown) => {
      // The action already happened. Authentication must not fail because the
      // audit trail is momentarily unavailable; the existing writer takes the
      // same best-effort stance at call sites.
      console.error(
        "[auth-gateway][audit] could not record",
        input.action,
        error instanceof Error ? error.message : error,
      );
    });
  };

  return {
    rootAdminInitialized({ operatorId, role, workspaceId: workspace }) {
      emit({
        actorId: "system",
        actorRole: "system",
        action: "ROOT_ADMIN_INITIALIZED",
        targetType: "operator",
        targetId: operatorId,
        outcome: "SUCCESS",
        details: {
          operator_id: operatorId,
          role,
          workspace_id: workspace,
          bootstrap: true,
        },
      });
    },

    operatorInvited({
      actorId,
      actorRole,
      invitationId,
      email,
      role,
      expiresAt,
      delivery,
      channel,
    }) {
      emit({
        actorId,
        actorRole,
        action: "OPERATOR_INVITED",
        targetType: "invitation",
        targetId: invitationId,
        outcome: delivery === "SENT" ? "SUCCESS" : "FAILURE",
        details: {
          invitation_id: invitationId,
          email_hash: hashEmail(email),
          role,
          expires_at: expiresAt.toISOString(),
          delivery,
          // Primitive string, like the other detail values: canonicalisation
          // (sorted keys, ISO timestamps, no PII) is unaffected.
          channel,
          workspace_id: workspaceId,
        },
      });
    },

    invitationWithdrawn({
      actorId,
      actorRole,
      invitationId,
      email,
      role,
      workspaceId: workspace,
    }) {
      emit({
        actorId,
        actorRole,
        action: "OPERATOR_INVITATION_WITHDRAWN",
        targetType: "invitation",
        targetId: invitationId,
        outcome: "SUCCESS",
        details: {
          invitation_id: invitationId,
          email_hash: hashEmail(email),
          role,
          reason_code: "ADMIN_WITHDREW_INVITATION",
          workspace_id: workspace,
        },
      });
    },

    invitationAccepted({ invitationId, operatorId, role, workspaceId: workspace }) {
      emit({
        // Acceptance happens before the invitee has a session.
        actorId: "system",
        actorRole: "system",
        action: "INVITATION_ACCEPTED",
        targetType: "operator",
        targetId: operatorId,
        outcome: "SUCCESS",
        details: {
          invitation_id: invitationId,
          operator_id: operatorId,
          role,
          workspace_id: workspace,
        },
      });
    },

    authenticationSucceeded({ operatorId, role, email, workspaceId: workspace }) {
      emit({
        actorId: operatorId,
        actorRole: role,
        action: "AUTHENTICATION_SUCCESS",
        targetType: "session",
        targetId: operatorId,
        outcome: "SUCCESS",
        details: {
          provider: "google",
          email_hash: hashEmail(email),
          workspace_id: workspace,
        },
      });
    },

    authenticationFailed({ reasonCode, email, operator, workspaceId: workspace }) {
      emit({
        actorId: operator?.id ?? "anonymous",
        actorRole: operator?.role ?? "system",
        action: "AUTHENTICATION_FAILED",
        targetType: "auth",
        targetId: "google",
        outcome: "FAILURE",
        details: {
          provider: "google",
          reason_code: reasonCode,
          ...(email ? { email_hash: hashEmail(email) } : {}),
          workspace_id: workspace,
        },
      });
    },

    authenticationLogout({ operatorId, role, workspaceId: workspace }) {
      emit({
        actorId: operatorId,
        actorRole: role,
        action: "AUTHENTICATION_LOGOUT",
        targetType: "session",
        targetId: operatorId,
        outcome: "SUCCESS",
        details: {
          operator_id: operatorId,
          session_revoked: true,
          workspace_id: workspace,
        },
      });
    },

    operatorRevoked({
      actorId,
      actorRole,
      operatorId,
      role,
      email,
      reasonCode,
      accountsDeleted,
      refreshTokensDeleted,
      invitationsUnlinked,
      workspaceId: workspace,
    }) {
      emit({
        actorId,
        actorRole,
        action: "OPERATOR_REVOKED",
        targetType: "operator",
        targetId: operatorId,
        outcome: "SUCCESS",
        details: {
          operator_id: operatorId,
          role,
          // Hashed like every other email detail: no raw PII in the chain.
          email_hash: hashEmail(email),
          reason_code: reasonCode,
          // Integers only (no floats/objects), so canonicalisation is stable.
          accounts_deleted: accountsDeleted,
          refresh_tokens_deleted: refreshTokensDeleted,
          invitations_unlinked: invitationsUnlinked,
          workspace_id: workspace,
        },
      });
    },
  };
}
