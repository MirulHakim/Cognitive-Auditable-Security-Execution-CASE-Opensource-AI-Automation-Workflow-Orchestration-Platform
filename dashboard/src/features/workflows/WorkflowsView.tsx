import React, { useState } from "react";
import { FiPlus, FiZap, FiStar } from "react-icons/fi";
import WorkflowTable, {
  type WorkflowItem,
} from "./components/list/WorkflowTable";
import AIGeneratorChatModal from "./components/AIGeneratorChatModal";
import WorkflowStatsBar, {
  type StatusFilter,
} from "./components/list/WorkflowStatsBar";
import WorkflowSearchBar, {
  type CategoryFilter,
} from "./components/list/WorkflowSearchBar";
import ConfirmModal from "../../components/ConfirmModal";

interface WorkflowsViewProps {
  onOpenBuilder?: (workflowId?: string) => void;
}

export interface ExtendedWorkflowItem extends WorkflowItem {
  category: "support" | "operations" | "engineering" | "growth";
}

const initialWorkflows: ExtendedWorkflowItem[] = [
  {
    id: "wf-1",
    name: "Customer Onboarding Agent",
    description:
      "Sends welcome sequence, provisions org database entries, and generates sandbox API keys.",
    status: "active",
    lastRun: "2 hours ago",
    createdAt: "2026-09-24T14:15:00Z",
    triggerType: "Stripe Webhook",
    category: "growth",
  },
  {
    id: "wf-2",
    name: "Urgent Support Triage",
    description:
      "Classifies high-priority inbound customer tickets via LLM and alerts on-call leads.",
    status: "active",
    lastRun: "10 mins ago",
    createdAt: "2026-09-20T10:00:00Z",
    triggerType: "Email Webhook",
    category: "support",
  },
  {
    id: "wf-3",
    name: "Daily Standup Slack Bot",
    description:
      "Pings engineering channels every weekday at 9:30 AM to collect blocker reports.",
    status: "inactive",
    lastRun: "Yesterday",
    createdAt: "2026-09-15T08:30:00Z",
    triggerType: "Cron Schedule",
    category: "engineering",
  },
  {
    id: "wf-4",
    name: "Data Lake Audit ETL",
    description:
      "Runs schema consistency checks on production parquet records and dispatches summaries.",
    status: "active",
    lastRun: "4 hours ago",
    createdAt: "2026-08-11T12:00:00Z",
    triggerType: "Event Trigger",
    category: "operations",
  },
  {
    id: "wf-5",
    name: "GitHub PR Auto-Reviewer",
    description:
      "Scans new pull requests for security vulnerabilities and generates inline test recommendations.",
    status: "inactive",
    lastRun: "3 days ago",
    createdAt: "2026-07-04T09:40:00Z",
    triggerType: "GitHub Webhook",
    category: "engineering",
  },
];

export const WorkflowsView: React.FC<WorkflowsViewProps> = ({
  onOpenBuilder,
}) => {
  const [workflows, setWorkflows] =
    useState<ExtendedWorkflowItem[]>(initialWorkflows);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] =
    useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // AI workflow generator chat (prototype)
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);

  // Track which workflow is pending deletion confirmation
  const [workflowToDelete, setWorkflowToDelete] =
    useState<ExtendedWorkflowItem | null>(null);

  const handleToggleStatus = (id: string) => {
    setWorkflows((prev) =>
      prev.map((wf) =>
        wf.id === id
          ? { ...wf, status: wf.status === "active" ? "inactive" : "active" }
          : wf,
      ),
    );
  };

  const handleDuplicate = (workflow: WorkflowItem) => {
    const original = workflows.find((w) => w.id === workflow.id);
    const duplicated: ExtendedWorkflowItem = {
      ...workflow,
      category: original?.category || "operations",
      id: `wf-${Date.now()}`,
      name: `${workflow.name} (Copy)`,
      createdAt: new Date().toISOString(),
      status: "inactive",
    };
    setWorkflows((prev) => [duplicated, ...prev]);
  };

  const handleExportJson = (workflow: WorkflowItem) => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(workflow, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute(
      "download",
      `${workflow.name.toLowerCase().replace(/\s+/g, "_")}.json`,
    );
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Prompt user confirmation instead of directly deleting
  const handlePromptDelete = (id: string) => {
    const target = workflows.find((w) => w.id === id);
    if (target) {
      setWorkflowToDelete(target);
    }
  };

  // Execute confirmed removal
  const handleConfirmDelete = () => {
    if (workflowToDelete) {
      setWorkflows((prev) =>
        prev.filter((wf) => wf.id !== workflowToDelete.id),
      );
      setWorkflowToDelete(null);
    }
  };

  const handleResetFilters = () => {
    setSearchQuery("");
    setSelectedCategory("all");
    setStatusFilter("all");
  };

  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.triggerType.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" || wf.category === selectedCategory;

    const matchesStatus = statusFilter === "all" || wf.status === statusFilter;

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const activeCount = workflows.filter((w) => w.status === "active").length;
  const inactiveCount = workflows.length - activeCount;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header and Action Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-tight flex items-center gap-2">
            <FiZap className="w-5 h-5 text-accent-primary" />
            My Workflows
          </h1>
          <p className="text-xs text-muted mt-1">
            Build, monitor, and deploy automated multi-agent pipelines and
            webhooks.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsAiChatOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary font-semibold text-xs transition-all active:scale-95"
          >
            <FiStar className="w-4 h-4" />
            Generate with AI
          </button>

          <button
            type="button"
            onClick={() => onOpenBuilder?.()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-all shadow-md shadow-accent-primary/40 active:scale-95"
          >
            <FiPlus className="w-4 h-4 stroke-[2.5]" />
            Create Workflow
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <WorkflowStatsBar
        totalCount={workflows.length}
        activeCount={activeCount}
        inactiveCount={inactiveCount}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      {/* Search & Category Filter */}
      <WorkflowSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {/* Workflows Table */}
      {filteredWorkflows.length === 0 ? (
        <div className="w-full bg-surface border border-subtle rounded-xl p-12 text-center">
          <p className="text-sm text-secondary font-medium">
            No workflows match your criteria
          </p>
          <p className="text-xs text-faint mt-1">
            Try resetting your search or filter tags.
          </p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="mt-4 px-3 py-1.5 rounded-lg border border-strong text-xs text-accent-primary hover:bg-surface-hover transition-colors"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <WorkflowTable
          workflows={filteredWorkflows}
          onToggleStatus={handleToggleStatus}
          onDuplicate={handleDuplicate}
          onExportJson={handleExportJson}
          onDelete={handlePromptDelete} // Routed to confirmation prompt
          onNavigateToWorkflows={handleResetFilters}
          onSelectWorkflow={(workflowId) => onOpenBuilder?.(workflowId)}
        />
      )}

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(workflowToDelete)}
        title="Delete Workflow"
        message={`Are you sure you want to delete "${workflowToDelete?.name}"? All associated trigger webhooks and scheduled jobs will be stopped permanently.`}
        confirmLabel="Delete Workflow"
        cancelLabel="Keep Workflow"
        variant="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setWorkflowToDelete(null)}
      />

      {/* AI Workflow Generator Chat (prototype) */}
      <AIGeneratorChatModal
        isOpen={isAiChatOpen}
        onClose={() => setIsAiChatOpen(false)}
        onOpenBuilder={(workflowId) => {
          setIsAiChatOpen(false);
          onOpenBuilder?.(workflowId);
        }}
      />
    </div>
  );
};

export default WorkflowsView;
