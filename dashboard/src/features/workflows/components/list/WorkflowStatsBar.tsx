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
            ? "bg-slate-900 border-cyan-500/40 shadow-sm shadow-cyan-500/10"
            : "bg-[#0f172a] border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiLayers className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-medium text-slate-300">
            Total Workflows
          </span>
        </div>
        <span className="text-sm font-bold text-white font-mono">
          {totalCount}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onFilterChange("active")}
        className={`p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
          activeFilter === "active"
            ? "bg-slate-900 border-emerald-500/40 shadow-sm shadow-emerald-500/10"
            : "bg-[#0f172a] border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiCheckCircle className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-medium text-slate-300">
            Active Agents
          </span>
        </div>
        <span className="text-sm font-bold text-emerald-400 font-mono">
          {activeCount}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onFilterChange("inactive")}
        className={`p-3 rounded-xl border flex items-center justify-between text-left transition-colors ${
          activeFilter === "inactive"
            ? "bg-slate-900 border-amber-500/40 shadow-sm shadow-amber-500/10"
            : "bg-[#0f172a] border-slate-800 hover:border-slate-700"
        }`}
      >
        <div className="flex items-center gap-2.5">
          <FiPauseCircle className="w-4 h-4 text-amber-400" />
          <span className="text-xs font-medium text-slate-300">
            Paused / Drafts
          </span>
        </div>
        <span className="text-sm font-bold text-amber-400 font-mono">
          {inactiveCount}
        </span>
      </button>
    </div>
  );
};

export default WorkflowStatsBar;
