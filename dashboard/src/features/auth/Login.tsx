import React, { useState } from "react";
import { FiArrowRight, FiLock, FiMail, FiShield } from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";
import {
  DEMO_IDENTITIES,
  errorMessage,
  getIdentity,
  startGoogleSignIn,
} from "../../api/client";
import { useSession } from "../../context/SessionContext";

/** Local demo identities only work with AUTH_ALLOW_LEGACY_IDENTITY=true. */
const SHOW_DEV_IDENTITIES = import.meta.env.VITE_DEV_IDENTITIES === "true";

const AUTH_FAILURE_COPY: Record<string, string> = {
  INVITATION_REQUIRED:
    "That Google account has not been invited to this workspace. Ask an administrator for an invitation.",
  ACCESS_REVOKED: "This account's workspace access has been revoked.",
  OAUTH_STATE_INVALID: "The sign-in attempt expired or was tampered with. Please try again.",
  OAUTH_CODE_MISSING: "Google did not return an authorization code. Please try again.",
  GOOGLE_EXCHANGE_FAILED: "Google sign-in could not be verified. Please try again.",
  IDENTITY_CONFLICT:
    "This Google account is already linked to a different member. Contact an administrator.",
};

function initialAuthError(): string | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") !== "failed") return null;
  const reason = params.get("reason") ?? "";
  return AUTH_FAILURE_COPY[reason] ?? "Sign-in could not be completed. Please try again.";
}

/**
 * Google is the primary sign-in. The gateway handles OAuth, sets an HttpOnly
 * cookie, and redirects back here; the dashboard never receives the JWT.
 *
 * The legacy email/member-id form is kept behind VITE_DEV_IDENTITIES=true for
 * local demos that run the gateway with AUTH_ALLOW_LEGACY_IDENTITY=true.
 */
export const Login: React.FC = () => {
  const { signIn, error: sessionError } = useSession();
  const [email, setEmail] = useState(() => getIdentity() ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialAuthError);

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

        <button
          type="button"
          onClick={() => {
            setError(null);
            startGoogleSignIn();
          }}
          className="w-full inline-flex items-center justify-center gap-2.5 py-2.5 rounded-lg bg-surface-hover border border-strong hover:border-accent-primary/60 text-primary font-semibold text-sm transition-colors shadow-sm"
        >
          <FcGoogle className="w-5 h-5" />
          <span>Continue with Google</span>
        </button>

        <p className="mt-3 text-center text-[11px] text-faint leading-relaxed">
          Invitation-only: sign in with the Google account an administrator invited.
        </p>

        {(error ?? sessionError) && (
          <p className="mt-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
            {error ?? sessionError}
          </p>
        )}

        {SHOW_DEV_IDENTITIES && (
          <>
            <div className="mt-6 pt-5 border-t border-subtle">
              <p className="text-[11px] font-medium text-muted uppercase tracking-wide mb-2">
                Development identity
              </p>
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

              <div className="mt-4 space-y-1.5">
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
          </>
        )}

        <p className="mt-5 flex items-start gap-1.5 text-[11px] text-faint leading-relaxed">
          <FiLock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Sessions use short-lived JWTs in HttpOnly cookies. Invitations expire
            after two hours; revoked members keep their audit history.
          </span>
        </p>
      </div>
    </div>
  );
};

export default Login;
