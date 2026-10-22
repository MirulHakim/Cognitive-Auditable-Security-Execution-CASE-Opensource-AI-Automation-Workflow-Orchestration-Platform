import React, { useState } from "react";
import {
  FiLock,
  FiMail,
  FiArrowRight,
  FiShield,
  FiAlertCircle,
} from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";

interface LoginProps {
  onLoginSuccess: (userRole: "admin" | "staff" | "auditor") => void;
  onNavigateToSignUp?: () => void;
}

export const Login: React.FC<LoginProps> = ({
  onLoginSuccess,
  onNavigateToSignUp,
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // PROTOTYPING FLAG:
  // Set to true to simulate a fresh installation (only the primary host admin can sign up)
  // When set to false, only direct login is available; invitees must use their token link.
  const isFirstTimeSetup = true;

  const handleStandardLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email || !password) {
      setError("Please provide both email and password.");
      return;
    }

    // =========================================================================
    // TODO: AUTHENTICATION BACKEND LOGIC
    // 1. Call your auth API endpoint (e.g. POST /api/auth/login)
    // 2. Validate password hash & receive JWT / session cookie
    // 3. Extract the authenticated user's role ('admin' | 'staff' | 'auditor')
    // =========================================================================

    // Prototyping mock: Grant admin role and transition to dashboard
    onLoginSuccess("admin");
  };

  const handleGoogleSignIn = () => {
    // =========================================================================
    // TODO: GOOGLE OAUTH LOGIC
    // 1. Trigger OAuth2 popup or redirect flow with Google provider
    // 2. Verify account matches registered organization or allowed admin identity
    // =========================================================================

    // Prototyping mock: Route straight into dashboard as admin
    onLoginSuccess("admin");
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
  };;

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

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg flex items-center gap-2 text-danger text-xs">
            <FiAlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleStandardLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-secondary mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <FiMail className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-surface-sunken border border-subtle rounded-lg pl-9 pr-3 py-2 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-secondary">
                Password
              </label>
              <button
                type="button"
                onClick={() => alert("Password reset workflow placeholder")}
                className="text-[11px] text-accent-primary hover:underline"
              >
                Forgot?
              </button>
            </div>
            <div className="relative">
              <FiLock className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-surface-sunken border border-subtle rounded-lg pl-9 pr-3 py-2 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
              />
            </div>
          </div>

          {/* Primary Submit Button */}
          <button
            type="submit"
            className="w-full py-2.5 px-4 mt-2 bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs rounded-lg transition-all shadow-md shadow-accent-primary/40 flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <span>Sign In to Dashboard</span>
            <FiArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-subtle" />
          </div>
          <span className="relative bg-surface px-2 text-[10px] uppercase font-semibold text-faint">
            or continue with
          </span>
        </div>

        {/* Google Authentication */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full py-2.5 px-4 bg-surface-sunken hover:bg-surface-hover/80 border border-subtle hover:border-strong text-secondary font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-2.5"
        >
          <FcGoogle className="w-4 h-4" />
          <span>Sign in with Google</span>
        </button>

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