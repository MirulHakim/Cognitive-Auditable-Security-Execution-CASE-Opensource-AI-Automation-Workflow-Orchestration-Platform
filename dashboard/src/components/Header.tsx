import React, { useState, useRef, useEffect } from "react";
import Notification, { type NotificationItem } from "./Notification.tsx";
import { FiBell, FiSearch, FiChevronRight, FiPlay, FiMenu } from "react-icons/fi";
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
  /** Opens the mobile (< 768px) sidebar drawer. */
  onMenuClick?: () => void;
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
  onMenuClick,
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
    active: "bg-success/10 text-success border-success/20",
    draft: "bg-muted/10 text-muted border-muted/20",
    paused: "bg-warning/10 text-warning border-warning/20",
    error: "bg-danger/10 text-danger border-danger/20",
  };

  return (
    <header className="w-full h-16 bg-surface border-b border-subtle text-secondary px-3 sm:px-6 flex items-center justify-between select-none">
      {/* Left: Mobile menu, Branding & Conditional Workflow Context */}
      <div className="flex items-center gap-3 min-w-0">
        {/* Mobile hamburger — toggles the slide-out sidebar drawer */}
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            aria-label="Open navigation menu"
            className="md:hidden p-2 -ml-1 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors shrink-0"
          >
            <FiMenu className="w-5 h-5" />
          </button>
        )}

        {/* Brand / Logo */}
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-accent-primary flex items-center justify-center font-bold text-accent-contrast shadow-md shadow-accent-primary/40">
            C
          </div>
          <span className="font-semibold text-primary tracking-tight hidden sm:inline">
            CASE
          </span>
        </div>

        {/* Workflow Title & Status: only visible while editing in canvas */}
        {isEditing && workflowName && (
          <>
            <FiChevronRight className="w-4 h-4 text-faint/50 hidden sm:block" />
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-medium text-secondary">
                {workflowName}
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full border font-medium capitalize flex items-center gap-1.5 ${statusStyles[status]}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status === "active"
                      ? "bg-success animate-pulse"
                      : status === "error"
                        ? "bg-danger"
                        : "bg-muted"
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
        <FiSearch className="w-4 h-4 text-muted absolute left-3 pointer-events-none" />
        <input
          type="text"
          placeholder="Search nodes, actions, logs..."
          className="w-full bg-surface-sunken/60 border border-subtle rounded-lg pl-9 pr-3 py-1.5 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
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
                className="text-xs px-3 py-1.5 rounded-md font-medium text-secondary hover:text-primary bg-surface-hover/80 hover:bg-surface-hover border border-strong/60 transition-colors"
              >
                Export JSON
              </button>
              <button
                type="button"
                onClick={onDeploy}
                className="text-xs px-3.5 py-1.5 rounded-md font-medium text-accent-contrast bg-accent-primary hover:bg-accent-primary-hover transition-colors flex items-center gap-1.5 shadow-sm shadow-accent-primary/40"
              >
                <FiPlay className="w-3 h-3 fill-current" />
                <span>Deploy Agent</span>
              </button>
            </div>
            <div className="h-4 w-px bg-surface-hover" />
          </>
        )}

        {/* Notifications */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`relative p-2 text-muted hover:text-secondary hover:bg-surface-sunken rounded-lg transition-colors ${
              isOpen ? "bg-surface-sunken text-primary" : ""
            }`}
          >
            <FiBell className="w-4 h-4" />
            {notifications.some((n) => !n.read) && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-accent-primary ring-2 ring-surface" />
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
          <div className="w-8 h-8 rounded-full bg-surface-hover border border-strong flex items-center justify-center text-xs font-semibold text-accent-primary">
            {currentUser?.avatarInitials || "AH"}
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;
