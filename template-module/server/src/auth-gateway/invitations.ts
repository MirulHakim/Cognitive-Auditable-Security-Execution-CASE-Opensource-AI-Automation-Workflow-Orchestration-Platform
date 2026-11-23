import type { Role } from "../auth/operators.js";
import type { AuthAuditor } from "./audit.js";
import type { AuthGatewayConfig } from "./config.js";
import { GatewayError } from "./errors.js";
import {
  MailDeliveryError,
  type DeliveryChannel,
  type InvitationMail,
  type Mailer,
} from "./mailer.js";
import type { AuthStore, ClaimInvitationResult, InvitationRecord } from "./store.js";
import { newOpaqueToken, normalizeEmail, sha256Hex } from "./tokens.js";

export type InvitableRole = "operator" | "auditor";

export interface CreatedInvitation {
  invitation: InvitationRecord;
  magicLink: string;
  delivered: boolean;
  channel: DeliveryChannel;
}

export interface InvitationService {
  create(input: {
    email: string;
    role: InvitableRole;
    /** The signed-in admin performing the action; the audit trail names them. */
    actor: { id: string; role: Role; email: string; displayName: string };
    workspaceId: string;
  }): Promise<CreatedInvitation>;
  accept(token: string): Promise<ClaimInvitationResult>;
  list(): Promise<InvitationRecord[]>;
  /**
   * Withdraws a pending invitation so its magic link stops working at once.
   * The row is kept (revoked_at), preserving the admin action for the audit
   * trail; only a never-accepted invitation can be withdrawn.
   */
  withdraw(input: {
    invitationId: string;
    actor: { id: string; role: Role };
    workspaceId: string;
  }): Promise<InvitationRecord>;
}

/**
 * Translate a delivery failure into an HTTP-shaped error the dashboard can act on.
 * The invitation itself is already revoked by the time this runs. The process
 * stays up: SMTP being down or misconfigured is an operational condition, not a
 * reason to crash the gateway.
 */
function deliveryError(error: unknown): GatewayError {
  if (error instanceof GatewayError) return error;
  if (error instanceof MailDeliveryError) {
    switch (error.code) {
      case "SMTP_NOT_CONFIGURED":
        return new GatewayError(
          503,
          "INVITATION_EMAIL_NOT_CONFIGURED",
          "Invitation email is not configured on this server. Set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS (Gmail needs an App Password).",
        );
      case "SMTP_AUTH_FAILED":
        return new GatewayError(
          502,
          "INVITATION_EMAIL_AUTH_FAILED",
          "The mail server rejected the CASE system account's credentials. Check SMTP_USER and SMTP_PASS; a normal Gmail password will not work — use a 16-character App Password.",
        );
      case "SMTP_CONNECTION_FAILED":
        return new GatewayError(
          502,
          "INVITATION_EMAIL_UNREACHABLE",
          "The invitation mail server could not be reached. Check SMTP_HOST, SMTP_PORT and the server's outbound network access.",
        );
      default:
        return new GatewayError(
          502,
          "INVITATION_EMAIL_FAILED",
          "The invitation was created but the mail server refused to send it. Check the gateway log and the SMTP settings, then try again.",
        );
    }
  }
  return new GatewayError(
    502,
    "INVITATION_EMAIL_FAILED",
    "The invitation was created but the email could not be sent. Check the mail settings and try again.",
  );
}

export function createInvitationService(deps: {
  config: AuthGatewayConfig;
  store: AuthStore;
  /** Dedicated CASE system mailbox. Invitations never use an admin's Gmail. */
  mailer: Mailer;
  audit: AuthAuditor;
  now?: () => Date;
}): InvitationService {
  const now = deps.now ?? (() => new Date());

  return {
    async create({ email, role, actor, workspaceId }) {
      const normalized = normalizeEmail(email);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
        throw new GatewayError(400, "INVALID_EMAIL", "Enter a valid email address.");
      }
      if (role !== "operator" && role !== "auditor") {
        throw new GatewayError(400, "INVALID_ROLE", "Invitations are limited to operator or auditor.");
      }

      const existing = await deps.store.findOperatorByEmail(normalized);
      if (existing) {
        throw new GatewayError(
          409,
          "ALREADY_MEMBER",
          existing.revokedAt
            ? "That address belongs to a revoked member; restore the member instead."
            : "That email is already a member of this workspace.",
        );
      }

      const token = newOpaqueToken();
      const createdAt = now();
      const expiresAt = new Date(
        createdAt.getTime() + deps.config.invitation.ttlMinutes * 60_000,
      );
      const invitation = await deps.store.createInvitation({
        email: normalized,
        role,
        invitedBy: actor.id,
        workspaceId,
        tokenHash: sha256Hex(token),
        createdAt,
        expiresAt,
      });
      const magicLink = `${deps.config.publicUrl}/api/invitations/accept?token=${encodeURIComponent(token)}`;
      const mail: InvitationMail = {
        to: normalized,
        magicLink,
        role,
        expiresAt,
        expiresInMinutes: deps.config.invitation.ttlMinutes,
        appName: deps.config.invitation.appName,
      };

      // The token is already stored as a SHA-256 digest before any network I/O.
      // The CASE system mailbox is the only sender: delivery never depends on
      // the inviting admin's Google grant.
      let channel: DeliveryChannel = "SMTP";
      try {
        const result = await deps.mailer.sendInvitation(mail);
        channel = result.transport;
      } catch (error) {
        // Delivery failed, so the invitation must not stay valid: a link the
        // admin cannot see is a dangling credential.
        await deps.store.revokeInvitation(invitation.invitationId);
        deps.audit.operatorInvited({
          actorId: actor.id,
          actorRole: actor.role,
          invitationId: invitation.invitationId,
          email: normalized,
          role,
          expiresAt,
          delivery: "FAILED",
          channel: "SMTP",
        });
        console.error(
          "[auth-gateway] invitation delivery failed:",
          error instanceof MailDeliveryError
            ? `${error.code} ${error.detail ?? error.message}`
            : error instanceof Error
              ? error.message
              : error,
        );
        throw deliveryError(error);
      }

      // Emitted only after the message actually left, so the audit trail never
      // claims a delivery that did not happen.
      deps.audit.operatorInvited({
        actorId: actor.id,
        actorRole: actor.role,
        invitationId: invitation.invitationId,
        email: normalized,
        role,
        expiresAt,
        delivery: "SENT",
        channel,
      });

      return { invitation, magicLink, delivered: true, channel };
    },

    async accept(token) {
      if (!token || token.length < 20 || token.length > 512) {
        return { status: "invalid" };
      }
      return deps.store.claimInvitation({
        tokenHash: sha256Hex(token),
        now: now(),
        workspaceId: deps.config.workspaceId,
      });
    },

    list() {
      return deps.store.listInvitations();
    },

    async withdraw({ invitationId, actor, workspaceId }) {
      const invitation = await deps.store.findInvitationById(invitationId);
      if (!invitation || invitation.workspaceId !== workspaceId) {
        throw new GatewayError(
          404,
          "INVITATION_NOT_FOUND",
          "That invitation does not exist in this workspace.",
        );
      }
      if (invitation.consumedAt) {
        throw new GatewayError(
          409,
          "INVITATION_ALREADY_ACCEPTED",
          "That invitation was already accepted; withdraw the member's access instead.",
        );
      }
      if (invitation.revokedAt) {
        throw new GatewayError(
          409,
          "INVITATION_ALREADY_WITHDRAWN",
          "That invitation was already withdrawn.",
        );
      }

      const at = now();
      if (invitation.expiresAt.getTime() <= at.getTime()) {
        throw new GatewayError(
          410,
          "INVITATION_EXPIRED",
          "That invitation has already expired, so its link no longer works.",
        );
      }

      // Conditional UPDATE: if acceptance won the race, nothing is revoked and
      // the admin gets a truthful conflict instead of a fake success.
      const withdrawn = await deps.store.withdrawInvitation(invitationId, at);
      if (!withdrawn) {
        throw new GatewayError(
          409,
          "INVITATION_NOT_PENDING",
          "That invitation is no longer pending.",
        );
      }

      deps.audit.invitationWithdrawn({
        actorId: actor.id,
        actorRole: actor.role,
        invitationId,
        email: withdrawn.email,
        role: withdrawn.role,
        workspaceId,
      });

      return withdrawn;
    },
  };
}

/** Public list shape: never exposes token digests or invitee PII beyond email. */
export function publicInvitation(
  invitation: InvitationRecord,
  now: Date = new Date(),
) {
  return {
    invitationId: invitation.invitationId,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    createdAt: invitation.createdAt.toISOString(),
    expiresAt: invitation.expiresAt.toISOString(),
    consumedAt: invitation.consumedAt?.toISOString() ?? null,
    acceptedOperatorId: invitation.acceptedOperatorId,
    revokedAt: invitation.revokedAt?.toISOString() ?? null,
    // Same clock the invitation was created with, so a fixed test clock (or a
    // skewed process) cannot report PENDING and EXPIRED interchangeably.
    status: invitationStatus(invitation, now),
  };
}

export function invitationStatus(
  invitation: InvitationRecord,
  now: Date = new Date(),
): "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED" {
  if (invitation.consumedAt) return "ACCEPTED";
  if (invitation.revokedAt) return "REVOKED";
  if (invitation.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return "PENDING";
}
