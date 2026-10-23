import React from "react";
import { FiLayers, FiCheckCircle, FiPauseCircle } from "react-icons/fi";

export type StatusFilter = "all" | "active" | "inactive";

interface WorkflowStatsBarProps {
  totalCount: number;
  activeCount: number;
  inactiveCount: number;
  activeFilter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
}

// UI-REGION: Workflow stats filter tiles — Total / Active / Inactive counts
// that double as a status filter. Presentational: counts are computed by the
// parent from the (soon-to-be API-backed) workflow list.
export const WorkflowStatsBar: React.FC<WorkflowStatsBarProps> = ({
  totalCount,
  activeCount,
  inactiveCount,
  activeFilter,
  onFilterChange,
}) => {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <button
        type="button"
        onClick={() => onFilterChange("all")}
        className={`p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
          activeFilter === "all"
            ? "bg-surface-sunken border-accent-primary/40 shadow-sm shadow-accent-primary/40"
            : "bg-surface border-subtle hover:border-strong"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiLayers className="w-4 h-4 text-accent-primary" />
          <span className="text-xs font-medium text-secondary">
            Total Workflows
          </span>
        </div>
        <span className="text-sm font-bold text-primary font-mono">
          {totalCount}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onFilterChange("active")}
        className={`p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
          activeFilter === "active"
            ? "bg-surface-sunken border-success/40 shadow-sm shadow-success/10"
            : "bg-surface border-subtle hover:border-strong"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiCheckCircle className="w-4 h-4 text-success" />
          <span className="text-xs font-medium text-secondary">
            Active Agents
          </span>
        </div>
        <span className="text-sm font-bold text-success font-mono">
          {activeCount}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onFilterChange("inactive")}
        className={`p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
          activeFilter === "inactive"
            ? "bg-surface-sunken border-warning/40 shadow-sm shadow-warning/10"
            : "bg-surface border-subtle hover:border-strong"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiPauseCircle className="w-4 h-4 text-warning" />
          <span className="text-xs font-medium text-secondary">
            Paused / Drafts
          </span>
        </div>
        <span className="text-sm font-bold text-warning font-mono">
          {inactiveCount}
        </span>
      </button>
    </div>
  );
};

export default WorkflowStatsBar;
