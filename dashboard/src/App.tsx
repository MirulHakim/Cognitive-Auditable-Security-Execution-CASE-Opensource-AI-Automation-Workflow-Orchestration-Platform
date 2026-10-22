import { useState } from "react";
import "./App.css";
import Login from "./features/auth/Login";
import SignUp from "./features/auth/SignUp";
import Header from "./components/Header";
import Sidebar, { type NavItem } from "./components/Sidebar";
import DashboardView from "./features/dashboard/DashboardView";
import WorkflowsView from "./features/workflows/WorkflowsView";
import WorkflowEditor from "./features/workflows/WorkflowEditor";
import EmployeeView from "./features/employees/EmployeeView";
import IntegrationsView from "./features/integrations/IntegrationsView";
import SettingsView from "./features/settings/SettingsView";
import AuditView from "./features/audit/AuditView";

export default function App() {
  // Prototyping Auth State:
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authScreen, setAuthScreen] = useState<"login" | "signup">("login");
  const [currentUserRole, setCurrentUserRole] = useState<
    "admin" | "staff" | "auditor"
  >("admin");

  // State to track active workflow editing
  const [editingWorkflowId, setEditingWorkflowId] = useState<string | null>(
    null,
  );

  // Navigation State
  const [currentTab, setCurrentTab] = useState<NavItem>("dashboard");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  // Mobile (< 768px): sidebar hidden by default, opened as a slide-out drawer
  const [isMobileNavOpen, setIsMobileNavOpen] = useState<boolean>(false);

  // Active User Profile definition
  const currentUser = {
    name: "Amirul Rosazlan",
    email: "amirul@axiomflow.internal",
    role: currentUserRole,
    avatarInitials: "AR",
  };

  // Transition handler when signing in
  const handleAuthSuccess = (role: "admin" | "staff" | "auditor") => {
    setCurrentUserRole(role);
    setIsAuthenticated(true);
    setCurrentTab("dashboard");
  };

  // Session Logout Handler
  const handleLogout = () => {
    setIsAuthenticated(false);
    setAuthScreen("login");
    setEditingWorkflowId(null);
    setCurrentTab("dashboard");
  };

  // 1. If not authenticated, render Login or SignUp
  if (!isAuthenticated) {
    if (authScreen === "signup") {
      return (
        <SignUp
          isInitialAdminSetup={true}
          onSignUpSuccess={handleAuthSuccess}
          onNavigateToLogin={() => setAuthScreen("login")}
        />
      );
    }

    return (
      <Login
        onLoginSuccess={handleAuthSuccess}
        onNavigateToSignUp={() => setAuthScreen("signup")}
      />
    );
  }

  // 2. Fullscreen Workflow Canvas (Prevents duplicate headers & restores full width)
  if (editingWorkflowId !== null) {
    return (
      <div className="w-screen h-screen overflow-hidden bg-background">
        <WorkflowEditor
          workflowId={editingWorkflowId}
          onBack={() => setEditingWorkflowId(null)}
        />
      </div>
    );
  }

  // 3. View Switcher for the Main Content Area
  const renderCurrentView = () => {
    switch (currentTab) {
      case "dashboard":
        return (
          <DashboardView
            onNavigateToWorkflows={() => setCurrentTab("workflows")}
            onNavigateToEmployees={() => setCurrentTab("employees")}
          />
        );
      case "workflows":
        return (
          <WorkflowsView
            onOpenBuilder={(id) => setEditingWorkflowId(id || "new")}
          />
        );
      case "employees":
        return <EmployeeView />;
      case "integrations":
        return <IntegrationsView />;
      case "settings":
        return (
          <SettingsView currentUser={currentUser} onLogout={handleLogout} />
        );
      case "audit":
        return <AuditView />;
      default:
        return (
          <div className="p-6 text-muted text-xs">
            <h1 className="text-xl font-bold text-primary capitalize mb-2">
              {currentTab}
            </h1>
            <p>This module view is currently under construction.</p>
          </div>
        );
    }
  };

  // 4. Main Dashboard Layout
  return (
    <div className="h-screen w-screen bg-background text-primary flex flex-col overflow-hidden">
      {/* Top Header with Profile Dropdown actions */}
      <div className="shrink-0">
        <Header
          workflowName="Urgent Support Triage"
          status="active"
          isEditing={false}
          currentUser={currentUser}
          onMenuClick={() => {
            setIsSidebarCollapsed(false);
            setIsMobileNavOpen(true);
          }}
          onNavigateToSettings={() => setCurrentTab("settings")}
          onNavigateToIntegrations={() => setCurrentTab("integrations")}
          onLogout={handleLogout}
        />
      </div>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile backdrop — tap outside to close the drawer */}
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
            setCurrentTab(tab);
          }}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
          mobileOpen={isMobileNavOpen}
          onCloseMobile={() => setIsMobileNavOpen(false)}
        />

        <main className="flex-1 overflow-y-auto bg-background h-full">
          {renderCurrentView()}
        </main>
      </div>
    </div>
  );
}
