import React, { useState, useRef } from "react";
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
  FiServer,
  FiWifi,
  FiAlertCircle,
  FiCamera,
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
  // Profile State (corporate email is SSO-managed and read-only below)
  const [name, setName] = useState(currentUser.name);
  const [contactNumber, setContactNumber] = useState("+60 12-345 6789");
  const [avatarInitials, setAvatarInitials] = useState("AR");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const avatarFileRef = useRef<HTMLInputElement>(null);

  // Security State
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);

  // Preference State
  const [canvasSound, setCanvasSound] = useState(true);
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [autoSaveCanvas, setAutoSaveCanvas] = useState(true);

  // Local LLM Infrastructure State (admin only — card is role-gated below)
  const [llmHost, setLlmHost] = useState("http://192.168.1.100");
  const [llmPort, setLlmPort] = useState("8080");
  const [contextWindow, setContextWindow] = useState("32k");
  const [llmStatus, setLlmStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [llmMessage, setLlmMessage] = useState("");

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

  // Simulated profile-picture upload: pick a local file, show a brief
  // uploading state, then swap the initials avatar for the real preview.
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingAvatar(true);
    const previewUrl = URL.createObjectURL(file);
    window.setTimeout(() => {
      setAvatarUrl(previewUrl);
      setIsUploadingAvatar(false);
    }, 900);
    e.target.value = "";
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

  const handleTestLlmConnection = () => {
    const host = llmHost.trim();
    const port = llmPort.trim();

    if (!host || !port) {
      setLlmStatus("error");
      setLlmMessage("Enter a server host and API port before testing.");
      return;
    }
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
      setLlmStatus("error");
      setLlmMessage("API port must be a whole number between 1 and 65535.");
      return;
    }

    setLlmStatus("testing");
    setLlmMessage("");

    // =========================================================================
    // TODO: REAL INFRASTRUCTURE PING
    // GET {host}:{port}/v1/models with a short timeout and report latency
    // from the on-premise inference server.
    // =========================================================================

    // Prototyping mock: simulate pinging the local hardware.
    window.setTimeout(() => {
      setLlmStatus("success");
      setLlmMessage(
        `llama-3-70b-instruct reachable at ${host}:${port} — handshake 41 ms · context window ${contextWindow}`,
      );
    }, 1400);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-primary">
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

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {/* Left Column: Account Profile & Preferences */}
        <div className="md:col-span-2 xl:col-span-2 space-y-6">
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
                    Contact Number
                  </label>
                  <input
                    type="tel"
                    value={contactNumber}
                    onChange={(e) => setContactNumber(e.target.value)}
                    placeholder="+60 12-345 6789"
                    className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                  />
                </div>
              </div>

              {/* Corporate email is managed by Google SSO — read-only */}
              <div>
                <label className="block text-secondary font-medium mb-1">
                  Email Address
                </label>
                <div className="w-full bg-surface-sunken/60 border border-subtle rounded-lg px-3 py-2 flex items-center justify-between gap-2 text-primary">
                  <span className="truncate">{currentUser.email}</span>
                  <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border bg-accent-primary/10 text-accent-primary/90 border-accent-primary/20 whitespace-nowrap">
                    SSO · READ-ONLY
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-subtle/80">
                <div className="flex items-center gap-2.5">
                  {/* Profile picture + upload overlay button */}
                  <div className="relative group w-9 h-9 shrink-0">
                    <div className="w-full h-full rounded-full bg-surface-hover border border-strong flex items-center justify-center overflow-hidden text-[10px] font-bold text-accent-primary">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt="Profile preview"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        avatarInitials
                      )}
                    </div>
                    <button
                      type="button"
                      title="Upload profile picture"
                      aria-label="Upload profile picture"
                      onClick={() => avatarFileRef.current?.click()}
                      className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-surface border border-strong shadow-md flex items-center justify-center text-muted hover:text-accent-primary hover:border-accent-primary/50 transition-colors"
                    >
                      {isUploadingAvatar ? (
                        <span className="w-2.5 h-2.5 border border-strong border-t-accent-primary rounded-full animate-spin" />
                      ) : (
                        <FiCamera className="w-2.5 h-2.5" />
                      )}
                    </button>
                    <input
                      ref={avatarFileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleAvatarFileChange}
                    />
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

          {/* Local LLM Infrastructure — visible to admins only */}
          {currentUser.role === "admin" && (
            <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm">
              <div className="flex items-center gap-2.5 pb-4 border-b border-subtle">
                <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
                  <FiServer className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">
                    Local LLM Infrastructure
                  </h3>
                  <p className="text-[11px] text-muted">
                    On-Premise AI Engine — the local LLaMA 3 instance every AI
                    node calls.
                  </p>
                </div>
              </div>

              <p className="mt-4 text-[11px] text-muted leading-relaxed">
                CASE routes prompts to this local LLaMA 3 model so documents
                and payloads stay inside your network — nothing is sent to
                external cloud providers — while Malay language processing
                runs natively on your own hardware.
              </p>

              <div className="mt-4 space-y-3.5 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-2">
                    <label className="block text-secondary font-medium mb-1">
                      Server IP / Host URL
                    </label>
                    <input
                      type="text"
                      value={llmHost}
                      onChange={(e) => setLlmHost(e.target.value)}
                      placeholder="https://llm.internal.case"
                      className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                    />
                  </div>

                  <div>
                    <label className="block text-secondary font-medium mb-1">
                      API Port
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={llmPort}
                      onChange={(e) => setLlmPort(e.target.value)}
                      placeholder="8080"
                      className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-secondary font-medium mb-1">
                      Context Window Limit
                    </label>
                    <select
                      value={contextWindow}
                      onChange={(e) => setContextWindow(e.target.value)}
                      className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary focus:outline-none focus:border-accent-primary/50"
                    >
                      <option value="8k">8k tokens</option>
                      <option value="16k">16k tokens</option>
                      <option value="32k">32k tokens</option>
                      <option value="64k">64k tokens</option>
                      <option value="128k">128k tokens</option>
                    </select>
                  </div>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={handleTestLlmConnection}
                      disabled={llmStatus === "testing"}
                      className="w-full inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-secondary disabled:opacity-60 disabled:cursor-wait transition-colors font-medium text-xs"
                    >
                      {llmStatus === "testing" ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-strong border-t-accent-primary rounded-full animate-spin" />
                          <span>Pinging local server...</span>
                        </>
                      ) : (
                        <>
                          <FiWifi className="w-3.5 h-3.5 text-accent-primary" />
                          <span>Test Server Connection</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {llmStatus === "success" && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-success/10 border border-success/20 text-success text-[11px] leading-relaxed">
                    <FiCheck className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{llmMessage}</span>
                  </div>
                )}

                {llmStatus === "error" && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-danger/10 border border-danger/20 text-danger text-[11px] leading-relaxed">
                    <FiAlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{llmMessage}</span>
                  </div>
                )}
              </div>
            </div>
          )}

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
        <div className="md:col-span-2 xl:col-span-1 space-y-6">
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
