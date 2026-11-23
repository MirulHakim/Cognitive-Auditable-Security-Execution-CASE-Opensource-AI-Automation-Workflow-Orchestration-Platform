import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express, type RequestHandler } from "express";
import type { AuditRecorder } from "../audit/auditLog.js";
import { createAuthService } from "./authService.js";
import { createAuthAuditor } from "./audit.js";
import type { AuthGatewayConfig } from "./config.js";
import type { CredentialService } from "./credentials.js";
import { gatewayErrorHandler, GatewayError } from "./errors.js";
import type { GoogleOAuth } from "./google.js";
import { createInvitationService } from "./invitations.js";
import type { Mailer } from "./mailer.js";
import {
  createAuthenticate,
  originGuard,
  requireRole,
  stripIdentityHeaders,
} from "./middleware.js";
import { createPresenceService } from "./presence.js";
import { createProxy } from "./proxy.js";
import {
  createCredentialPurgeHook,
  type CredentialRevoker,
} from "./revocation.js";
import { createHardRevokeRouter } from "./routes/admin.js";
import { createPublicAuthRouter, meHandler } from "./routes/auth.js";
import { createDirectoryHandler } from "./routes/directory.js";
import {
  createHeartbeatHandler,
  createPresenceHandler,
} from "./routes/presence.js";
import { createProfileRouter } from "./routes/profile.js";
import { createVaultRouter } from "./routes/vault.js";
import { createInternalVaultRouter } from "./routes/internalVault.js";
import {
  createInvitationAcceptRouter,
  createInvitationAdminRouter,
} from "./routes/invitations.js";
import type { AuthStore } from "./store.js";
import type { OAuthStateService, SessionTokenService } from "./tokens.js";
import { createVaultService } from "./vaultService.js";

export interface AuthGatewayDependencies {
  config: AuthGatewayConfig;
  store: AuthStore;
  tokens: SessionTokenService;
  oauthState: OAuthStateService;
  google: GoogleOAuth;
  /** Dedicated CASE system mailbox (SMTP); the only invitation sender. */
  mailer: Mailer;
  /** Seals/opens delegated Google tokens. Omit in SMTP-only tests. */
  credentials?: CredentialService;
  /** Destroys credentials after a successful revoke. Omit to keep them in tests. */
  revoker?: CredentialRevoker;
  /** Existing PostgresAuditLog. Omit only in tests. */
  audit?: AuditRecorder;
  now?: () => Date;
  /** Injection point for tests; production uses the reverse proxy. */
  proxyHandler?: RequestHandler;
  /** Injection point for the merged directory's legacy read. */
  fetchImpl?: typeof fetch;
}

/**
 * The whole auth system is this one additional Express app. None of the
 * existing routers are imported or wrapped at the module level: requests reach
 * them only through the HTTP proxy, with headers the gateway controls.
 */
export function createAuthGatewayApp(deps: AuthGatewayDependencies): Express {
  const { config } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use(
    cors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    next();
  });

  // Strip client-supplied identity headers before anything can trust them.
  app.use("/api", stripIdentityHeaders(config));
  app.use("/api", originGuard(config));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", service: "auth-gateway" });
  });

  // Just-in-time decryption for the workflow engine. Mounted before the user
  // session middleware on purpose: it authenticates with a pre-shared key, not
  // a browser cookie, and must never be reachable as a signed-in member.
  const vaultService = createVaultService({
    store: deps.store,
    masterKey: config.vault.masterKey,
    now: deps.now,
  });
  app.use(
    "/api/internal/vault",
    createInternalVaultRouter({
      service: vaultService,
      internalApiKey: config.vault.internalApiKey,
    }),
  );

  const audit = createAuthAuditor(deps.audit, config.workspaceId);
  const authService = createAuthService({
    config,
    store: deps.store,
    tokens: deps.tokens,
    oauthState: deps.oauthState,
    google: deps.google,
    audit,
    credentials: deps.credentials,
    now: deps.now,
  });
  const invitationService = createInvitationService({
    config,
    store: deps.store,
    mailer: deps.mailer,
    audit,
    now: deps.now,
  });
  const presence = createPresenceService({ store: deps.store, now: deps.now });

  const authenticate = createAuthenticate({
    config,
    store: deps.store,
    tokens: deps.tokens,
    audit: deps.audit,
    now: deps.now,
  });

  // Public auth surface. Only these routes parse a body, so proxied request
  // streams stay untouched.
  app.use("/api/auth", express.json({ limit: "16kb" }), createPublicAuthRouter({ config, service: authService }));

  // Public invitation acceptance (the magic link is the credential).
  app.use(
    "/api/invitations",
    createInvitationAcceptRouter({ config, service: invitationService, audit }),
  );

  // From here on every request needs a valid session.
  app.use("/api", authenticate);

  // A successful `DELETE /api/operators/:id` is completed by destroying the
  // member's Google link, delegated tokens and refresh tokens. The legacy route
  // keeps its soft delete; this only removes what the gateway itself holds.
  if (deps.revoker) {
    app.use("/api", createCredentialPurgeHook({ revoker: deps.revoker }));
  }

  app.get("/api/auth/me", meHandler);

  // User-scoped integration vault. The operator id comes from req.auth only;
  // GET returns connection booleans, never ciphertext or plaintext.
  app.use("/api/auth/vault", createVaultRouter({ service: vaultService }));

  // Self-service profile + theme. Gateway-owned columns only; the legacy API
  // has no profile-write route, and this keeps the Express app untouched.
  app.use(
    "/api/users/me",
    express.json({ limit: "16kb" }),
    createProfileRouter({ store: deps.store }),
  );

  // The legacy directory, enriched with pending invitations for admins. This
  // must sit before the catch-all proxy so GET /api/operators never bypasses
  // the merge; every other /api/operators call is still proxied untouched.
  app.get(
    "/api/operators",
    createDirectoryHandler({
      config,
      store: deps.store,
      now: deps.now,
      fetchImpl: deps.fetchImpl,
    }),
  );

  // Live presence. Heartbeats and reads are deliberately un-audited: they run
  // on a timer and would otherwise dominate the hash chain.
  app.post("/api/auth/heartbeat", createHeartbeatHandler({ presence }));
  app.get("/api/auth/presence", createPresenceHandler({ presence }));

  // Admin-only sidecar endpoints.
  // Hard revocation: admin only, same-origin, self-revocation refused.
  app.use(
    "/api/auth/operators",
    requireRole(["admin"]),
    createHardRevokeRouter({ store: deps.store, audit }),
  );

  app.use(
    "/api/invitations",
    express.json({ limit: "16kb" }),
    requireRole(["admin"]),
    createInvitationAdminRouter({ config, service: invitationService, now: deps.now }),
  );

  // Everything else is the existing platform, untouched.
  app.use("/api", deps.proxyHandler ?? createProxy(config));

  app.use((_req, _res, next) =>
    next(new GatewayError(404, "NOT_FOUND", "Route not found.")),
  );
  app.use(gatewayErrorHandler);

  return app;
}
