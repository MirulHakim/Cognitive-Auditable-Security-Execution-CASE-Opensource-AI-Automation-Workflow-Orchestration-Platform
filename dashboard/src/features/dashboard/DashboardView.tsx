import React, { useMemo } from "react";
import { MetricCard } from "./components/MetricCard";
import WorkflowTable from "../workflows/components/list/WorkflowTable";
import EmployeeList, { type Employee } from "../employees/components/EmployeeList";
import { useWorkflowData } from "../workflows/useWorkflowData";
import { initials, uiRole } from "../../lib/format";
import {
  FiPlayCircle,
  FiCheckCircle,
  FiAlertTriangle,
  FiZap,
  FiClock,
} from "react-icons/fi";

interface DashboardViewProps {
  onNavigateToWorkflows: () => void;
  onNavigateToEmployees: () => void;
  onNavigateToRuns: () => void;
  onOpenWorkflow: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToWorkflows,
  onNavigateToEmployees,
  onNavigateToRuns,
  onOpenWorkflow,
}) => {
  const data = useWorkflowData();
  const { templates, instances, members, rows } = data;

  const metrics = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return {
      activeWorkflows: templates.filter((template) => template.isActive).length,
      runsToday: instances.filter(
        (instance) => new Date(instance.createdAt) >= startOfToday,
      ).length,
      paused: instances.filter((instance) => instance.status === "PAUSED").length,
      rejected: instances.filter((instance) => instance.status === "REJECTED").length,
    };
  }, [templates, instances]);

  const employees = useMemo<Employee[]>(
    () =>
      members.map((member) => ({
        id: member.id,
        name: member.displayName,
        email: member.email,
        role: uiRole(member.role),
        avatarInitials: initials(member.displayName),
        joinedDate: "—",
        status: member.revokedAt === null ? "active" : "revoked",
      })),
    [members],
  );

  const openRow = (id: string) => {
    const template = templates.find((entry) => entry.templateId === id);
    if (!template) return;
    if (!data.byId(id)) return;
    onOpenWorkflow(id);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-primary">Dashboard Overview</h1>
          <p className="text-sm text-muted">
            Live template, execution and team state from the CASE engine
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateToRuns}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-sm shadow-accent-primary/40"
        >
          <FiPlayCircle className="w-4 h-4" />
          Open runs
        </button>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Active workflows" value={metrics.activeWorkflows} icon={FiZap} />
        <MetricCard label="Runs started today" value={metrics.runsToday} icon={FiPlayCircle} />
        <MetricCard
          label="Awaiting approval"
          value={metrics.paused}
          change={metrics.paused > 0 ? "Needs a decision" : undefined}
          icon={FiClock}
        />
        <MetricCard
          label="Rejected runs"
          value={metrics.rejected}
          icon={metrics.rejected > 0 ? FiAlertTriangle : FiCheckCircle}
        />
      </div>

      <WorkflowTable
        workflows={rows}
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
        onDelete={(id) => {
          const template = data.byId(id);
          if (template) void data.remove(template);
        }}
        onRename={(id, name) => {
          const template = data.byId(id);
          if (template) void data.rename(template, name);
        }}
        onNavigateToWorkflows={onNavigateToWorkflows}
        onSelectWorkflow={openRow}
      />

      <EmployeeList
        employees={employees}
        onNavigateToEmployees={onNavigateToEmployees}
      />
    </div>
  );
};

export default DashboardView;
