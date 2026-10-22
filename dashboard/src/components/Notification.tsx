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
          <FiCheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
        );
      case "warning":
        return (
          <FiAlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        );
      case "info":
      default:
        return <FiInfo className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />;
    }
  };

  return (
    <div className="absolute right-0 top-12 w-80 sm:w-96 bg-[#0f172a] border border-slate-800 rounded-xl shadow-2xl z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/40">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">
            Notifications
          </span>
          <span className="text-[10px] px-2 py-0.5 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full font-medium">
            {notifications.length} New
          </span>
        </div>
        <div className="flex items-center gap-2">
          {notifications.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Clear all
            </button>
          )}
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors p-1"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-800/60">
        {notifications.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No notifications to display
          </div>
        ) : (
          notifications.map((n) => (
            <div
              key={n.id}
              className="p-3.5 hover:bg-slate-900/50 transition-colors flex gap-3 text-left cursor-pointer"
            >
              {getIcon(n.type)}
              <div className="flex-1">
                <p className="text-xs font-medium text-slate-200 leading-snug">
                  {n.title}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-2">
                  {n.description}
                </p>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  {n.time}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-slate-800 bg-slate-900/20 text-center">
        <button
          onClick={onClose}
          className="text-xs text-cyan-400 hover:text-cyan-300 font-medium py-1"
        >
          View all logs
        </button>
      </div>
    </div>
  );
};

export default Notification;
