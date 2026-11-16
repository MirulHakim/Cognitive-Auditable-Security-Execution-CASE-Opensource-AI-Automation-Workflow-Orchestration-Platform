import { useEffect, useState } from "react";
import "./App.css";
import Login from "./features/auth/Login";
import Header from "./components/Header";
import Sidebar, { type NavItem } from "./components/Sidebar";
import DashboardView from "./features/dashboard/DashboardView";
import WorkflowsView from "./features/workflows/WorkflowsView";
import WorkflowEditor from "./features/workflows/WorkflowEditor";
import RunsView from "./features/runs/RunsView";
import EmployeeView from "./features/employees/EmployeeView";
import IntegrationsView from "./features/integrations/IntegrationsView";
import SettingsView from "./features/settings/SettingsView";
import AuditView from "./features/audit/AuditView";
import type { NotificationItem } from "./components/Notification";
import { useSession } from "./context/SessionContext";
import { listInstances, listTemplates } from "./api/client";
import { initials, uiRole } from "./lib/format";

const TAB_PERMISSION: Partial<Record<NavItem, string>> = {
  employees: "users:manage",
};

export default function App() {
  const { member, loading, signOut, can } = useSession();

  // Navigation state — the shell survives identity switches; the workflow
  // canvas and the run detail are full-screen sub-views.
  const [currentTab, setCurrentTab] = useState<NavItem>("dashboard");
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(null);
  const [runToOpen, setRunToOpen] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  // Switching to an identity without `users:manage` must not leave the Members
  // screen open behind dead controls.
  useEffect(() => {
    const required = TAB_PERMISSION[currentTab];
    if (required && !can(required)) setCurrentTab("dashboard");
  }, [currentTab, can]);

  // Notifications are derived from real state: runs waiting for a decision and
  // templates waiting for review.
  useEffect(() => {
    if (!member) return;
    let cancelled = false;
    Promise.all([
      listInstances({ status: "PAUSED" }).catch(() => []),
      listTemplates({ status: "PENDING" }).catch(() => []),
    ]).then(([paused, pending]) => {
      if (cancelled) return;
      const items: NotificationItem[] = [
        ...paused.map((instance) => ({
          id: `run-${instance.instanceId}`,
          title: "Approval waiting",
          description: `${instance.templateName} is paused at step ${instance.cursorIndex + 1}.`,
          time: new Date(instance.updatedAt).toLocaleTimeString(),
          type: "warning" as const,
          read: false,
        })),
        ...pending.map((template) => ({
          id: `template-${template.templateId}`,
          title: "Template awaiting review",
          description: `${template.name} must be approved before it can run.`,
          time: new Date(template.updatedAt).toLocaleString(),
          type: "info" as const,
          read: false,
        })),
      ];
      setNotifications(items);
    });
    return () => {
      cancelled = true;
    };
  }, [member, currentTab]);

  if (loading) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center text-sm text-muted">
        Loading workspace…
      </div>
    );
  }

  if (!member) return <Login />;

  const currentUser = {
    name: member.displayName,
    email: member.email,
    role: uiRole(member.role),
    avatarInitials: initials(member.displayName),
  };

  const handleLogout = () => {
    signOut();
    setEditingWorkflowId(null);
    setRunToOpen(null);
    setCurrentTab("dashboard");
    setIsMobileNavOpen(false);
  };

  // Fullscreen workflow canvas (no duplicate header).
  if (editingWorkflowId !== null) {
    return (
      <div className="w-screen h-screen overflow-hidden bg-background">
        <WorkflowEditor
          workflowId={editingWorkflowId}
          onBack={() => setEditingWorkflowId(null)}
          onOpenRun={(instanceId) => {
            setEditingWorkflowId(null);
            setRunToOpen(instanceId);
            setCurrentTab("runs");
          }}
        />
      </div>
    );
  }

  const renderCurrentView = () => {
    switch (currentTab) {
      case "dashboard":
        return (
          <DashboardView
            onNavigateToWorkflows={() => setCurrentTab("workflows")}
            onNavigateToEmployees={() => setCurrentTab("employees")}
            onNavigateToRuns={() => setCurrentTab("runs")}
            onOpenWorkflow={(id) => setEditingWorkflowId(id)}
          />
        );
      case "workflows":
        return <WorkflowsView onOpenBuilder={(id) => setEditingWorkflowId(id || "new")} />;
      case "runs":
        return (
          <RunsView
            initialInstanceId={runToOpen}
            onConsumedInitial={() => setRunToOpen(null)}
            canStart={can("workflow:start")}
            canRespond={can("workflow:respond")}
            canCancel={can("workflow:cancel")}
          />
        );
      case "employees":
        return <EmployeeView />;
      case "integrations":
        return <IntegrationsView />;
      case "settings":
        return <SettingsView currentUser={currentUser} onLogout={handleLogout} />;
      case "audit":
        return <AuditView />;
      default:
        return null;
    }
  };

  return (
    <div className="h-screen w-screen bg-background text-primary flex flex-col overflow-hidden">
      <div className="shrink-0">
        <Header
          currentUser={currentUser}
          notifications={notifications}
          onClearNotifications={() => setNotifications([])}
          onMenuClick={() => {
            setIsSidebarCollapsed(false);
            setIsMobileNavOpen(true);
          }}
          onNavigateToSettings={() => setCurrentTab("settings")}
          onNavigateToIntegrations={() => setCurrentTab("integrations")}
          onLogout={handleLogout}
        />
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {isMobileNavOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setEditingWorkflowId(null);
            setRunToOpen(null);
            setCurrentTab(tab);
          }}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          mobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
          can={can}
        />

        <main className="flex-1 overflow-y-auto bg-background h-full">
          {renderCurrentView()}
        </main>
      </div>
    </div>
  );
}
