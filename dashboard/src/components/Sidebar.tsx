import React from "react";
import {
  FiHome,
  FiGitBranch,
  FiSettings,
  FiActivity,
  FiGrid,
  FiUsers,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";

export type NavItem =
  | "dashboard"
  | "workflows"
  | "employees"
  | "audit"
  | "integrations"
  | "settings";

interface SidebarProps {
  currentTab: NavItem;
  onSelectTab: (tab: NavItem) => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  collapsed = false,
  onToggleCollapse,
}) => {
  const primaryNav = [
    { id: "dashboard" as NavItem, label: "Dashboard", icon: FiHome },
    { id: "workflows" as NavItem, label: "Workflows", icon: FiGitBranch },
    { id: "employees" as NavItem, label: "Employees", icon: FiUsers },
    { id: "executions" as NavItem, label: "Executions", icon: FiActivity },
    { id: "integrations" as NavItem, label: "Integrations", icon: FiGrid },
  ];

  return (
    <aside
      className={`h-full bg-[#0f172a] border-r border-slate-800 flex flex-col justify-between shrink-0 transition-[width] duration-200 select-none overflow-hidden ${
        collapsed ? "w-16" : "w-56"
      }`}
    >
      {/* Top Section: Nav Links */}
      <div className="p-3 space-y-1 overflow-hidden">
        {primaryNav.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive
                  ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                  : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              {/* Static-width anchor keeps icons permanently centered on the left axis */}
              <div className="w-4 h-4 flex items-center justify-center shrink-0">
                <Icon className="w-4 h-4" />
              </div>

              <span
                className={`whitespace-nowrap overflow-hidden transition-all duration-200 text-left ${
                  collapsed
                    ? "w-0 opacity-0 pointer-events-none"
                    : "w-auto opacity-100"
                }`}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom Section: Settings & Collapse Toggle */}
      <div className="p-3 border-t border-slate-800 space-y-1 shrink-0 overflow-hidden">
        <button
          type="button"
          onClick={() => onSelectTab("settings")}
          title={collapsed ? "Settings" : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
            currentTab === "settings"
              ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
          }`}
        >
          <div className="w-4 h-4 flex items-center justify-center shrink-0">
            <FiSettings className="w-4 h-4" />
          </div>

          <span
            className={`whitespace-nowrap overflow-hidden transition-all duration-200 text-left ${
              collapsed
                ? "w-0 opacity-0 pointer-events-none"
                : "w-auto opacity-100"
            }`}
          >
            Settings
          </span>
        </button>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand" : "Collapse"}
            className="w-full flex items-center gap-3 px-3 py-2 text-xs text-slate-500 hover:text-slate-300 hover:bg-slate-900/40 rounded-lg transition-colors border border-transparent"
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              {collapsed ? (
                <FiChevronRight className="w-4 h-4" />
              ) : (
                <FiChevronLeft className="w-4 h-4" />
              )}
            </div>

            <span
              className={`whitespace-nowrap overflow-hidden transition-all duration-200 text-left ${
                collapsed
                  ? "w-0 opacity-0 pointer-events-none"
                  : "w-auto opacity-100"
              }`}
            >
              Collapse
            </span>
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
