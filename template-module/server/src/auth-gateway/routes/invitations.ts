import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { AuthAuditor } from "../audit.js";
import type { AuthGatewayConfig } from "../config.js";
import { asyncHandler, GatewayError } from "../errors.js";
import type { InvitationService } from "../invitations.js";
import { publicInvitation } from "../invitations.js";
import { publicOperator, createAuthRateLimiter } from "./auth.js";

const inviteSchema = z
  .object({
    email: z.string().trim().email().max(254),
    role: z.enum(["operator", "auditor"]),
  })
  .strict();

const InvitationIdSchema = z.string().uuid();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const FAILURE_COPY: Record<string, { status: number; title: string; body: string }> = {
  invalid: {
    status: 404,
    title: "Invitation not found",
    body: "This link is not valid. Ask an administrator for a new invitation.",
  },
  expired: {
    status: 410,
    title: "Invitation expired",
    body: "Invitation links are valid for two hours. Ask an administrator for a new one.",
  },
  consumed: {
    status: 409,
    title: "Invitation already used",
    body: "This invitation has already been accepted. Sign in with Google instead.",
  },
  revoked: {
    status: 410,
    title: "Invitation withdrawn",
    body: "An administrator replaced or withdrew this invitation. Ask for a new link.",
  },
  email_taken: {
    status: 409,
    title: "Already a member",
    body: "That email already belongs to a member. Sign in with Google instead.",
  },
};

function failurePage(config: AuthGatewayConfig, copy: { title: string; body: string }): string {
  const login = new URL(config.dashboardUrl);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(copy.title)} · ${escapeHtml(config.invitation.appName)}</title>
<style>
  body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0b0d10;color:#e5e7eb;
       min-height:100vh;display:grid;place-items:center;margin:0}
  main{max-width:440px;padding:32px;border:1px solid #262b33;border-radius:16px;background:#12151a}
  h1{font-size:20px;margin:0 0 8px} p{color:#9ca3af;font-size:14px;line-height:1.6}
  a{display:inline-block;margin-top:16px;background:#e5e7eb;color:#111;padding:10px 16px;
    border-radius:8px;text-decoration:none;font-size:14px;font-weight:600}
</style></head>
<body><main><h1>${escapeHtml(copy.title)}</h1><p>${escapeHtml(copy.body)}</p>
<a href="${escapeHtml(login.toString())}">Go to sign in</a></main></body></html>`;
}

export function createInvitationAcceptRouter(deps: {
  config: AuthGatewayConfig;
  service: InvitationService;
  audit: AuthAuditor;
}): Router {
  const router = Router();

  router.get(
    "/accept",
    createAuthRateLimiter(deps.config),
    asyncHandler(async (req: Request, res: Response) => {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      const result = await deps.service.accept(token);
      const json = (req.header("accept") ?? "").includes("application/json");

      if (result.status === "ok") {
        deps.audit.invitationAccepted({
          invitationId: result.invitation.invitationId,
          operatorId: result.operator.id,
          role: result.operator.role,
          workspaceId: deps.config.workspaceId,
        });
        // The operator row now exists and is bound to this email. Google sign-in
        // links the Google subject, so the invitee must use the invited address.
        const next = `${deps.config.publicUrl}/api/auth/google/start`;
        if (json) {
          res.status(200).json({
            operator: publicOperator(result.operator),
            next,
          });
          return;
        }
        res.redirect(303, next);
        return;
      }

      const copy = FAILURE_COPY[result.status] ?? FAILURE_COPY.invalid!;
      if (json) {
        res.status(copy.status).json({
          error: { code: result.status.toUpperCase(), message: copy.body, details: null },
        });
        return;
      }
      res
        .status(copy.status)
        .type("html")
        .send(failurePage(deps.config, copy));
    }),
  );

  return router;
}

export function createInvitationAdminRouter(deps: {
  config: AuthGatewayConfig;
  service: InvitationService;
  /** Injectable clock; keeps the derived status consistent with creation. */
  now?: () => Date;
}): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  router.post(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = inviteSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new GatewayError(400, "INVALID_INVITATION", "Enter a valid email and role.", {
          fields: parsed.error.issues.map((issue) => issue.path.join(".")),
        });
      }
      const auth = req.auth;
      if (!auth) {
        throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      const created = await deps.service.create({
        email: parsed.data.email,
        role: parsed.data.role,
        // The admin performing the action; the CASE system mailbox sends it.
        actor: {
          id: auth.operator.id,
          role: auth.operator.role,
          email: auth.operator.email,
          displayName: auth.operator.displayName,
        },
        workspaceId: deps.config.workspaceId,
      });

      // The raw token stays in the email. It is never returned over the API, so
      // an admin cannot accidentally paste a live credential into chat/logs.
      res.status(201).json({
        invitation: publicInvitation(created.invitation, now()),
        delivery: created.delivered ? "SENT" : "FAILED",
        // SMTP | DEV_LOG — lets the UI say where the mail came from without
        // ever exposing the token or the SMTP credentials.
        channel: created.channel,
      });
    }),
  );

  // Admin only (the whole router is mounted behind requireAdmin). Withdrawing
  // sets revoked_at, which the accept endpoint reports as REVOKED, so an
  // unopened magic link stops working immediately while the row remains for
  // the audit trail.
  router.delete(
    "/:id",
    asyncHandler(async (req: Request, res: Response) => {
      const parsed = InvitationIdSchema.safeParse(req.params.id);
      if (!parsed.success) {
        throw new GatewayError(
          404,
          "INVITATION_NOT_FOUND",
          "That invitation does not exist in this workspace.",
        );
      }
      const auth = req.auth;
      if (!auth) {
        throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      const withdrawn = await deps.service.withdraw({
        invitationId: parsed.data,
        actor: { id: auth.operator.id, role: auth.operator.role },
        workspaceId: deps.config.workspaceId,
      });

      res.setHeader("cache-control", "private, no-store");
      res.json({
        withdrawn: true,
        invitation: publicInvitation(withdrawn, now()),
      });
    }),
  );

  router.get(
    "/",
    asyncHandler(async (_req: Request, res: Response) => {
      const invitations = await deps.service.list();
      res.setHeader("cache-control", "private, no-store");
      const at = now();
      res.json({ invitations: invitations.map((entry) => publicInvitation(entry, at)) });
    }),
  );

  return router;
}
