import React from "react";
import { FiCheckCircle, FiAlertTriangle, FiInfo, FiX } from "react-icons/fi";

export interface NotificationItem {
  id: string;
  title: string;
  description: string;
  time: string;
  type: "success" | "warning" | "info";
  read: boolean;
}

interface NotificationDropdownProps {
  notifications: NotificationItem[];
  onClose: () => void;
  onClearAll: () => void;
}

export const Notification: React.FC<NotificationDropdownProps> = ({
  notifications,
  onClose,
  onClearAll,
}) => {
  const getIcon = (type: NotificationItem["type"]) => {
    switch (type) {
      case "success":
        return (
          <FiCheckCircle className="w-4 h-4 text-success mt-0.5 shrink-0" />
        );
      case "warning":
        return (
          <FiAlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
        );
      case "info":
      default:
        return <FiInfo className="w-4 h-4 text-accent-primary mt-0.5 shrink-0" />;
    }
  };

  return (
    <div className="absolute right-0 top-12 w-80 sm:w-96 bg-surface border border-subtle rounded-xl shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-subtle bg-surface-sunken/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-primary">
            Notifications
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-accent-primary/10 text-accent-primary border border-accent-primary/20 rounded-full font-medium">
            {notifications.length} New
          </span>
        </div>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-xs text-muted hover:text-secondary transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="text-muted hover:text-secondary transition-colors p-1"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto divide-y divide-subtle/60">
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-xs text-faint">
            No notifications to display
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className="p-3.5 hover:bg-surface-sunken/50 transition-colors flex gap-3 text-left cursor-pointer"
            >
              {getIcon(n.type)}
              <div className="flex-1">
                <p className="text-xs font-medium text-secondary leading-snug">
                  {n.title}
                </p>
                <p className="text-[11px] text-muted mt-0.5 line-clamp-2">
                  {n.description}
                </p>
                <span className="text-[10px] text-faint mt-1 block">
                  {n.time}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-subtle bg-surface-sunken/20 text-center">
        <button
          onClick={onClose}
          className="text-xs text-accent-primary hover:text-accent-primary font-medium py-1"
        >
          View all logs
        </button>
      </div>
    </div>
  );
};

export default Notification;
