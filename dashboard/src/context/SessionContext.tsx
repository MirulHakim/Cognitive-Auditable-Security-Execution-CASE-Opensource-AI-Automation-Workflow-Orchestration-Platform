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
  getProfile,
  setIdentity,
  signOutSession,
} from "../api/client";
import type { Me, Member, Profile } from "../api/types";
import { useTheme, type ThemePreference } from "../contexts/ThemeContext";

interface SessionValue {
  member: Member | null;
  permissions: string[];
  /** Editable name, contact number and account theme. Null while loading. */
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: (identifier: string) => Promise<void>;
  signOut: () => void;
  refresh: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  /** Display-only permission check; the server re-checks every action. */
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * One source of truth for "who is signed in and what may they do".
 *
 * Two sign-in mechanisms converge here:
 *  - Google OAuth: the gateway sets an HttpOnly JWT cookie and GET /me resolves
 *    it; nothing is stored in localStorage.
 *  - Development identity switch: a member id/email in localStorage, kept for
 *    the old demo flow when AUTH_ALLOW_LEGACY_IDENTITY is enabled.
 * In both cases /me is the single source of truth for role and permissions.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [member, setMember] = useState<Member | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (identifier: string) => {
    setIdentity(identifier);
    const me: Me = await getMe();
    setMember(me.operator);
    setPermissions(me.permissions);
    const loaded = await getProfile().catch(() => null);
    setProfile(loaded?.profile ?? null);
  }, []);

  useEffect(() => {
    const identifier = getIdentity();
    let cancelled = false;

    // Always ask /me once: with no localStorage identity this is the only way
    // to discover an OAuth session from the HttpOnly cookie.
    getMe()
      .then((me) => {
        if (cancelled) return;
        setMember(me.operator);
        setPermissions(me.permissions);
        setError(null);
        // Profile is supplementary: a transient failure must not sign anyone
        // out or hide the shell. The theme sync simply waits for the next load.
        void getProfile()
          .then((loaded) => {
            if (!cancelled) setProfile(loaded.profile);
          })
          .catch(() => undefined);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // Only the server rejecting this identity ends the session. A 5xx or an
        // unreachable API is an outage, not a sign-out: keep the stored identity
        // so signing in again (or a retry) works as soon as the API is back.
        const status = caught instanceof ApiError ? caught.status : 0;
        const rejected = status === 401 || status === 403;
        if (rejected) clearIdentity();
        setMember(null);
        setPermissions([]);
        setProfile(null);
        setError(
          rejected && status === 401 && !identifier ? null : errorMessage(caught),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
    // Clear the server session (refresh token + JWT cookies) as well as the
    // development identity. Fire-and-forget so the UI changes immediately.
    void signOutSession();
    clearIdentity();
    setMember(null);
    setPermissions([]);
    setProfile(null);
    setError(null);
  }, []);

  const refresh = useCallback(async () => {
    const me = await getMe();
    setMember(me.operator);
    setPermissions(me.permissions);
  }, []);

  const refreshProfile = useCallback(async () => {
    const loaded = await getProfile();
    setProfile(loaded.profile);
  }, []);

  const can = useCallback(
    (permission: string) => permissions.includes(permission),
    [permissions],
  );

  const value = useMemo<SessionValue>(
    () => ({
      member,
      permissions,
      profile,
      loading,
      error,
      signIn,
      signOut,
      refresh,
      refreshProfile,
      can,
    }),
    [
      member,
      permissions,
      profile,
      loading,
      error,
      signIn,
      signOut,
      refresh,
      refreshProfile,
      can,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      <ThemePreferenceSync preference={profile?.themePreference ?? null} />
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Applies the account's saved theme once the profile arrives. It never writes
 * back to the account (that is the user's `setTheme`), so a login cannot cause
 * a save loop.
 */
function ThemePreferenceSync({
  preference,
}: {
  preference: ThemePreference | null;
}) {
  const { applyServerTheme } = useTheme();
  useEffect(() => {
    if (preference) applyServerTheme(preference);
  }, [preference, applyServerTheme]);
  return null;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}
