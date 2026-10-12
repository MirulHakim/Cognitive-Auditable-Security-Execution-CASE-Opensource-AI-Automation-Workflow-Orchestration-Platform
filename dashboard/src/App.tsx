import { useState } from "react";
import "./App.css";
import Login from "./features/auth/Login";
import SignUp from "./features/auth/SignUp";
import Header from "./components/Header";
import Sidebar, { type NavItem } from "./components/Sidebar";
import DashboardView from "./features/dashboard/DashboardView";
import WorkflowsView from "./features/workflows/WorkflowsView";
import WorkflowEditor from "./features/workflows/WorkflowEditor";

export default function App() {
  // Prototyping Auth State:
  // Starts as false so you can test the Login UI first
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

  // Transition handler when signing in
  const handleAuthSuccess = (role: "admin" | "staff" | "auditor") => {
    /* 
      =========================================================================
      TODO: REAL AUTH LOGIC (COMMENTED OUT FOR PROTOTYPING)
      - Store user session / token in localStorage or cookies
      - Verify JWT token validity
      - Fetch full user profile & permissions from backend
      =========================================================================
    */

    // Prototyping mock: store role, mark authenticated, route to dashboard
    setCurrentUserRole(role);
    setIsAuthenticated(true);
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

  // 2. View Switcher for the Main Content Area
  const renderCurrentView = () => {
    if (editingWorkflowId !== null) {
      return (
        <WorkflowEditor
          workflowId={editingWorkflowId}
          onBack={() => setEditingWorkflowId(null)}
        />
      );
    }
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
        return (
          <div className="p-6 space-y-4">
            <div>
              <h1 className="text-xl font-bold text-white">My Employees</h1>
              <p className="text-xs text-slate-400 mt-1">
                Active Session Role:{" "}
                <span className="text-cyan-400 capitalize">
                  {currentUserRole}
                </span>
              </p>
            </div>
            <div className="border border-dashed border-slate-800 rounded-xl p-8 text-center text-slate-500 text-xs">
              Employee Management Workspace
            </div>
          </div>
        );
      case "audit":
      case "integrations":
      case "settings":
      default:
        return (
          <div className="p-6 text-slate-400 text-xs">
            <h1 className="text-xl font-bold text-white capitalize mb-2">
              {currentTab}
            </h1>
            <p>This module view is currently under construction.</p>
          </div>
        );
    }
  };

  // 3. Main Dashboard Layout (Locked viewport + dark background)
  return (
    <div className="h-screen w-screen bg-[#0b0f19] text-slate-100 flex flex-col overflow-hidden">
      {/* Top Header */}
      <div className="shrink-0">
        <Header
          workflowName="Urgent Support Triage"
          status="active"
          isEditing={currentTab === "workflows"}
        />
      </div>

      {/* Main Body */}
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setEditingWorkflowId(null); // 👈 Clears the editor canvas so the new tab shows immediately
            setCurrentTab(tab);
          }}
          collapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        />

        <main className="flex-1 overflow-y-auto bg-[#0b0f19] h-full">
          {renderCurrentView()}
        </main>
      </div>
    </div>
  );
}