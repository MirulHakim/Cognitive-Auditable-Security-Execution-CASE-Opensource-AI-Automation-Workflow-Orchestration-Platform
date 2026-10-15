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

  // Reads directly from the imported registry
  const filteredNodes = NODE_REGISTRY.filter((node) => {
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
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog Window */}
      <div className="relative w-full max-w-2xl bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <FiZap className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-wide">
                Node Library
              </h2>
              <p className="text-[11px] text-slate-400">
                Choose a trigger, AI capability, or action step to add to the
                canvas.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Category Tabs */}
        <div className="p-4 border-b border-slate-800 space-y-3 bg-slate-900/30">
          <div className="relative">
            <FiSearch className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search components (e.g. LLM, webhook, database)..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {(
              [
                "all",
                "triggers",
                "AI",
                "logic",
                "connectors",
              ] as CategoryFilter[]
            ).map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setSelectedCategory(category)}
                className={`capitalize px-3 py-1 rounded-md text-xs font-medium transition-colors ${
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

        {/* Node Grid Body */}
        <div className="p-4 overflow-y-auto flex-1">
          {filteredNodes.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-500 flex items-center justify-center mb-3">
                <FiPackage className="w-5 h-5" />
              </div>
              <p className="text-xs font-medium text-slate-300">
                No nodes match your filter
              </p>
              <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                Try searching for another keyword or select "All" categories.
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
                    className="p-3 rounded-xl border border-slate-800/80 bg-slate-900/50 hover:bg-slate-800/80 hover:border-slate-700 transition-all text-left flex items-start gap-3 group cursor-grab active:cursor-grabbing"
                  >
                    <div
                      className={`p-2 rounded-lg border ${node.color} shrink-0`}
                    >
                      <Icon className="w-4 h-4" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="text-xs font-medium text-slate-200 group-hover:text-white truncate">
                          {node.title}
                        </span>
                        {node.badge && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 font-mono border border-cyan-500/20">
                            {node.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug line-clamp-2">
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
