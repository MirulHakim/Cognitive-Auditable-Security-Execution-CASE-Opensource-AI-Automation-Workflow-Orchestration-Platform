import type { AuthStore } from "./store.js";

/**
 * Presence without a database row on the base `operators` table and without
 * WebSockets.
 *
 * Two signals combine: `last_seen_at` (refreshed by the JWT middleware,
 * throttled, and by POST /api/auth/heartbeat) and `is_online` (the last
 * explicit state: true on activity, false on logout).
 *
 * `online` requires both: recently seen *and* not explicitly signed out. The
 * timestamp alone would leave a logged-out member green for the full timeout
 * window, which is exactly what a person sees when they sign out of one account
 * and into another. The explicit flag alone would leave a crashed session green
 * forever. `isOnline` is still exposed for debugging; readers use `online`.
 *
 * Presence transitions are intentionally NOT written to the audit chain: they
 * happen every minute per user and would drown the hash chain in noise. Only
 * explicit logouts (AUTHENTICATION_LOGOUT) and revocations (OPERATOR_REVOKED)
 * are audited.
 */

/** Offline after two minutes without an authenticated request or heartbeat. */
export const OFFLINE_AFTER_MS = 2 * 60 * 1000;

/** A client heartbeat every 60 s keeps someone online with margin to spare. */
export const HEARTBEAT_INTERVAL_SECONDS = 60;

export interface PresenceMember {
  operatorId: string;
  displayName: string;
  role: string;
  /** Recently seen AND not signed out — the value a status dot should use. */
  online: boolean;
  lastSeenAt: string | null;
  lastSeenSecondsAgo: number | null;
  /** Last explicit state written by the gateway (false after logout). */
  isOnline: boolean;
}

export interface PresenceSnapshot {
  generatedAt: string;
  offlineAfterSeconds: number;
  heartbeatEverySeconds: number;
  members: PresenceMember[];
}

export interface PresenceService {
  /** Records activity; returns the timestamp used. */
  markSeen(operatorId: string): Promise<Date>;
  /** Explicit sign-out: offline immediately, last_seen_at preserved. */
  markOffline(operatorId: string): Promise<void>;
  snapshot(): Promise<PresenceSnapshot>;
}

export function createPresenceService(deps: {
  store: AuthStore;
  now?: () => Date;
}): PresenceService {
  const now = deps.now ?? (() => new Date());

  return {
    async markSeen(operatorId) {
      const at = now();
      await deps.store.touchPresence(operatorId, at);
      return at;
    },

    async markOffline(operatorId) {
      await deps.store.setPresenceOffline(operatorId);
    },

    async snapshot() {
      const at = now();
      const rows = await deps.store.listPresence();
      const members = rows.map((row): PresenceMember => {
        const ageMs = row.lastSeenAt ? at.getTime() - row.lastSeenAt.getTime() : null;
        return {
          operatorId: row.operatorId,
          displayName: row.displayName,
          role: row.role,
          online: row.isOnline && ageMs !== null && ageMs <= OFFLINE_AFTER_MS,
          lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
          lastSeenSecondsAgo: ageMs === null ? null : Math.max(0, Math.round(ageMs / 1000)),
          isOnline: row.isOnline,
        };
      });
      return {
        generatedAt: at.toISOString(),
        offlineAfterSeconds: OFFLINE_AFTER_MS / 1000,
        heartbeatEverySeconds: HEARTBEAT_INTERVAL_SECONDS,
        members,
      };
    },
  };
}
