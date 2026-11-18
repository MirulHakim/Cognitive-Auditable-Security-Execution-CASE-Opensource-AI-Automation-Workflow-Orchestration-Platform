import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { permissionsFor, type Role } from "../../auth/operators.js";
import type { AuthService, IssuedSession } from "../authService.js";
import { AuthFailure } from "../authService.js";
import type { AuthGatewayConfig } from "../config.js";
import {
  clearOAuthStateCookie,
  clearSessionCookies,
  readCookie,
  setOAuthStateCookie,
  setSessionCookies,
} from "../cookies.js";
import { asyncHandler } from "../errors.js";
import type { OperatorRecord } from "../store.js";

export function publicOperator(operator: OperatorRecord) {
  return {
    id: operator.id,
    displayName: operator.displayName,
    email: operator.email,
    role: operator.role,
    revokedAt: operator.revokedAt?.toISOString() ?? null,
  };
}

export function sessionPayload(session: IssuedSession) {
  return {
    operator: publicOperator(session.operator),
    permissions: permissionsFor(session.operator.role as Role),
    rootAdminInitialized: session.rootAdminInitialized,
  };
}

export function createAuthRateLimiter(config: AuthGatewayConfig) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many authentication attempts. Try again shortly.",
          details: null,
        },
      });
    },
  });
}

function wantsJson(req: Request): boolean {
  return (req.header("accept") ?? "").includes("application/json");
}

function failureRedirect(config: AuthGatewayConfig, reason: string): string {
  const url = new URL(config.dashboardUrl);
  url.searchParams.set("auth", "failed");
  url.searchParams.set("reason", reason);
  return url.toString();
}

function successRedirect(config: AuthGatewayConfig): string {
  const url = new URL(config.dashboardUrl);
  url.searchParams.set("auth", "success");
  return url.toString();
}

export function createPublicAuthRouter(deps: {
  config: AuthGatewayConfig;
  service: AuthService;
}): Router {
  const router = Router();
  const limiter = createAuthRateLimiter(deps.config);

  // Step 1 — browser navigation. Sets a short-lived signed state cookie that
  // binds the callback to this browser and carries the OIDC nonce.
  router.get(
    "/google/start",
    limiter,
    asyncHandler(async (_req, res) => {
      const { url, stateCookie } = await deps.service.begin();
      setOAuthStateCookie(deps.config, res, stateCookie);
      res.setHeader("cache-control", "no-store");
      res.redirect(302, url);
    }),
  );

  // Step 2 — Google redirects here. No Express route in the existing app is
  // touched; this is a new URL under the gateway's own /api/auth namespace.
  router.get(
    "/google/callback",
    limiter,
    asyncHandler(async (req, res) => {
      const stateCookie = readCookie(req, deps.config.cookies.oauthStateName);
      clearOAuthStateCookie(deps.config, res);

      try {
        const session = await deps.service.complete({
          code: typeof req.query.code === "string" ? req.query.code : undefined,
          state: typeof req.query.state === "string" ? req.query.state : undefined,
          stateCookie,
        });
        setSessionCookies(
          deps.config,
          res,
          session.accessToken,
          session.refreshToken,
        );
        if (wantsJson(req)) {
          res.status(200).json(sessionPayload(session));
          return;
        }
        res.redirect(303, successRedirect(deps.config));
      } catch (error) {
        clearSessionCookies(deps.config, res);
        const reason = error instanceof AuthFailure ? error.reasonCode : "AUTH_FAILED";
        if (wantsJson(req)) {
          res.status(401).json({
            error: {
              code: reason,
              message:
                reason === "INVITATION_REQUIRED"
                  ? "This Google account has not been invited to the workspace."
                  : "Sign-in could not be completed.",
              details: null,
            },
          });
          return;
        }
        res.redirect(303, failureRedirect(deps.config, reason));
      }
    }),
  );

  // Rotating refresh: the old cookie is invalidated in the same transaction
  // that stores the new digest.
  router.post(
    "/refresh",
    limiter,
    asyncHandler(async (req, res) => {
      try {
        const session = await deps.service.refresh(
          readCookie(req, deps.config.cookies.refreshName),
        );
        setSessionCookies(
          deps.config,
          res,
          session.accessToken,
          session.refreshToken,
        );
        res.setHeader("cache-control", "no-store");
        res.status(200).json(sessionPayload(session));
      } catch (error) {
        clearSessionCookies(deps.config, res);
        throw error;
      }
    }),
  );

  router.post(
    "/logout",
    asyncHandler(async (req, res) => {
      await deps.service.logout(readCookie(req, deps.config.cookies.refreshName));
      clearSessionCookies(deps.config, res);
      clearOAuthStateCookie(deps.config, res);
      res.status(204).end();
    }),
  );

  return router;
}

/** Mounted after the global authenticate middleware. */
export function meHandler(req: Request, res: Response): void {
  const auth = req.auth;
  if (!auth) {
    res.status(401).json({
      error: { code: "UNAUTHENTICATED", message: "Authentication required.", details: null },
    });
    return;
  }
  res.setHeader("cache-control", "private, no-store");
  res.json({
    operator: publicOperator(auth.operator),
    permissions: permissionsFor(auth.operator.role),
    workspaceId: auth.claims.workspaceId,
  });
}
