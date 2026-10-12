import React, { useState } from "react";
import {
  FiLock,
  FiMail,
  FiUser,
  FiArrowRight,
  FiShield,
  FiAlertCircle,
  FiArrowLeft,
  FiCheckCircle,
} from "react-icons/fi";
import { FcGoogle } from "react-icons/fc";

interface SignUpProps {
  // If an invite token exists in URL or props, the form locks to that email & role
  inviteToken?: string;
  isInitialAdminSetup?: boolean;
  onSignUpSuccess: (userRole: "admin" | "staff" | "auditor") => void;
  onNavigateToLogin: () => void;
}

export const SignUp: React.FC<SignUpProps> = ({
  inviteToken,
  isInitialAdminSetup = true, // Default to true for prototyping initial setup
  onSignUpSuccess,
  onNavigateToLogin,
}) => {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(
    inviteToken ? "invited.colleague@axiomflow.internal" : "",
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // If invited, role is predetermined by the inviter; if initial admin, it's admin
  const assignedRole: "admin" | "staff" | "auditor" = isInitialAdminSetup
    ? "admin"
    : "staff";

  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fullName || !email || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }

    // =========================================================================
    // TODO: BACKEND SIGN-UP & INVITATION VALIDATION LOGIC
    // 1. If isInitialAdminSetup:
    //    - Verify instance DB has 0 admins.
    //    - Hash password and create Root Admin user (role: 'admin').
    // 2. If inviteToken:
    //    - POST /api/auth/register-invite with { token, fullName, password }
    //    - Verify token is valid & not expired.
    //    - Consume token and create user with the assigned role from DB.
    // 3. Return session/JWT cookie.
    // =========================================================================

    // Prototyping mock: Route into dashboard with the target role
    onSignUpSuccess(assignedRole);
  };

  const handleGoogleSignUp = () => {
    // =========================================================================
    // TODO: GOOGLE SSO LINKING
    // 1. If initial admin: Link Google ID to primary Root Admin.
    // 2. If inviteToken: Link Google ID to the specific invited email address.
    // =========================================================================
    onSignUpSuccess(assignedRole);
  };

  return (
    <div className="h-screen w-screen bg-[#0b0f19] flex items-center justify-center p-4 select-none relative overflow-hidden">
      {/* Background Ambience */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl p-8 relative z-10">
        {/* Back to Login link */}
        <button
          type="button"
          onClick={onNavigateToLogin}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 transition-colors mb-6"
        >
          <FiArrowLeft className="w-3.5 h-3.5" />
          <span>Back to sign in</span>
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex h-12 w-12 rounded-xl bg-cyan-500 items-center justify-center font-bold text-slate-950 shadow-lg shadow-cyan-500/20 mb-3 text-lg">
            C
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {isInitialAdminSetup
              ? "Initialize Instance Admin"
              : "Accept Invitation & Register"}
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {isInitialAdminSetup
              ? "Configure the primary root account for this CASE deployment."
              : "Complete your profile to join your workspace team."}
          </p>
        </div>

        {/* Setup Badge */}
        <div className="mb-5 flex justify-center">
          {isInitialAdminSetup ? (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
              <FiShield className="w-3.5 h-3.5" />
              <span>Role: Primary Host Admin</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
              <FiCheckCircle className="w-3.5 h-3.5" />
              <span>Invited as: {assignedRole.toUpperCase()}</span>
            </div>
          )}
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg flex items-center gap-2 text-rose-400 text-xs">
            <FiAlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Registration Form */}
        <form onSubmit={handleSignUpSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Full Legal Name
            </label>
            <div className="relative">
              <FiUser className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Amirul Hakimi"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Corporate Email Address
            </label>
            <div className="relative">
              <FiMail className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                disabled={Boolean(inviteToken)} // Invited email is fixed by admin token
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@axiomflow.internal"
                className={`w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors ${
                  inviteToken ? "opacity-60 cursor-not-allowed" : ""
                }`}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Password
            </label>
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

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Confirm Password
            </label>
            <div className="relative">
              <FiLock className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-2.5 px-4 mt-2 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs rounded-lg transition-all shadow-md shadow-cyan-400/20 flex items-center justify-center gap-2 active:scale-[0.99]"
          >
            <span>
              {isInitialAdminSetup
                ? "Initialize & Launch Platform"
                : "Complete Registration"}
            </span>
            <FiArrowRight className="w-3.5 h-3.5 stroke-[2.5]" />
          </button>
        </form>

        {/* Google SSO Alternative */}
        <div className="relative my-5 text-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-800" />
          </div>
          <span className="relative bg-[#0f172a] px-2 text-[10px] uppercase font-semibold text-slate-500">
            or connect with
          </span>
        </div>

        <button
          type="button"
          onClick={handleGoogleSignUp}
          className="w-full py-2.5 px-4 bg-slate-900 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700 text-slate-200 font-medium text-xs rounded-lg transition-colors flex items-center justify-center gap-2.5"
        >
          <FcGoogle className="w-4 h-4" />
          <span>Sign up with Google</span>
        </button>
      </div>
    </div>
  );
};

export default SignUp;
