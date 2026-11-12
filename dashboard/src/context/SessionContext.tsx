import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ApiError,
  clearIdentity,
  errorMessage,
  getIdentity,
  getMe,
  setIdentity,
} from "../api/client";
import type { Me, Member } from "../api/types";

interface SessionValue {
  member: Member | null;
  permissions: string[];
  loading: boolean;
  error: string | null;
  signIn: (identifier: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  /** Display-only permission check; the server re-checks every action. */
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * One source of truth for "who is signed in and what may they do".
 *
 * The session is a whitelisted member id or email kept in localStorage and
 * sent as `x-operator-id`; /api/operators/me resolves it into a member and the
 * exact permission list. A revoked identity is rejected by the API, which
 * clears the session here.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(getIdentity()));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (identifier: string) => {
    setIdentity(identifier);
    const me: Me = await getMe();
    setMember(me.operator);
    setPermissions(me.permissions);
  }, []);

  useEffect(() => {
    const identifier = getIdentity();
    if (!identifier) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    load(identifier)
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Only the server rejecting this identity ends the session. A 5xx or an
        // unreachable API is an outage, not a sign-out: keep the stored identity
        // so signing in again (or a retry) works as soon as the API is back.
        const rejected = caught instanceof ApiError && caught.status === 401;
        if (rejected) clearIdentity();
        setMember(null);
        setPermissions([]);
        setError(rejected ? null : errorMessage(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const signIn = useCallback(
    async (identifier: string) => {
      setError(null);
      const trimmed = identifier.trim();
      if (!trimmed) throw new Error("Enter your work email to continue.");
      await load(trimmed);
    },
    [load],
  );

  const signOut = useCallback(() => {
    clearIdentity();
    setMember(null);
    setPermissions([]);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const identifier = getIdentity();
    if (!identifier) return;
    await load(identifier);
  }, [load]);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  const value = useMemo<SessionValue>(
    () => ({ member, permissions, loading, error, signIn, signOut, refresh, can }),
    [member, permissions, loading, error, signIn, signOut, refresh, can],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
