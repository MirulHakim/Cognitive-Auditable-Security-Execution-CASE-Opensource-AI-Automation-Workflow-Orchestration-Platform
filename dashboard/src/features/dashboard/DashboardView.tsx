import React, { useState } from "react";
import { MetricCard } from "./components/MetricCard";
import WorkflowTable, {
  type WorkflowItem,
} from "../workflows/components/list/WorkflowTable";
import EmployeeList from "./components/EmployeeList";
import {
  FiPlayCircle,
  FiCheckCircle,
  FiAlertTriangle,
  FiZap,
} from "react-icons/fi";

interface DashboardViewProps {
  onNavigateToWorkflows: () => void;
  onNavigateToEmployees: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onNavigateToWorkflows,
  onNavigateToEmployees,
}) => {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([
    {
      id: "wf-1",
      name: "Urgent Support Triage",
      description: "Classifies high priority emails and creates Jira tickets.",
      status: "active",
      lastRun: "10 mins ago",
      createdAt: "2026-09-20T10:00:00Z",
      triggerType: "Email Webhook",
    },
    {
      id: "wf-2",
      name: "Daily Standup Slack Bot",
      description: "Pings engineering channels every weekday at 9:30 AM.",
      status: "inactive",
      lastRun: "Yesterday",
      createdAt: "2026-09-15T08:30:00Z",
      triggerType: "Cron Schedule",
    },
    {
      id: "wf-3",
      name: "Customer Onboarding Agent",
      description:
        "Sends welcome sequence and provisions new database records.",
      status: "active",
      lastRun: "2 hours ago",
      createdAt: "2026-09-24T14:15:00Z",
      triggerType: "Stripe Webhook",
    },
  ]);

  // Toggle active/inactive
  const handleToggleStatus = (id: string) => {
    setWorkflows((prev) =>
      prev.map((wf) =>
        wf.id === id
          ? { ...wf, status: wf.status === "active" ? "inactive" : "active" }
          : wf,
      ),
    );
  };

  // Duplicate workflow
  const handleDuplicate = (workflow: WorkflowItem) => {
    const duplicated: WorkflowItem = {
      ...workflow,
      id: `wf-${Date.now()}`,
      name: `${workflow.name} (Copy)`,
      createdAt: new Date().toISOString(),
      status: "inactive",
    };
    setWorkflows((prev) => [duplicated, ...prev]);
  };

  // Export as JSON file
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

  // Delete workflow
  const handleDelete = (id: string) => {
    setWorkflows((prev) => prev.filter((wf) => wf.id !== id));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Page Title */}
      <div>
        <h1 className="text-xl font-semibold text-white">Dashboard Overview</h1>
        <p className="text-sm text-slate-400">
          System throughput and live agent metrics
        </p>
      </div>

      {/* Top Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Workflows"
          value={workflows.filter((w) => w.status === "active").length}
          icon={FiZap}
        />
        <MetricCard
          label="Total Runs Today"
          value="1,248"
          change="+12% from yesterday"
          icon={FiPlayCircle}
        />
        <MetricCard
          label="Success Rate"
          value="99.4%"
          change="+0.2%"
          icon={FiCheckCircle}
        />
        <MetricCard
          label="Failed Executions"
          value="3"
          icon={FiAlertTriangle}
        />
      </div>

      {/* Workflow Management Table */}
      <WorkflowTable
        workflows={workflows}
        onToggleStatus={handleToggleStatus}
        onDuplicate={handleDuplicate}
        onExportJson={handleExportJson}
        onDelete={handleDelete}
        onNavigateToWorkflows={onNavigateToWorkflows}
      />

      {/* Employee / Team Access Table */}
      <EmployeeList
        onNavigateToEmployees={onNavigateToEmployees}
        onEditRole={(emp) => console.log("Edit role for:", emp.name)}
        onResetPassword={(emp) => console.log("Reset password for:", emp.email)}
        onRemoveEmployee={(id) => console.log("Remove employee:", id)}
      />
    </div>
  );
};

export default DashboardView;
