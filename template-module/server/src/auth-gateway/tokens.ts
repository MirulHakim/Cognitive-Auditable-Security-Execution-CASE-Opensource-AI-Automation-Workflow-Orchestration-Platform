import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT, type JWTPayload } from "jose";
import type { Role } from "../auth/operators.js";
import type { AuthGatewayConfig } from "./config.js";

export interface SessionClaims extends JWTPayload {
  sub: string;
  email: string;
  role: Role;
  workspaceId: string;
}

export interface SessionTokenService {
  sign(operator: { id: string; email: string; role: Role }): Promise<string>;
  verify(token: string): Promise<SessionClaims>;
}

export function createSessionTokens(config: AuthGatewayConfig): SessionTokenService {
  const key = new TextEncoder().encode(config.jwt.secret);

  return {
    async sign(operator) {
      return new SignJWT({
        email: operator.email,
        role: operator.role,
        workspaceId: config.workspaceId,
      })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setSubject(operator.id)
        .setIssuer(config.jwt.issuer)
        .setAudience(config.jwt.audience)
        .setJti(randomBytes(16).toString("hex"))
        .setIssuedAt()
        .setExpirationTime(Math.floor(Date.now() / 1000) + config.jwt.accessTtlSeconds)
        .sign(key);
    },

    async verify(token) {
      const { payload } = await jwtVerify(token, key, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ["HS256"],
      });
      if (
        typeof payload.sub !== "string" ||
        typeof payload.email !== "string" ||
        (payload.role !== "admin" && payload.role !== "operator" && payload.role !== "auditor") ||
        typeof payload.workspaceId !== "string"
      ) {
        throw new Error("Session token is missing required claims.");
      }
      return payload as SessionClaims;
    },
  };
}

/* ----------------------------- opaque tokens ----------------------------- */

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Privacy-preserving identifier for audit details (never store raw email there). */
export function hashEmail(email: string): string {
  return sha256Hex(normalizeEmail(email));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* --------------------------- signed OAuth state -------------------------- */

export interface OAuthState {
  state: string;
  nonce: string;
}

export interface OAuthStateService {
  sign(payload: OAuthState): Promise<string>;
  verify(token: string): Promise<OAuthState>;
}

export function createOAuthStateService(config: AuthGatewayConfig): OAuthStateService {
  const key = new TextEncoder().encode(config.jwt.secret);
  return {
    async sign(payload) {
      return new SignJWT({ state: payload.state, nonce: payload.nonce, typ: "oauth" })
        .setProtectedHeader({ alg: "HS256", typ: "JWT" })
        .setIssuer(config.jwt.issuer)
        .setAudience(`${config.jwt.audience}:oauth`)
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(key);
    },
    async verify(token) {
      const { payload } = await jwtVerify(token, key, {
        issuer: config.jwt.issuer,
        audience: `${config.jwt.audience}:oauth`,
        algorithms: ["HS256"],
      });
      if (payload.typ !== "oauth" || typeof payload.state !== "string" || typeof payload.nonce !== "string") {
        throw new Error("Invalid OAuth state.");
      }
      return { state: payload.state, nonce: payload.nonce };
    },
  };
}
