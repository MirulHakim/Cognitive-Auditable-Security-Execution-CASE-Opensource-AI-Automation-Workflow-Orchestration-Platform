import type { CookieOptions, Request, Response } from "express";
import type { AuthGatewayConfig } from "./config.js";

/**
 * HttpOnly cookies are the transport for the JWT. The dashboard never stores a
 * token in localStorage and never reads it from JavaScript.
 */

function base(config: AuthGatewayConfig, path: string, maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: "lax",
    path,
    maxAge: maxAgeMs,
  };
}

export function setSessionCookies(
  config: AuthGatewayConfig,
  res: Response,
  accessToken: string,
  refreshToken: string,
): void {
  res.cookie(
    config.cookies.sessionName,
    accessToken,
    base(config, "/", config.jwt.accessTtlSeconds * 1000),
  );
  res.cookie(
    config.cookies.refreshName,
    refreshToken,
    // Scoped so the long-lived credential is not attached to every API call.
    base(config, "/api/auth", config.jwt.refreshTtlSeconds * 1000),
  );
}

export function clearSessionCookies(config: AuthGatewayConfig, res: Response): void {
  res.clearCookie(config.cookies.sessionName, { path: "/" });
  res.clearCookie(config.cookies.refreshName, { path: "/api/auth" });
}

export function setOAuthStateCookie(
  config: AuthGatewayConfig,
  res: Response,
  signedState: string,
): void {
  res.cookie(config.cookies.oauthStateName, signedState, base(config, "/api/auth", 10 * 60 * 1000));
}

export function clearOAuthStateCookie(config: AuthGatewayConfig, res: Response): void {
  res.clearCookie(config.cookies.oauthStateName, { path: "/api/auth" });
}

export function readCookie(req: Request, name: string): string | undefined {
  const parsed = (req as Request & { cookies?: Record<string, string> }).cookies;
  const value = parsed?.[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function bearerToken(req: Request): string | undefined {
  const header = req.header("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}
