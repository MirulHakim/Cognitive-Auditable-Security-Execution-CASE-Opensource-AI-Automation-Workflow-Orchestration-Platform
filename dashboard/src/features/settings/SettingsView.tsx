import React, { useState } from "react";
import type { IconType } from "react-icons";
import {
  FiUser,
  FiSliders,
  FiSave,
  FiCheck,
  FiLogOut,
  FiKey,
  FiSun,
  FiMoon,
  FiMonitor,
  FiAperture,
} from "react-icons/fi";
import ConfirmModal from "../../components/ConfirmModal";
import { useTheme, type ThemePreference } from "../../contexts/ThemeContext";

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

  // Theme State (persisted via ThemeContext)
  const { theme, resolvedTheme, setTheme } = useTheme();

  const themeOptions: Array<{
    value: ThemePreference;
    label: string;
    icon: IconType;
  }> = [
    { value: "light", label: "Light", icon: FiSun },
    { value: "dark", label: "Dark", icon: FiMoon },
    { value: "system", label: "System", icon: FiMonitor },
  ];

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
    <div className="p-6 space-y-6 max-w-5xl mx-auto text-primary">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-primary tracking-tight">
          System & Account Settings
        </h1>
        <p className="text-xs text-muted mt-1">
          Manage your personal credentials, workspace preferences, and session
          controls.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left Column: Account Profile & Preferences */}
        <div className="md:col-span-2 space-y-6">
          {/* Profile Card */}
          <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-4 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
                <FiUser className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">
                  Profile Details
                </h3>
                <p className="text-[11px] text-muted">
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
                  <label className="block text-secondary font-medium mb-1">
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
                    className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary focus:outline-none focus:border-accent-primary/50"
                  />
                </div>

                <div>
                  <label className="block text-secondary font-medium mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary focus:outline-none focus:border-accent-primary/50"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-subtle/80">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-surface-hover border border-strong flex items-center justify-center text-[10px] font-bold text-accent-primary">
                    {avatarInitials}
                  </div>
                  <span className="text-[11px] text-muted">
                    Role:{" "}
                    <span className="text-secondary capitalize font-medium">
                      {currentUser.role}
                    </span>
                  </span>
                </div>

                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
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
          <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-4 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
                <FiSliders className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">
                  Editor Preferences
                </h3>
                <p className="text-[11px] text-muted">
                  Tailor your workflow canvas feedback and trigger
                  notifications.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <label className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-subtle/80 cursor-pointer">
                <div>
                  <span className="text-primary font-medium block">
                    Auto-save Canvas Changes
                  </span>
                  <span className="text-[11px] text-muted">
                    Automatically persist nodes and connection wires every 60
                    seconds.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoSaveCanvas}
                  onChange={(e) => setAutoSaveCanvas(e.target.checked)}
                  className="w-4 h-4 rounded border-strong bg-surface-sunken text-accent-primary focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-subtle/80 cursor-pointer">
                <div>
                  <span className="text-primary font-medium block">
                    Audio Feedback on Snapping
                  </span>
                  <span className="text-[11px] text-muted">
                    Play a gentle snap chime when wires successfully attach to
                    ports.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={canvasSound}
                  onChange={(e) => setCanvasSound(e.target.checked)}
                  className="w-4 h-4 rounded border-strong bg-surface-sunken text-accent-primary focus:ring-0"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-lg bg-background border border-subtle/80 cursor-pointer">
                <div>
                  <span className="text-primary font-medium block">
                    High-Priority Alert Digests
                  </span>
                  <span className="text-[11px] text-muted">
                    Receive inbox emails when an automated agent encounters a
                    failover.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={emailAlerts}
                  onChange={(e) => setEmailAlerts(e.target.checked)}
                  className="w-4 h-4 rounded border-strong bg-surface-sunken text-accent-primary focus:ring-0"
                />
              </label>
            </div>
          </div>

          {/* Appearance Preferences */}
          <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-4 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
                <FiAperture className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">
                  Appearance
                </h3>
                <p className="text-[11px] text-muted">
                  Pick how CASE looks on this device. Your choice is saved to
                  this browser.
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                {themeOptions.map((option) => {
                  const Icon = option.icon;
                  const isActive = theme === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setTheme(option.value)}
                      aria-pressed={isActive}
                      className={`flex items-center justify-center gap-2 px-3 py-2 rounded-lg border font-medium transition-colors ${
                        isActive
                          ? "bg-accent-primary/10 border-accent-primary/50 text-accent-primary"
                          : "border-subtle bg-background text-secondary hover:text-primary hover:border-strong"
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{option.label}</span>
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-muted">
                {theme === "system"
                  ? `System mode is active — CASE currently follows your OS and is using the ${resolvedTheme} theme.`
                  : `The ${theme} theme is active across this workspace.`}
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Password & Session Logout */}
        <div className="space-y-6">
          {/* Change Password Card */}
          <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-3 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-warning/10 border border-warning/20 text-warning flex items-center justify-center">
                <FiKey className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">
                  Update Password
                </h3>
                <p className="text-[11px] text-muted">
                  Secure your platform credentials.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleUpdatePassword}
              className="mt-4 space-y-3 text-xs"
            >
              <div>
                <label className="block text-secondary font-medium mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-background border border-subtle rounded-lg px-3 py-1.5 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                />
              </div>

              <div>
                <label className="block text-secondary font-medium mb-1">
                  New Password
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 chars"
                  className="w-full bg-background border border-subtle rounded-lg px-3 py-1.5 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                />
              </div>

              <div>
                <label className="block text-secondary font-medium mb-1">
                  Confirm Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="w-full bg-background border border-subtle rounded-lg px-3 py-1.5 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                />
              </div>

              {passwordStatus && (
                <p
                  className={`text-[11px] mt-1 ${
                    passwordStatus.includes("successfully")
                      ? "text-success"
                      : "text-danger"
                  }`}
                >
                  {passwordStatus}
                </p>
              )}

              <button
                type="submit"
                className="w-full mt-2 px-3 py-1.5 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-secondary transition-colors font-medium text-xs"
              >
                Change Password
              </button>
            </form>
          </div>

          {/* Session / Danger Zone */}
          <div className="bg-surface border border-danger/20 rounded-xl p-5 shadow-sm">
            <div className="flex items-center gap-2.5 pb-3 border-b border-subtle">
              <div className="w-8 h-8 rounded-lg bg-danger/10 border border-danger/20 text-danger flex items-center justify-center">
                <FiLogOut className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-primary">
                  Active Session
                </h3>
                <p className="text-[11px] text-muted">
                  Exit and invalidate your access token.
                </p>
              </div>
            </div>

            <div className="mt-3 text-xs space-y-3">
              <p className="text-[11px] text-muted leading-relaxed">
                Signing out will flush your local canvas draft caches and
                require re-authentication.
              </p>

              <button
                type="button"
                onClick={() => setShowLogoutConfirm(true)}
                className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-danger-fill/20 hover:bg-danger-fill/30 text-danger border border-danger/30 font-semibold text-xs transition-colors"
              >
                <FiLogOut className="w-3.5 h-3.5" />
                <span>Log Out of CASE</span>
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
