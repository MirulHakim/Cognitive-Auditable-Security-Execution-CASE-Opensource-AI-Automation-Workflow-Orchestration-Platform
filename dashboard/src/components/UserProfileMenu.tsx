import React, { useState, useRef, useEffect } from "react";
import {
  FiUser,
  FiSettings,
  FiShield,
  FiUserCheck,
  FiEye,
  FiLogOut,
  FiExternalLink,
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
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <FiShield className="w-2.5 h-2.5" />
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <FiEye className="w-2.5 h-2.5" />
            Auditor
          </span>
        );
      case "staff":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
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
        className="flex items-center gap-2 p-1 rounded-full hover:ring-2 hover:ring-cyan-500/40 transition-all focus:outline-none"
        aria-label="User profile menu"
      >
        <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-slate-200 hover:border-cyan-400 transition-colors">
          {user.avatarInitials}
        </div>
      </button>

      {/* Floating Profile Popover Card */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
          {/* User Details Header */}
          <div className="p-4 bg-slate-900/50 border-b border-slate-800 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-sm font-bold text-cyan-400 shrink-0">
              {user.avatarInitials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-1">
                <h4 className="text-xs font-bold text-white truncate">
                  {user.name}
                </h4>
                {getRoleBadge(user.role)}
              </div>
              <p className="text-[11px] text-slate-400 truncate mt-0.5">
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
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors"
            >
              <FiSettings className="w-4 h-4 text-slate-400" />
              <span>Account Settings</span>
            </button>

            {onNavigateToIntegrations && (
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onNavigateToIntegrations();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/70 transition-colors"
              >
                <FiLock className="w-4 h-4 text-cyan-400" />
                <span>My Secrets & Tokens</span>
              </button>
            )}

            <div className="my-1.5 border-t border-slate-800/80" />

            {/* Logout Action */}
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                onLogout();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors font-medium"
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
