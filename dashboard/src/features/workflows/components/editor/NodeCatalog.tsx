import React, { useState, useEffect } from "react";
import { FiSearch, FiX, FiZap, FiPackage } from "react-icons/fi";
import {
  NODE_REGISTRY,
  type NodeDefinition,
  type NodeCategory,
} from "../../constants/NodeRegistry.ts";

interface NodeCatalogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectNode: (nodeDef: NodeDefinition) => void;
}

type CategoryFilter = "all" | NodeCategory;

/* Category tabs shown in the Node Library header (All first). */
const CATEGORY_TABS: Array<{ id: CategoryFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "triggers", label: "Triggers" },
  { id: "ai", label: "AI" },
  { id: "logic", label: "Logic" },
  { id: "tools", label: "Tools" },
  { id: "database", label: "Database" },
  { id: "integrations", label: "Integrations" },
];

export const NodeCatalog: React.FC<NodeCatalogProps> = ({
  isOpen,
  onClose,
  onSelectNode,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryFilter>("all");

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Reads directly from the imported registry (sorted by explicit order)
  const filteredNodes = [...NODE_REGISTRY]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((node) => {
      const matchesCategory =
        selectedCategory === "all" || node.category === selectedCategory;
      const matchesSearch =
        node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        node.description.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog Window */}
      <div className="relative w-full max-w-2xl bg-surface border border-subtle rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary">
              <FiZap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-primary tracking-wide">
                Node Library
              </h2>
              <p className="text-[11px] text-muted">
                Choose a trigger, AI capability, or action step to add to the
                canvas.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Category Tabs */}
        <div className="p-4 border-b border-subtle space-y-3 bg-surface-sunken/30">
          <div className="relative">
            <FiSearch className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search components (e.g. LLM, webhook, documents)..."
              className="w-full bg-surface-sunken border border-subtle rounded-lg pl-9 pr-3 py-2 text-xs text-secondary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedCategory(tab.id)}
                className={`px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCategory === tab.id
                    ? "bg-accent-primary/10 text-accent-primary border border-accent-primary/30"
                    : "text-muted hover:text-secondary border border-transparent hover:border-subtle"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Node Grid Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {filteredNodes.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-xl bg-surface-hover/80 border border-strong/60 text-faint flex items-center justify-center mb-3">
                <FiPackage className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-secondary">
                No nodes match your filter
              </p>
              <p className="text-[11px] text-faint mt-1 max-w-xs">
                Try searching for another keyword or switch to a different
                category tab.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filteredNodes.map((node) => {
                const Icon = node.icon;
                return (
                  <button
                    key={node.type}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(
                        "application/json",
                        JSON.stringify(node),
                      );
                      e.dataTransfer.effectAllowed = "copy";
                      setTimeout(() => onClose(), 0);
                    }}
                    onClick={() => {
                      onSelectNode(node);
                      onClose();
                    }}
                    className="p-3 rounded-xl border border-subtle/80 bg-surface-sunken/50 hover:bg-surface-hover/80 hover:border-strong transition-colors duration-200 text-left flex items-start gap-3 group cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className={`p-2 rounded-lg border ${node.color} shrink-0`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-medium text-secondary group-hover:text-primary truncate">
                          {node.title}
                        </span>
                        {node.badge && (
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono border ${
                            node.isTerminal
                              ? "bg-warning/10 text-warning border-warning/20"
                              : "bg-accent-primary/10 text-accent-primary border-accent-primary/20"
                          }`}>
                            {node.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted leading-snug line-clamp-2">
                        {node.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeCatalog;
