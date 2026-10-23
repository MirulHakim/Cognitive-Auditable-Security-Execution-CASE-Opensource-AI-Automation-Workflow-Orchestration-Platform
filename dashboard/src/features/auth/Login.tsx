import React, { useState } from "react";
import { FiShield } from "react-icons/fi";

interface LoginProps {
  onLoginSuccess: (userRole: "admin" | "staff" | "auditor") => void;
  onNavigateToSignUp?: () => void;
}

/** Official Google "G" mark (4-color) for the enterprise SSO button. */
const GoogleGIcon: React.FC<{ className?: string }> = ({
  className = "w-4 h-4",
}) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18A10.97 10.97 0 0 0 1 12c0 1.77.43 3.45 1.18 4.94l3.66-2.84z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
    />
  </svg>
);

export const Login: React.FC<LoginProps> = ({
  onLoginSuccess,
  onNavigateToSignUp,
}) => {
  const [isAuthing, setIsAuthing] = useState(false);

  // PROTOTYPING FLAG:
  // Set to true to simulate a fresh installation (only the primary host admin can sign up)
  // When set to false, only direct login is available; invitees must use their token link.
  const isFirstTimeSetup = true;

  const handleGoogleSignIn = () => {
    if (isAuthing) return;
    setIsAuthing(true);

    // =========================================================================
    // TODO: GOOGLE OAUTH LOGIC
    // 1. Trigger OAuth2 popup or redirect flow with the Google provider.
    // 2. Verify the account domain is on the corporate whitelist, or that a
    //    pending workspace invitation exists for this address.
    // 3. Exchange the assertion for a session JWT and resolve the user's role
    //    ('admin' | 'staff' | 'auditor').
    // =========================================================================

    // Prototyping mock: brief Google Workspace round-trip, then enter as admin.
    window.setTimeout(() => {
      setIsAuthing(false);
      onLoginSuccess("admin");
    }, 1600);
  };

  const handleInitialAdminSetup = () => {
    // =========================================================================
    // TODO: INITIAL HOST ONBOARDING LOGIC
    // 1. Check database if ANY admin account exists.
    // 2. If count === 0, allow this root account creation.
    // 3. Otherwise, reject and permanently disable this action.
    // =========================================================================
    // Switch view to SignUp screen:
    if (onNavigateToSignUp) {
      onNavigateToSignUp();
    } else {
      alert("Routing to primary platform setup wizard...");
    }
  }

  return (
    <div className="h-screen w-screen bg-background flex items-center justify-center p-4 select-none relative overflow-hidden">
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-primary/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-surface border border-subtle rounded-2xl shadow-2xl p-8 relative z-10">
        {/* Header & Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl bg-accent-primary items-center justify-center font-bold text-accent-contrast shadow-lg shadow-accent-primary/40 mb-3 text-lg">
            C
          </div>
          <h2 className="text-xl font-bold text-primary tracking-tight">
            Sign in to CASE
          </h2>
          <p className="text-xs text-muted mt-1">
            Secure and transparent open-source workflow orchestration platform
          </p>
        </div>

        {/* Google Workspace OAuth — the only sign-in method */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          disabled={isAuthing}
          aria-busy={isAuthing}
          className="w-full py-3 px-4 bg-white hover:bg-[#f8f9fa] active:bg-[#f1f3f4] disabled:cursor-wait border border-[#dadce0] rounded-lg font-medium text-sm text-[#3c4043] shadow-sm transition-colors flex items-center justify-center gap-3"
        >
          {isAuthing ? (
            <>
              <span className="w-4 h-4 border-2 border-[#dadce0] border-t-[#3c4043] rounded-full animate-spin" />
              <span>Authenticating via Google Workspace...</span>
            </>
          ) : (
            <>
              <GoogleGIcon className="w-[18px] h-[18px]" />
              <span>Sign in with Google</span>
            </>
          )}
        </button>

        {/* Access policy copy */}
        <p className="mt-4 text-center text-[11px] text-muted leading-relaxed">
          Access is restricted to whitelisted corporate Google accounts and
          invited users only — personal Google accounts are not permitted.
        </p>

        {/* Initial Host Setup / First Admin Creation */}
        {isFirstTimeSetup ? (
          <div className="mt-6 pt-5 border-t border-subtle/80 text-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-accent-primary/90 bg-accent-primary/10 px-2.5 py-1 rounded-full border border-accent-primary/20 mb-2">
              <FiShield className="w-3.5 h-3.5" />
              <span>Initial Instance Setup Detected</span>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">
              Are you the host administrator setting up this platform instance?
            </p>
            <button
              type="button"
              onClick={handleInitialAdminSetup}
              className="mt-2 text-xs font-semibold text-accent-primary hover:text-accent-primary hover:underline"
            >
              Initialize Host Admin Account
            </button>
          </div>
        ) : (
          <p className="mt-6 text-center text-[11px] text-faint">
            Need access? Team member accounts require an invitation link from
            your platform admin.
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;