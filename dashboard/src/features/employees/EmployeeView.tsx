import React, { useState } from "react";
import {
  FiUserPlus,
  FiSearch,
  FiFilter,
  FiDownloadCloud,
} from "react-icons/fi";
import EmployeeList, { type Employee, type UserRole } from "./components/EmployeeList";
import EmployeeStats from "./components/EmployeeStats";
import InviteEmployeeModal from "./components/InviteEmployeeModal";
import EditRoleModal from "./components/EditRoleModal";
import ConfirmModal from "../../components/ConfirmModal";

const initialEmployees: Employee[] = [
  {
    id: "EMP-001",
    name: "Amirul Rosazlan",
    email: "amirul@axiomflow.internal",
    role: "admin",
    avatarInitials: "AR",
    joinedDate: "Jan 2026",
    status: "active",
  },
  {
    id: "EMP-002",
    name: "Sarah Chen",
    email: "sarah.c@axiomflow.internal",
    role: "staff",
    avatarInitials: "SC",
    joinedDate: "Mar 2026",
    status: "active",
  },
  {
    id: "EMP-003",
    name: "Marcus Vance",
    email: "m.vance@auditfirm.com",
    role: "auditor",
    avatarInitials: "MV",
    joinedDate: "Jul 2026",
    status: "inactive",
  },
  {
    id: "EMP-004",
    name: "Elena Rostova",
    email: "elena.r@axiomflow.internal",
    role: "staff",
    avatarInitials: "ER",
    joinedDate: "Aug 2026",
    status: "active",
  },
];

export const EmployeeView: React.FC = () => {
  const [employees, setEmployees] = useState<Employee[]>(initialEmployees);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  // Modals state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [employeeToRevoke, setEmployeeToRevoke] = useState<Employee | null>(
    null,
  );

  // Add Member
  const handleAddEmployee = (newEmployee: Employee) => {
    setEmployees((prev) => [newEmployee, ...prev]);
  };

  // Open Edit Role Modal
  const handleOpenEditRole = (target: Employee) => {
    setEditingEmployee(target);
  };

  // Save Role from Modal
  const handleSaveRole = (employeeId: string, newRole: UserRole) => {
    setEmployees((prev) =>
      prev.map((emp) =>
        emp.id === employeeId ? { ...emp, role: newRole } : emp,
      ),
    );
  };

  // Trigger Revoke Access Confirmation
  const handlePromptRevoke = (id: string) => {
    const target = employees.find((e) => e.id === id);
    if (target) {
      setEmployeeToRevoke(target);
    }
  };

  // Execute Confirmed Revocation
  const handleConfirmRevoke = () => {
    if (employeeToRevoke) {
      setEmployees((prev) =>
        prev.filter((emp) => emp.id !== employeeToRevoke.id),
      );
      setEmployeeToRevoke(null);
    }
  };

  const handleResetPassword = (target: Employee) => {
    alert(`Password reset link dispatched to ${target.email}`);
  };

  // Search & Filter
  const filteredEmployees = employees.filter((emp) => {
    const matchesSearch =
      emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      emp.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesRole = roleFilter === "all" || emp.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="w-full min-h-screen bg-[#0b0f19] text-slate-100 p-6 flex flex-col gap-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-wide">
            Team Directory & Access Control
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage cluster permissions, employee roles, and workspace
            invitations.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-800 bg-[#0f172a] hover:bg-slate-800 text-xs font-medium text-slate-300 transition-colors"
          >
            <FiDownloadCloud className="w-3.5 h-3.5 text-slate-400" />
            <span>Export CSV</span>
          </button>
          <button
            type="button"
            onClick={() => setIsInviteModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors shadow-sm shadow-cyan-400/20"
          >
            <FiUserPlus className="w-4 h-4 stroke-[2.5]" />
            <span>Invite Member</span>
          </button>
        </div>
      </div>

      {/* Analytics KPI Row */}
      <EmployeeStats employees={employees} />

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0f172a] border border-slate-800 p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or ID..."
            className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <FiFilter className="w-3.5 h-3.5 text-cyan-400" />
            <span>Filter Role:</span>
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-[#0b0f19] border border-slate-800 text-xs text-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-cyan-500/50"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admins</option>
            <option value="staff">Staff</option>
            <option value="auditor">Auditors</option>
          </select>
        </div>
      </div>

      {/* Core Table */}
      <EmployeeList
        employees={filteredEmployees}
        onEditRole={handleOpenEditRole}
        onResetPassword={handleResetPassword}
        onRemoveEmployee={handlePromptRevoke}
      />

      {/* 1. Invite Member Modal */}
      <InviteEmployeeModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onAdd={handleAddEmployee}
      />

      {/* 2. Modify Role Selector Modal */}
      <EditRoleModal
        isOpen={Boolean(editingEmployee)}
        employee={editingEmployee}
        onClose={() => setEditingEmployee(null)}
        onSaveRole={handleSaveRole}
      />

      {/* 3. Revoke Access Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(employeeToRevoke)}
        title="Revoke Employee Access"
        message={`Are you sure you want to revoke access for ${employeeToRevoke?.name} (${employeeToRevoke?.email})? They will immediately lose access to cluster resources and workflows.`}
        confirmLabel="Revoke Access"
        cancelLabel="Keep Employee"
        variant="danger"
        onConfirm={handleConfirmRevoke}
        onCancel={() => setEmployeeToRevoke(null)}
      />
    </div>
  );
};

export default EmployeeView;
