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

// UI-REGION: Search + category filter chips for the workflow list.
// TODO[BACKEND]: Filtering is client-side today — once the list is served by
// GET /api/workflows, pass searchQuery/selectedCategory as query params
// (debounced) instead of filtering an in-memory array.
export const WorkflowSearchBar: React.FC<WorkflowSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-surface p-3 rounded-xl border border-subtle">
      {/* Search Input Field */}
      <div className="relative flex-1 max-w-md">
        <FiSearch className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by name, description, or trigger..."
          className="w-full bg-surface-sunken/80 border border-subtle rounded-lg pl-9 pr-3 py-1.5 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>

      {/* Category Filter Badges */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
        <FiFilter className="w-3.5 h-3.5 text-faint ml-1 mr-1 shrink-0" />
        {CATEGORIES.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => onSelectCategory(category)}
            className={`capitalize px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === category
                ? "bg-accent-primary/10 text-accent-primary border border-accent-primary/30"
                : "text-muted hover:text-secondary border border-transparent hover:border-subtle"
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
