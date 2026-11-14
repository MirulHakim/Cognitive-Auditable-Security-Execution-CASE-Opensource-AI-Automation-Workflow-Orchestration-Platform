import React from "react";
import { FiSearch, FiFilter } from "react-icons/fi";

/** Review-state chips, matching the states the template API exposes. */
export type CategoryFilter = "all" | "approved" | "pending" | "rejected" | "ai";

interface WorkflowSearchBarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedCategory: CategoryFilter;
  onSelectCategory: (category: CategoryFilter) => void;
}

const CATEGORIES: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "pending", label: "Pending" },
  { value: "rejected", label: "Rejected" },
  { value: "ai", label: "AI-drafted" },
];

// UI-REGION: Search + review-state filter chips for the template list.
// Filtering is client-side over the list returned by GET /api/templates.
export const WorkflowSearchBar: React.FC<WorkflowSearchBarProps> = ({
  searchQuery,
  onSearchChange,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-surface p-3 rounded-xl border border-subtle">
      <div className="relative flex-1 max-w-md">
        <FiSearch className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search templates by name, step or author..."
          className="w-full bg-surface-sunken/80 border border-subtle rounded-lg pl-9 pr-3 py-1.5 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
        />
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
        <FiFilter className="w-3.5 h-3.5 text-faint ml-1 mr-1 shrink-0" />
        {CATEGORIES.map((category) => (
          <button
            key={category.value}
            type="button"
            onClick={() => onSelectCategory(category.value)}
            className={`capitalize px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              selectedCategory === category.value
                ? "bg-accent-primary/10 text-accent-primary border border-accent-primary/30"
                : "text-muted hover:text-secondary border border-transparent hover:border-subtle"
            }`}
          >
            {category.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default WorkflowSearchBar;
