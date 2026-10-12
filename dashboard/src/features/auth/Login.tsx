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
    <div className="h-screen w-screen bg-[#0b0f19] flex items-center justify-center p-4 select-none relative overflow-hidden">
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl p-8 relative z-10">
        {/* Header & Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl bg-cyan-500 items-center justify-center font-bold text-slate-950 shadow-lg shadow-cyan-500/20 mb-3 text-lg">
            C
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Sign in to CASE
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Secure and transparent open-source workflow orchestration platform
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400 text-xs">
            <FiAlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Credentials Form */}
        <form onSubmit={handleStandardLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Email Address
            </label>
            <div className="relative">
              <FiMail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-xs font-medium text-slate-300">
                Password
              </label>
              <button
                type="button"
                onClick={() => alert("Password reset workflow placeholder")}
                className="text-[11px] text-cyan-400 hover:underline"
              >
                Forgot?
              </button>
            </div>
            <div className="relative">
              <FiLock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          {/* Primary Submit Button */}
          <button
            type="submit"
            className="w-full py-2.5 px-4 mt-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs rounded-lg transition-all shadow-md shadow-cyan-400/20 flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <span>Sign In to Dashboard</span>
            <FiArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-6 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <span className="relative bg-[#0f172a] px-2 text-[10px] uppercase font-semibold text-slate-500">
            or continue with
          </span>
        </div>

        {/* Google Authentication */}
        <button
          type="button"
          onClick={handleGoogleSignIn}
          className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 text-slate-200 font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-2.5"
        >
          <FcGoogle className="w-4 h-4" />
          <span>Sign in with Google</span>
        </button>

        {/* Initial Host Setup / First Admin Creation */}
        {isFirstTimeSetup ? (
          <div className="mt-6 pt-5 border-t border-slate-800/80 text-center">
            <div className="inline-flex items-center gap-1.5 text-[11px] text-cyan-400/90 bg-cyan-500/10 px-2.5 py-1 rounded-full border border-cyan-500/20 mb-2">
              <FiShield className="w-3.5 h-3.5" />
              <span>Initial Instance Setup Detected</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Are you the host administrator setting up this platform instance?
            </p>
            <button
              type="button"
              onClick={handleInitialAdminSetup}
              className="mt-2 text-xs font-semibold text-cyan-400 hover:text-cyan-300 hover:underline"
            >
              Initialize Host Admin Account
            </button>
          </div>
        ) : (
          <p className="mt-6 text-center text-[11px] text-slate-500">
            Need access? Team member accounts require an invitation link from
            your platform admin.
          </p>
        )}
      </div>
    </div>
  );
};

export default Login;