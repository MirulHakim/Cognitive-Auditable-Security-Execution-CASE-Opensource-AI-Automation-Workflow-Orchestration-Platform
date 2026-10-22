import React from "react";
import { FiSearch, FiFilter } from "react-icons/fi";

export type CategoryFilter =
  | "all"
  | "support"
  | "operations"
  | "engineering"
  | "growth";

interface WorkflowSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: CategoryFilter;
  onSelectCategory: (category: CategoryFilter) => void;
}

const CATEGORIES: CategoryFilter[] = [
  "all",
  "support",
  "operations",
  "engineering",
  "growth",
];

export const WorkflowSearchBar: React.FC<WorkflowSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-[#0f172a] p-3 rounded-xl border border-slate-800">
      {/* Search Input Field */}
      <div className="relative flex-1 max-w-md">
        <FiSearch className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name, description, or trigger..."
          className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Category Filter Badges */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
        <FiFilter className="w-3.5 h-3.5 text-slate-500 ml-1 mr-1 shrink-0" />
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => onSelectCategory(category)}
            className={`capitalize px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === category
                ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/30"
                : "text-slate-400 hover:text-slate-200 border border-transparent hover:border-slate-800"
            }`}
          >
            {category}
          </button>
        ))}
      </div>
    </div>
  );
};

export default WorkflowSearchBar;
