import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { AuditRecorder } from "../audit/auditLog.js";
import type { Role } from "../auth/operators.js";
import { createAuthAuditor } from "./audit.js";
import type { AuthGatewayConfig } from "./config.js";
import { bearerToken, readCookie } from "./cookies.js";
import { GatewayError } from "./errors.js";
import type { AuthStore, OperatorRecord } from "./store.js";
import type { SessionClaims, SessionTokenService } from "./tokens.js";

export interface AuthContext {
  operator: OperatorRecord;
  claims: SessionClaims;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

const IDENTITY_HEADERS = [
  "x-operator-id",
  "x-operator-role",
  "x-mock-user",
  "x-mock-role",
  "x-mock-workspace",
] as const;

/**
 * The critical boundary: never let a client supply the headers the legacy API
 * trusts. We capture the old x-operator-id first only for the explicit
 * development escape hatch, then delete every identity header. The
 * authentication middleware re-injects them from the verified JWT.
 */
export function stripIdentityHeaders(
  config: AuthGatewayConfig,
): RequestHandler {
  return (req, res, next) => {
    const legacy = req.header("x-operator-id")?.trim();
    if (legacy) res.locals.legacyIdentity = legacy;
    for (const header of IDENTITY_HEADERS) delete req.headers[header];
    next();
  };
}

function isExpired(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_JWT_EXPIRED"
  );
}

export function createAuthenticate(deps: {
  config: AuthGatewayConfig;
  store: AuthStore;
  tokens: SessionTokenService;
  audit?: AuditRecorder;
  /** Injectable clock so presence writes are consistent (and testable). */
  now?: () => Date;
}): RequestHandler {
  const audit = createAuthAuditor(deps.audit, deps.config.workspaceId);

  // Presence writes are throttled per operator: a busy SPA can issue dozens of
  // requests a second, and last_seen_at only needs minute-level accuracy.
  const PRESENCE_TOUCH_INTERVAL_MS = 30_000;
  const lastPresenceTouch = new Map<string, number>();

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const token = bearerToken(req) ?? readCookie(req, deps.config.cookies.sessionName);
      let operator: OperatorRecord | null = null;

      if (token) {
        let claims: SessionClaims;
        try {
          claims = await deps.tokens.verify(token);
        } catch (error) {
          throw new GatewayError(
            401,
            isExpired(error) ? "SESSION_EXPIRED" : "SESSION_INVALID",
            isExpired(error) ? "Your session has expired." : "Sign in to continue.",
          );
        }
        if (claims.workspaceId !== deps.config.workspaceId) {
          throw new GatewayError(401, "SESSION_INVALID", "Session belongs to another workspace.");
        }
        operator = await deps.store.findOperatorById(claims.sub);
        if (!operator) {
          throw new GatewayError(401, "SESSION_INVALID", "Unknown session identity.");
        }
        if (operator.revokedAt) {
          audit.authenticationFailed({
            reasonCode: "ACCESS_REVOKED",
            email: operator.email,
            operator: { id: operator.id, role: operator.role },
            workspaceId: deps.config.workspaceId,
          });
          throw new GatewayError(
            403,
            "ACCESS_REVOKED",
            "This member's access to the workspace has been revoked by an administrator.",
          );
        }
        req.auth = { operator, claims };
      } else if (deps.config.allowLegacyIdentity) {
        const legacy = res.locals.legacyIdentity as string | undefined;
        if (legacy) {
          operator = await deps.store.findOperatorById(legacy);
          if (!operator && legacy.includes("@")) {
            operator = await deps.store.findOperatorByEmail(legacy);
          }
          if (!operator) {
            throw new GatewayError(401, "UNAUTHENTICATED", "Unknown operator.");
          }
          if (operator.revokedAt) {
            throw new GatewayError(403, "ACCESS_REVOKED", "Access has been revoked.");
          }
          req.auth = {
            operator,
            claims: {
              sub: operator.id,
              email: operator.email,
              role: operator.role,
              workspaceId: deps.config.workspaceId,
            },
          };
        }
      }

      if (!req.auth) {
        throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
      }

      // Presence: fire-and-forget, so a slow database never delays a request,
      // and a failed write never fails one. No audit event — see presence.ts.
      const nowMs = (deps.now?.() ?? new Date()).getTime();
      const operatorId = req.auth.operator.id;
      if (nowMs - (lastPresenceTouch.get(operatorId) ?? 0) >= PRESENCE_TOUCH_INTERVAL_MS) {
        lastPresenceTouch.set(operatorId, nowMs);
        void deps.store
          .touchPresence(operatorId, new Date(nowMs))
          .catch((error: unknown) => {
            console.error(
              "[auth-gateway] presence update failed:",
              error instanceof Error ? error.message : error,
            );
          });
      }

      // The wrapper trick: every downstream route — Express or FastAPI — sees
      // exactly the identity headers it was written against. The role comes
      // from the operator row re-read for this request, so a demotion takes
      // effect immediately instead of waiting for the JWT to expire. Any
      // client-supplied copy was deleted by stripIdentityHeaders above.
      req.headers["x-operator-id"] = req.auth.operator.id;
      req.headers["x-operator-role"] = req.auth.operator.role;
      req.headers["x-mock-user"] = req.auth.operator.id;
      req.headers["x-mock-role"] = req.auth.operator.role.toUpperCase();
      req.headers["x-mock-workspace"] = deps.config.workspaceId;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Reusable role gate for gateway-owned routes.
 *
 * The role is read from the operator row resolved from the verified JWT's
 * subject, not from a client header. That makes a re-role effective on the
 * very next request (and avoids trusting a stale role claim in an old token).
 * Authentication must already have run; without it this answers 401.
 *
 * Case-insensitive for caller convenience, and a denial is always a clean 403
 * with the allowed roles in `details` (never a 500 or an upstream request).
 */
export function requireRole(allowedRoles: readonly string[]): RequestHandler {
  const allowed = new Set(
    allowedRoles.map((role) => role.trim().toLowerCase()).filter(Boolean),
  );

  return (req, _res, next) => {
    if (!req.auth) {
      next(new GatewayError(401, "UNAUTHENTICATED", "Authentication required."));
      return;
    }

    const role: Role = req.auth.operator.role;
    if (!allowed.has(role)) {
      const requiredRoles = [...allowed];
      next(
        new GatewayError(
          403,
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          {
            requiredRoles,
            // Kept for clients written against the earlier single-role gate.
            ...(requiredRoles.length === 1
              ? { requiredRole: requiredRoles[0] }
              : {}),
            role,
          },
        ),
      );
      return;
    }
    next();
  };
}

/** Backwards-compatible alias for the common single-role case. */
export function requireAdmin(): RequestHandler {
  return requireRole(["admin"]);
}

/**
 * Cookie-authenticated mutations need CSRF protection. SameSite=Lax already
 * blocks cross-site POSTs in modern browsers; the Origin check closes the gap
 * for older ones and for non-browser clients that can set a cookie.
 */
export function originGuard(config: AuthGatewayConfig): RequestHandler {
  const allowed = new Set([config.publicUrl, config.dashboardUrl, ...config.corsOrigins]);
  return (req, _res, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      next();
      return;
    }
    const origin = req.header("origin");
    if (origin && !allowed.has(origin)) {
      next(new GatewayError(403, "CROSS_ORIGIN_BLOCKED", "Cross-origin request blocked."));
      return;
    }
    if (req.header("sec-fetch-site") === "cross-site") {
      next(new GatewayError(403, "CROSS_ORIGIN_BLOCKED", "Cross-site request blocked."));
      return;
    }
    next();
  };
}
