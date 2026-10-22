import React, { useState, useRef, useEffect } from "react";
import Notification, { type NotificationItem } from "./Notification.tsx";
import { FiBell, FiSearch, FiChevronRight, FiPlay } from "react-icons/fi";
import UserProfileMenu, { type UserProfile } from "./UserProfileMenu";

interface HeaderProps {
  workflowName?: string;
  status?: "active" | "draft" | "paused" | "error";
  isEditing?: boolean;
  currentUser?: UserProfile;
  onNavigateToSettings?: () => void;
  onNavigateToIntegrations?: () => void;
  onLogout?: () => void;
  onSave?: () => void;
  onDeploy?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  workflowName,
  status = "active",
  isEditing = false,
  currentUser,
  onNavigateToSettings,
  onNavigateToIntegrations,
  onLogout,
  onSave,
  onDeploy,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: "1",
      title: "Workflow Execution Failed",
      description: "Zendesk Ticket Sync encountered an invalid API response.",
      time: "2 mins ago",
      type: "warning",
      read: false,
    },
    {
      id: "2",
      title: "Agent Deployed Successfully",
      description: "Urgent Support Triage v1.4 is now live.",
      time: "1 hour ago",
      type: "success",
      read: false,
    },
    {
      id: "3",
      title: "Connector Auth Expiring",
      description: "Slack OAuth token expires in 48 hours.",
      time: "3 hours ago",
      type: "info",
      read: false,
    },
  ]);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, [isOpen]);

  const statusStyles = {
    active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    draft: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    paused: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    error: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  };

  return (
    <header className="w-full h-16 bg-[#0f172a] border-b border-slate-800 text-slate-200 px-6 flex items-center justify-between select-none">
      {/* Left: Branding & Conditional Workflow Context */}
      <div className="flex items-center gap-3">
        {/* Brand / Logo */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-cyan-500 flex items-center justify-center font-bold text-slate-950 shadow-md shadow-cyan-500/20">
            C
          </div>
          <span className="font-semibold text-white tracking-tight hidden sm:inline">
            CASE
          </span>
        </div>

        {/* Workflow Title & Status: only visible while editing in canvas */}
        {isEditing && workflowName && (
          <>
            <FiChevronRight className="w-4 h-4 text-slate-600 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-slate-200">
                {workflowName}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize flex items-center gap-1.5 ${statusStyles[status]}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status === "active"
                      ? "bg-emerald-400 animate-pulse"
                      : status === "error"
                        ? "bg-rose-400"
                        : "bg-slate-400"
                  }`}
                />
                {status}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Middle: Search Bar */}
      <div className="hidden md:flex items-center relative w-72">
        <FiSearch className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Search nodes, actions, logs..."
          className="w-full bg-slate-900/60 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Right: Actions, Notifications & Profile */}
      <div className="flex items-center gap-3">
        {/* Editor Actions: only visible while editing */}
        {isEditing && (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onSave}
                className="text-xs px-3 py-1.5 rounded-md font-medium text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-colors"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={onDeploy}
                className="text-xs px-3.5 py-1.5 rounded-md font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-colors flex items-center gap-1.5 shadow-sm shadow-cyan-400/20"
              >
                <FiPlay className="w-3 h-3 fill-current" />
                <span>Deploy Agent</span>
              </button>
            </div>
            <div className="h-4 w-px bg-slate-800" />
          </>
        )}

        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`relative p-2 text-slate-400 hover:text-slate-200 hover:bg-slate-900 rounded-lg transition-colors ${
              isOpen ? "bg-slate-900 text-white" : ""
            }`}
          >
            <FiBell className="w-4 h-4" />
            {notifications.some((n) => !n.read) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-cyan-500 ring-2 ring-[#0f172a]" />
            )}
          </button>

          {isOpen && (
            <Notification
              notifications={notifications}
              onClose={() => setIsOpen(false)}
              onClearAll={() => setNotifications([])}
            />
          )}
        </div>

        {/* Profile Avatar & Dropdown */}
        {currentUser && onLogout && onNavigateToSettings ? (
          <UserProfileMenu
            user={currentUser}
            onNavigateToSettings={onNavigateToSettings}
            onNavigateToIntegrations={onNavigateToIntegrations}
            onLogout={onLogout}
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-cyan-400">
            {currentUser?.avatarInitials || "AH"}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
