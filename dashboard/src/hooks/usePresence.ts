import { useEffect, useState } from "react";
import { getPresence, sendHeartbeat } from "../api/client";
import type { PresenceMember } from "../api/types";

/**
 * Live presence without WebSockets.
 *
 * The gateway derives "online" from `auth_accounts.last_seen_at` (2-minute
 * window), so there is no event to subscribe to: poll the snapshot and let the
 * timestamps do the work. A hidden tab stops polling and stops beating, which
 * is exactly what makes a closed laptop turn gray.
 */

/** Snapshot poll: fast enough for a status dot, one cheap query per call. */
const PRESENCE_POLL_MS = 15_000;
const DEFAULT_HEARTBEAT_MS = 60_000;

/**
 * Marks the signed-in member active now and every minute while the tab is
 * visible. Mount it once, inside the signed-in shell.
 */
export function useHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | undefined;
    let delayMs = DEFAULT_HEARTBEAT_MS;

    const schedule = () => {
      if (cancelled) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void beat(), delayMs);
    };

    const beat = async () => {
      if (document.visibilityState === "visible") {
        try {
          const result = await sendHeartbeat();
          delayMs = Math.max(15, result.heartbeatEverySeconds) * 1000;
        } catch {
          // A failed beat is not a failure of the app: the next poll will show
          // this member offline if it keeps failing, and retry soon either way.
          delayMs = DEFAULT_HEARTBEAT_MS;
        }
      }
      schedule();
    };

    void beat();

    // Returning to the tab should not wait for the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") void beat();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}

/**
 * Presence by member id. Returns an empty map until the first snapshot lands,
 * and keeps the last known snapshot when a poll fails.
 */
export function usePresence(enabled = true): Map<string, PresenceMember> {
  const [byId, setById] = useState<Map<string, PresenceMember>>(() => new Map());

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const load = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const snapshot = await getPresence();
        if (cancelled) return;
        setById(new Map(snapshot.members.map((member) => [member.operatorId, member])));
      } catch {
        // Transient outage: keep what we have rather than flashing everyone gray.
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), PRESENCE_POLL_MS);
    document.addEventListener("visibilitychange", load);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [enabled]);

  return byId;
}
