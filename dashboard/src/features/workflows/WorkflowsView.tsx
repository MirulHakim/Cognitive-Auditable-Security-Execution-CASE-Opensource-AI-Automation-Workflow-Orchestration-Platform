import React, { useMemo, useState } from "react";
import { FiPlus, FiStar, FiX, FiCpu } from "react-icons/fi";
import WorkflowTable from "./components/list/WorkflowTable";
import WorkflowStatsBar, { type StatusFilter } from "./components/list/WorkflowStatsBar";
import WorkflowSearchBar, { type CategoryFilter } from "./components/list/WorkflowSearchBar";
import ConfirmModal from "../../components/ConfirmModal";
import { useWorkflowData } from "./useWorkflowData";
import { useSession } from "../../context/SessionContext";
import { errorMessage, generateTemplate } from "../../api/client";

interface WorkflowsViewProps {
  onOpenBuilder?: (workflowId?: string) => void;
}

/**
 * My Workflows — the real template list.
 *
 * Every mutation goes to the API: the status toggle activates/deactivates,
 * approving a PENDING draft and activating a deactivated one. Renaming,
 * duplicating, exporting and deleting operate on the stored template.
 */
export const WorkflowsView: React.FC<WorkflowsViewProps> = ({ onOpenBuilder }) => {
  const data = useWorkflowData();
  const { can } = useSession();
  const canCreate = can("template:create");
  const canGenerate = can("template:generate");
  // Auditors can read the list but must not be offered mutation controls.
  const canMutate = can("template:edit");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [workflowToDelete, setWorkflowToDelete] = useState<string | null>(null);
  const [isGenerateOpen, setIsGenerateOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return data.rows.filter((row) => {
      const template = data.byId(row.id);
      if (!template) return false;

      const matchesSearch =
        query.length === 0 ||
        row.name.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        template.steps.some((step) => step.name.toLowerCase().includes(query));

      const matchesStatus = statusFilter === "all" || row.status === statusFilter;

      const matchesCategory =
        selectedCategory === "all" ||
        (selectedCategory === "approved" && template.reviewStatus === "APPROVED") ||
        (selectedCategory === "pending" && template.reviewStatus === "PENDING") ||
        (selectedCategory === "rejected" && template.reviewStatus === "REJECTED") ||
        (selectedCategory === "ai" && template.origin === "AI_DRAFTED");

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [data.rows, data.byId, searchQuery, statusFilter, selectedCategory]);

  const activeCount = data.rows.filter((row) => row.status === "active").length;
  const inactiveCount = data.rows.length - activeCount;

  /**
   * Draft with AI. The request is sent as the conversation so far, so a second
   * answer builds on the AI's clarifying question. A vague request gets a
   * question back — never an invented workflow.
   */
  const generate = async () => {
    if (generating) return;
    const text = prompt.trim();
    setGenerateError(null);

    if (!text) {
      setTranscript((current) => [
        ...current,
        {
          role: "assistant",
          text: "I need a bit more detail before I can draft this: what case does the workflow handle, what must be checked or approved (and by whom), and what document or message should it produce? If someone must upload a PDF or image for me to read, tell me that too.",
        },
      ]);
      return;
    }

    const conversation = [...transcript, { role: "user" as const, text }];
    const payload = conversation
      .map((entry) => `${entry.role === "user" ? "Operator" : "Assistant"}: ${entry.text}`)
      .join("\n");

    setGenerating(true);
    try {
      const result = await generateTemplate(payload);
      if (result.kind === "clarification") {
        setTranscript([
          ...conversation,
          { role: "assistant", text: result.question },
        ]);
        setPrompt("");
        return;
      }

      setIsGenerateOpen(false);
      setPrompt("");
      setTranscript([]);
      data.refresh();
      onOpenBuilder?.(result.template.templateId);
    } catch (caught) {
      setGenerateError(errorMessage(caught));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-tight flex items-center gap-2">
            <FiZapIcon />
            My Workflows
          </h1>
          <p className="text-xs text-muted mt-1">
            Draft, review, approve and run CASE workflow templates.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {canGenerate && (
            <button
              type="button"
              onClick={() => setIsGenerateOpen(true)}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-accent-primary/40 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary font-semibold text-xs transition-all active:scale-95"
            >
              <FiStar className="w-4 h-4" />
              Generate with AI
            </button>
          )}

          {canCreate && (
            <button
              type="button"
              onClick={() => onOpenBuilder?.()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-all shadow-md shadow-accent-primary/40 active:scale-95"
            >
              <FiPlus className="w-4 h-4 stroke-[2.5]" />
              Create Workflow
            </button>
          )}
        </div>
      </div>

      {data.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {data.error}
        </div>
      )}
      {data.notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-xs text-success">
          {data.notice}
        </div>
      )}

      <WorkflowStatsBar
        totalCount={data.rows.length}
        activeCount={activeCount}
        inactiveCount={inactiveCount}
        activeFilter={statusFilter}
        onFilterChange={setStatusFilter}
      />

      <WorkflowSearchBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
      />

      {data.loading && data.rows.length === 0 ? (
        <div className="w-full bg-surface border border-subtle rounded-xl p-12 text-center text-xs text-muted">
          Loading templates…
        </div>
      ) : filtered.length === 0 ? (
        <div className="w-full bg-surface border border-subtle rounded-xl p-12 text-center">
          <p className="text-sm text-secondary font-medium">
            No templates match your criteria
          </p>
          <p className="text-xs text-faint mt-1">
            Try clearing the search or review-state filter.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSelectedCategory("all");
              setStatusFilter("all");
            }}
            className="mt-4 px-3 py-1.5 rounded-lg border border-strong text-xs text-accent-primary hover:bg-surface-hover transition-colors"
          >
            Clear all filters
          </button>
        </div>
      ) : (
        <WorkflowTable
          workflows={filtered}
          canMutate={canMutate}
          onToggleStatus={(id) => {
            const template = data.byId(id);
            if (template) void data.toggleActive(template);
          }}
          onDuplicate={(row) => {
            const template = data.byId(row.id);
            if (template) void data.duplicate(template);
          }}
          onExportJson={(row) => {
            const template = data.byId(row.id);
            if (template) data.exportJson(template);
          }}
          onDelete={setWorkflowToDelete}
          onRename={(id, name) => {
            const template = data.byId(id);
            if (template) void data.rename(template, name);
          }}
          onNavigateToWorkflows={() => {
            setSearchQuery("");
            setSelectedCategory("all");
            setStatusFilter("all");
          }}
          onSelectWorkflow={(workflowId) => onOpenBuilder?.(workflowId)}
        />
      )}

      <ConfirmModal
        isOpen={workflowToDelete !== null}
        title="Deactivate workflow"
        message={`Deactivating “${
          data.byId(workflowToDelete ?? "")?.name ?? ""
        }” stops new runs. Its template, reviews and run history are kept — nothing is deleted.`}
        confirmLabel="Deactivate"
        cancelLabel="Keep active"
        variant="danger"
        onConfirm={() => {
          const template = data.byId(workflowToDelete ?? "");
          if (template) void data.remove(template);
          setWorkflowToDelete(null);
        }}
        onCancel={() => setWorkflowToDelete(null)}
      />

      {isGenerateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-subtle flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
                <FiCpu className="w-4 h-4 text-accent-primary" />
                Draft a template with AI
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsGenerateOpen(false);
                  setTranscript([]);
                }}
                className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover"
                aria-label="Close"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-muted leading-relaxed">
                Describe the workflow in your own words. The AI asks for details when
                the request is unclear, and only drafts what you asked for. The draft is
                saved as a pending, inactive template — a human must still approve it.
              </p>

              {transcript.length > 0 && (
                <div className="max-h-56 overflow-y-auto space-y-2 rounded-lg border border-subtle bg-background p-3">
                  {transcript.map((entry, index) => (
                    <div
                      key={index}
                      className={`text-[11px] leading-relaxed ${
                        entry.role === "user" ? "text-secondary" : "text-accent-primary"
                      }`}
                    >
                      <span className="font-semibold uppercase tracking-wider text-[9px] mr-1.5">
                        {entry.role === "user" ? "You" : "AI"}
                      </span>
                      {entry.text}
                    </div>
                  ))}
                  {generating && (
                    <p className="text-[11px] text-faint">Reading your request…</p>
                  )}
                </div>
              )}

              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    void generate();
                  }
                }}
                rows={4}
                placeholder="e.g. A maintenance complaint workflow: review the complaint, validate the location and contact details, approve it, ask the officer to upload the signed form as a PDF for the AI to read, generate a reply letter, then notify the requester by email."
                className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
              />
              {generateError && (
                <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
                  {generateError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsGenerateOpen(false);
                    setTranscript([]);
                  }}
                  className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={generating}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold disabled:opacity-50"
                >
                  {generating && (
                    <span className="w-3.5 h-3.5 border-2 border-accent-contrast/40 border-t-accent-contrast rounded-full animate-spin" />
                  )}
                  {generating ? "Thinking…" : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function FiZapIcon() {
  return <FiStar className="w-5 h-5 text-accent-primary" />;
}

export default WorkflowsView;
