import React, { useState } from "react";
import { FiArrowRight, FiLock, FiMail, FiShield } from "react-icons/fi";
import { DEMO_IDENTITIES, errorMessage, getIdentity } from "../../api/client";
import { useSession } from "../../context/SessionContext";

/**
 * Sign-in is a whitelist check: the email must belong to a member an admin
 * invited (or a seeded member id). The server resolves it and returns the
 * permissions the workspace will honour.
 */
export const Login: React.FC = () => {
  const { signIn, error: sessionError } = useSession();
  // Prefilled after an outage: the stored identity is kept when the API is
  // unreachable, so the user can retry instead of retyping their address.
  const [email, setEmail] = useState(() => getIdentity() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (identifier: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier);
    } catch (caught) {
      setError(
        errorMessage(caught) === "Request failed (403)."
          ? "That address is not on this workspace's access list."
          : errorMessage(caught),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen w-screen bg-background flex items-center justify-center p-4 select-none relative overflow-hidden">
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-primary/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-surface border border-subtle rounded-2xl shadow-2xl p-8 relative z-10">
        <div className="text-center mb-7">
          <div className="inline-flex h-12 w-12 rounded-xl bg-accent-primary items-center justify-center font-bold text-accent-contrast shadow-lg shadow-accent-primary/40 mb-3 text-lg">
            C
          </div>
          <h2 className="text-xl font-bold text-primary tracking-tight">Sign in to CASE</h2>
          <p className="text-xs text-muted mt-1">
            Cognitive-auditable workflow orchestration
          </p>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(email);
          }}
          className="space-y-3"
        >
          <label className="block">
            <span className="text-[11px] font-medium text-muted uppercase tracking-wide">
              Work email or member id
            </span>
            <div className="relative mt-1.5">
              <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-faint" />
              <input
                type="text"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@agency.gov.my"
                autoComplete="username"
                className="w-full bg-background border border-subtle rounded-lg pl-9 pr-3 py-2.5 text-sm text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/60"
              />
            </div>
          </label>

          {(error ?? sessionError) && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
              {error ?? sessionError}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-sm transition-colors shadow-md shadow-accent-primary/30 disabled:opacity-60"
          >
            {busy ? (
              <span className="w-4 h-4 border-2 border-accent-contrast/40 border-t-accent-contrast rounded-full animate-spin" />
            ) : (
              <FiArrowRight className="w-4 h-4" />
            )}
            <span>{busy ? "Checking access…" : "Continue"}</span>
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-subtle">
          <p className="text-[11px] font-medium text-muted uppercase tracking-wide mb-2">
            Workspace identities
          </p>
          <div className="space-y-1.5">
            {DEMO_IDENTITIES.map((identity) => (
              <button
                key={identity.identifier}
                type="button"
                onClick={() => {
                  setEmail(identity.identifier);
                  void submit(identity.identifier);
                }}
                disabled={busy}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-subtle bg-surface hover:bg-surface-hover text-xs text-secondary transition-colors disabled:opacity-60"
              >
                <span className="flex items-center gap-2">
                  <FiShield className="w-3.5 h-3.5 text-accent-primary" />
                  {identity.label}
                </span>
                <span className="font-mono text-[10px] text-faint">
                  {identity.identifier}
                </span>
              </button>
            ))}
          </div>
        </div>

        <p className="mt-5 flex items-start gap-1.5 text-[11px] text-faint leading-relaxed">
          <FiLock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Access is a whitelist: an admin invites an email, and only that address
            can sign in. Removing access blocks the account but keeps its audit
            history.
          </span>
        </p>
      </div>
    </div>
  );
};

export default Login;
