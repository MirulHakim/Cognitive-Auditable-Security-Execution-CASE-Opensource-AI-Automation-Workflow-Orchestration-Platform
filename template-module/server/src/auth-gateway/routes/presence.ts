import type { RequestHandler } from "express";
import { asyncHandler, GatewayError } from "../errors.js";
import {
  HEARTBEAT_INTERVAL_SECONDS,
  OFFLINE_AFTER_MS,
  type PresenceService,
} from "../presence.js";

/**
 * POST /api/auth/heartbeat — mounted after authentication.
 *
 * Deliberately writes no audit event: this fires every minute per signed-in
 * user and would flood the hash chain. The response tells the client when to
 * poll again, so the interval lives in one place (presence.ts).
 */
export function createHeartbeatHandler(deps: {
  presence: PresenceService;
}): RequestHandler {
  return asyncHandler(async (req, res) => {
    const auth = req.auth;
    if (!auth) {
      throw new GatewayError(401, "UNAUTHENTICATED", "Authentication required.");
    }

    const at = await deps.presence.markSeen(auth.operator.id);

    res.setHeader("cache-control", "no-store");
    res.json({
      online: true,
      lastSeenAt: at.toISOString(),
      heartbeatEverySeconds: HEARTBEAT_INTERVAL_SECONDS,
      offlineAfterSeconds: OFFLINE_AFTER_MS / 1000,
    });
  });
}

/**
 * GET /api/auth/presence — every active member with a derived online flag.
 *
 * Read-only and cheap (one LEFT JOIN). Any authenticated member may read it:
 * presence is already visible in the UI, and it carries no email addresses or
 * credentials. Revoked members are excluded server-side.
 */
export function createPresenceHandler(deps: {
  presence: PresenceService;
}): RequestHandler {
  return asyncHandler(async (_req, res) => {
    const snapshot = await deps.presence.snapshot();
    res.setHeader("cache-control", "private, no-store");
    res.json(snapshot);
  });
}
