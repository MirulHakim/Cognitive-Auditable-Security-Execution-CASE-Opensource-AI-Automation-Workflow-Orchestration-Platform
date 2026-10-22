import React, { useState } from "react";
import {
  FiUser,
  FiLock,
  FiBell,
  FiSliders,
  FiSave,
  FiCheck,
  FiLogOut,
  FiShield,
  FiKey,
} from "react-icons/fi";
import ConfirmModal from "../../components/ConfirmModal";

interface SettingsViewProps {
  currentUser?: {
    name: string;
    email: string;
    role: "admin" | "staff" | "auditor";
  };
  onLogout: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  currentUser = {
    name: "Amirul Rosazlan",
    email: "amirul@axiomflow.internal",
    role: "admin",
  },
  onLogout,
}) => {
  // Profile State
  const [name, setName] = useState(currentUser.name);
  const [email, setEmail] = useState(currentUser.email);
  const [avatarInitials, setAvatarInitials] = useState("AR");

  // Security State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  // Preference State
  const [canvasSound, setCanvasSound] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [autoSaveCanvas, setAutoSaveCanvas] = useState(true);

  // Feedback State
  const [profileSaved, setProfileSaved] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaved(true);
    setTimeout(() => setProfileSaved(false), 2500);
  };

  const handleUpdatePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword) {
      setPasswordStatus("Please provide your current password.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordStatus("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPasswordStatus("New password must be at least 8 characters long.");
      return;
    }

    setPasswordStatus("Password updated successfully!");
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setTimeout(() => setPasswordStatus(null), 3000);
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto text-slate-100">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">
          System & Account Settings
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Manage your personal credentials, workspace preferences, and session
          controls.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Account Profile & Preferences */}
        <div className="md:col-span-2 space-y-6">
          {/* Profile Card */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <FiUser className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Profile Details
                </h3>
                <p className="text-[11px] text-slate-400">
                  Update your identity shown across workflow logs and comments.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleSaveProfile}
              className="mt-4 space-y-4 text-xs"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Display Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      const parts = e.target.value.split(" ");
                      setAvatarInitials(
                        parts
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase() || "AF",
                      );
                    }}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500/50"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-bold text-cyan-400">
                    {avatarInitials}
                  </div>
                  <span className="text-[11px] text-slate-400">
                    Role:{" "}
                    <span className="text-slate-200 capitalize font-medium">
                      {currentUser.role}
                    </span>
                  </span>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold transition-colors shadow-sm shadow-cyan-400/20"
                >
                  {profileSaved ? (
                    <>
                      <FiCheck className="w-3.5 h-3.5" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <>
                      <FiSave className="w-3.5 h-3.5" />
                      <span>Save Changes</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Canvas & Notification Preferences */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
                <FiSliders className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Editor Preferences
                </h3>
                <p className="text-[11px] text-slate-400">
                  Tailor your workflow canvas feedback and trigger
                  notifications.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#0b0f19] border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="text-white font-medium block">
                    Auto-save Canvas Changes
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Automatically persist nodes and connection wires every 60
                    seconds.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoSaveCanvas}
                  onChange={(e) => setAutoSaveCanvas(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#0b0f19] border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="text-white font-medium block">
                    Audio Feedback on Snapping
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Play a gentle snap chime when wires successfully attach to
                    ports.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={canvasSound}
                  onChange={(e) => setCanvasSound(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-[#0b0f19] border border-slate-800/80 cursor-pointer">
                <div>
                  <span className="text-white font-medium block">
                    High-Priority Alert Digests
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Receive inbox emails when an automated agent encounters a
                    failover.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-cyan-400 focus:ring-0"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Password & Session Logout */}
        <div className="space-y-6">
          {/* Change Password Card */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <FiKey className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Update Password
                </h3>
                <p className="text-[11px] text-slate-400">
                  Secure your platform credentials.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleUpdatePassword}
              className="mt-4 space-y-3 text-xs"
            >
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 chars"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-1.5 text-white font-mono placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              {passwordStatus && (
                <p
                  className={`text-[11px] mt-1 ${
                    passwordStatus.includes("successfully")
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {passwordStatus}
                </p>
              )}

              <button
                type="submit"
                className="w-full mt-2 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-slate-200 transition-colors font-medium text-xs"
              >
                Change Password
              </button>
            </form>
          </div>

          {/* Session / Danger Zone */}
          <div className="bg-[#0f172a] border border-rose-500/20 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center">
                <FiLogOut className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">
                  Active Session
                </h3>
                <p className="text-[11px] text-slate-400">
                  Exit and invalidate your access token.
                </p>
              </div>
            </div>

            <div className="mt-3 text-xs space-y-3">
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Signing out will flush your local canvas draft caches and
                require re-authentication.
              </p>

              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold text-xs transition-colors"
              >
                <FiLogOut className="w-3.5 h-3.5" />
                <span>Log Out of AxiomFlow</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Logout Confirmation Modal */}
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign Out of Session"
        message="Are you sure you want to log out? Any unsaved edits on active workflow canvases may be lost."
        confirmLabel="Yes, Log Out"
        cancelLabel="Stay Signed In"
        variant="danger"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          onLogout();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />
    </div>
  );
};

export default SettingsView;
