import React, { useState } from "react";
import {
  FiMoreVertical,
  FiCopy,
  FiDownload,
  FiTrash2,
  FiArrowUp,
  FiArrowDown,
  FiZap,
  FiChevronLeft,
  FiChevronRight,
} from "react-icons/fi";
import ActionMenu from "../../../../components/ActionMenu";

export interface WorkflowItem {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  lastRun: string;
  createdAt: string;
  triggerType: string;
}

interface WorkflowTableProps {
  workflows: WorkflowItem[];
  onToggleStatus: (id: string) => void;
  onDuplicate: (workflow: WorkflowItem) => void;
  onExportJson: (workflow: WorkflowItem) => void;
  onDelete: (id: string) => void;
  onSelectWorkflow?: (workflowId: string) => void;
  onNavigateToWorkflows: () => void;
}

type SortField = "recent" | "name" | "status";

const ITEMS_PER_PAGE = 5;

export const WorkflowTable: React.FC<WorkflowTableProps> = ({
  workflows,
  onToggleStatus,
  onDuplicate,
  onExportJson,
  onDelete,
  onNavigateToWorkflows,
  onSelectWorkflow,
}) => {
  const [sortField, setSortField] = useState<SortField>("recent");
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [currentPage, setCurrentPage] = useState<number>(1);

  const [activeMenu, setActiveMenu] = useState<{
    item: WorkflowItem;
    position: { top: number; left: number };
  } | null>(null);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
    setCurrentPage(1);
  };

  const sortedWorkflows = [...workflows].sort((a, b) => {
    let comparison = 0;
    if (sortField === "recent") {
      comparison =
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    } else if (sortField === "name") {
      comparison = a.name.localeCompare(b.name);
    } else if (sortField === "status") {
      comparison = a.status.localeCompare(b.status);
    }
    return sortAsc ? comparison : -comparison;
  });

  const totalPages = Math.ceil(sortedWorkflows.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const paginatedWorkflows = sortedWorkflows.slice(
    startIndex,
    startIndex + ITEMS_PER_PAGE,
  );

  return (
    <div className="w-full bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Top Header Controls: Goes to list view via onNavigateToWorkflows */}
      <div className="p-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onNavigateToWorkflows}
          className="flex items-center gap-2 text-white hover:text-cyan-400 transition-colors group focus:outline-none"
        >
          <FiZap className="text-cyan-400 w-4 h-4 group-hover:scale-110 transition-transform" />
          <h3 className="text-sm font-semibold tracking-wide group-hover:underline">
            Active Workflows ({workflows.length})
          </h3>
        </button>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">Sort by:</span>
          {(["recent", "name", "status"] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => handleSort(field)}
              className={`capitalize px-2.5 py-1 rounded-md border transition-colors flex items-center gap-1 ${
                sortField === field
                  ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                  : "border-slate-800 text-slate-400 hover:text-slate-200"
              }`}
            >
              {field}
              {sortField === field &&
                (sortAsc ? (
                  <FiArrowUp className="w-3 h-3" />
                ) : (
                  <FiArrowDown className="w-3 h-3" />
                ))}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-900/30">
              <th className="py-3 px-4 font-medium">Workflow</th>
              <th className="py-3 px-4 font-medium">Trigger</th>
              <th className="py-3 px-4 font-medium">Last Run</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs">
            {paginatedWorkflows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-slate-500">
                  No workflows found.
                </td>
              </tr>
            ) : (
              paginatedWorkflows.map((item) => {
                const isActive = item.status === "active";
                return (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-900/40 transition-colors group"
                  >
                    <td className="py-3 px-4">
                      {/* Individual Workflow Item: Opens specific workflow via onSelectWorkflow */}
                      <button
                        type="button"
                        onClick={() => {
                          if (onSelectWorkflow) {
                            onSelectWorkflow(item.id);
                          } else {
                            console.warn("onSelectWorkflow prop not provided to WorkflowTable");
                          }
                        }}
                        className="font-medium text-slate-200 hover:text-cyan-400 hover:underline transition-colors text-left block"
                      >
                        {item.name}
                      </button>
                      <div className="text-[11px] text-slate-400 truncate max-w-xs">
                        {item.description}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300 text-[11px]">
                        {item.triggerType}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-slate-400">{item.lastRun}</td>

                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          role="switch"
                          aria-label={`Toggle status for ${item.name}`}
                          aria-checked={isActive}
                          onClick={() => onToggleStatus(item.id)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                            isActive ? "bg-cyan-500" : "bg-slate-700"
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                              isActive ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                        <span
                          className={`text-xs font-medium capitalize select-none ${
                            isActive ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {item.status}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        aria-label={`Actions for ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation();

                          if (activeMenu?.item.id === item.id) {
                            setActiveMenu(null);
                            return;
                          }

                          const rect = e.currentTarget.getBoundingClientRect();
                          const menuWidth = 160;
                          const top = rect.bottom + 6;
                          const left = rect.right - menuWidth;

                          setActiveMenu({
                            item,
                            position: { top, left },
                          });
                        }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <FiMoreVertical className="w-4 h-4 pointer-events-none" />
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {workflows.length > ITEMS_PER_PAGE && (
        <div className="px-4 py-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>
            Showing <strong className="text-slate-200">{startIndex + 1}</strong>{" "}
            to{" "}
            <strong className="text-slate-200">
              {Math.min(startIndex + ITEMS_PER_PAGE, workflows.length)}
            </strong>{" "}
            of <strong className="text-slate-200">{workflows.length}</strong>
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              className="p-1.5 rounded-md border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-300 disabled:cursor-not-allowed transition-colors"
              aria-label="Previous Page"
            >
              <FiChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => setCurrentPage(page)}
                className={`min-w-7 h-7 px-2 rounded-md text-xs font-medium border transition-colors ${
                  currentPage === page
                    ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400"
                    : "border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800"
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={currentPage === totalPages}
              onClick={() =>
                setCurrentPage((prev) => Math.min(prev + 1, totalPages))
              }
              className="p-1.5 rounded-md border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-300 disabled:cursor-not-allowed transition-colors"
              aria-label="Next Page"
            >
              <FiChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Action Menu */}
      {activeMenu && (
        <ActionMenu
          isOpen={Boolean(activeMenu)}
          position={activeMenu.position}
          onClose={() => setActiveMenu(null)}
          options={[
            {
              label: "Duplicate",
              icon: FiCopy,
              onClick: () => onDuplicate(activeMenu.item),
            },
            {
              label: "Export JSON",
              icon: FiDownload,
              onClick: () => onExportJson(activeMenu.item),
            },
            {
              label: "Delete",
              icon: FiTrash2,
              variant: "danger",
              onClick: () => onDelete(activeMenu.item.id),
            },
          ]}
        />
      )}
    </div>
  );
};

export default WorkflowTable;