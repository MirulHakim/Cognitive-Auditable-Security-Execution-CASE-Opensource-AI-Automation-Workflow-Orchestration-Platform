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
  /** Mobile (< 768px) slide-out drawer visibility. Desktop is unaffected. */
  mobileOpen?: boolean;
  /** Closes the mobile drawer after a nav selection. */
  onCloseMobile?: () => void;
}

// UI-REGION: Sidebar — primary navigation rail (desktop collapse to icon
// rail, < 768px slide-out drawer with backdrop). Presentational: tab
// selection is lifted to App via onSelectTab/onCloseMobile.
export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  collapsed = false,
  onToggleCollapse,
  mobileOpen = false,
  onCloseMobile,
}) => {
  const primaryNav = [
    { id: "dashboard" as NavItem, label: "Dashboard", icon: FiHome },
    { id: "workflows" as NavItem, label: "Workflows", icon: FiGitBranch },
    { id: "employees" as NavItem, label: "Employees", icon: FiUsers },
    { id: "audit" as NavItem, label: "Audit Trail", icon: FiActivity },
    { id: "integrations" as NavItem, label: "Integrations", icon: FiGrid },
  ];

  const handleSelect = (tab: NavItem) => {
    onSelectTab(tab);
    onCloseMobile?.();
  };

  return (
    <aside
      className={`h-full bg-surface border-r border-subtle flex flex-col justify-between shrink-0 transition-[width,translate] duration-200 select-none overflow-hidden fixed md:static inset-y-0 left-0 z-40 ${
        mobileOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
      } md:translate-x-0 ${collapsed ? "w-56 md:w-16" : "w-56"}`}
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
              onClick={() => handleSelect(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                isActive
                  ? "bg-accent-primary/10 text-accent-primary border-accent-primary/20"
                  : "border-transparent text-muted hover:text-secondary hover:bg-surface-sunken/60"
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
      <div className="p-3 border-t border-subtle space-y-1 shrink-0 overflow-hidden">
        <button
          type="button"
          onClick={() => handleSelect("settings")}
          title={collapsed ? "Settings" : undefined}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
            currentTab === "settings"
              ? "bg-accent-primary/10 text-accent-primary border-accent-primary/20"
              : "border-transparent text-muted hover:text-secondary hover:bg-surface-sunken/60"
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

        {/* Mobile drawer: "Close" slides the drawer away — shrinking to
            the icon rail is a desktop-only interaction. */}
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            title="Close menu"
            className="md:hidden w-full flex items-center gap-3 px-3 py-2 text-xs text-faint hover:text-secondary hover:bg-surface-sunken/40 rounded-lg transition-colors border border-transparent"
          >
            <div className="w-4 h-4 flex items-center justify-center shrink-0">
              <FiChevronLeft className="w-4 h-4" />
            </div>

            <span className="whitespace-nowrap overflow-hidden text-left">
              Close
            </span>
          </button>
        )}

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={collapsed ? "Expand" : "Collapse"}
            className="hidden md:flex w-full items-center gap-3 px-3 py-2 text-xs text-faint hover:text-secondary hover:bg-surface-sunken/40 rounded-lg transition-colors border border-transparent"
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
