import React, { useState, useRef, useEffect } from "react";
import {
  FiSettings,
  FiShield,
  FiUserCheck,
  FiEye,
  FiLogOut,
  FiLock,
} from "react-icons/fi";

export interface UserProfile {
  name: string;
  email: string;
  role: "admin" | "staff" | "auditor";
  avatarInitials: string;
}

interface UserProfileMenuProps {
  user: UserProfile;
  onNavigateToSettings: () => void;
  onNavigateToIntegrations?: () => void;
  onLogout: () => void;
}

// UI-REGION: Profile dropdown menu — user identity, role badge, and
// settings/integrations/logout actions. Presentational: the `user` prop is
// supplied by App from the auth session.
export const UserProfileMenu: React.FC<UserProfileMenuProps> = ({
  user,
  onNavigateToSettings,
  onNavigateToIntegrations,
  onLogout,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      return () =>
        document.removeEventListener("mousedown", handleOutsideClick);
    }
  }, [isOpen]);

  const getRoleBadge = (role: "admin" | "staff" | "auditor") => {
    switch (role) {
      case "admin":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-danger/10 text-danger border border-danger/20">
            <FiShield className="w-2.5 h-2.5" />
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-warning/10 text-warning border border-warning/20">
            <FiEye className="w-2.5 h-2.5" />
            Auditor
          </span>
        );
      case "staff":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <FiUserCheck className="w-2.5 h-2.5" />
            Staff
          </span>
        );
    }
  };

  return (
    <div ref={menuRef} className="relative select-none">
      {/* Clickable Header Avatar Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-accent-primary/40 transition-all focus:outline-none"
        aria-label="User profile menu"
      >
        <div className="w-8 h-8 rounded-full bg-surface-hover border border-strong flex items-center justify-center text-xs font-semibold text-secondary hover:border-accent-primary transition-colors">
          {user.avatarInitials}
        </div>
      </button>

      {/* Floating Profile Popover Card */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-surface border border-subtle rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* User Details Header */}
          <div className="p-4 bg-surface-sunken/50 border-b border-subtle flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-accent-primary/10 border border-accent-primary/30 flex items-center justify-center text-sm font-bold text-accent-primary shrink-0">
              {user.avatarInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4 className="text-xs font-bold text-primary truncate">
                  {user.name}
                </h4>
                {getRoleBadge(user.role)}
              </div>
              <p className="text-[11px] text-muted truncate mt-0.5">
                {user.email}
              </p>
            </div>
          </div>

          {/* Quick Menu Options */}
          <div className="p-2 space-y-0.5 text-xs">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onNavigateToSettings();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover/70 transition-colors"
            >
              <FiSettings className="w-4 h-4 text-muted" />
              <span>Account Settings</span>
            </button>

            {onNavigateToIntegrations && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToIntegrations();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-secondary hover:text-primary hover:bg-surface-hover/70 transition-colors"
              >
                <FiLock className="w-4 h-4 text-accent-primary" />
                <span>My Secrets & Tokens</span>
              </button>
            )}

            <div className="my-1.5 border-t border-subtle/80" />

            {/* Logout Action */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-danger hover:text-danger hover:bg-danger-fill-hover/10 transition-colors font-medium"
            >
              <FiLogOut className="w-4 h-4" />
              <span>Sign Out of Session</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserProfileMenu;
