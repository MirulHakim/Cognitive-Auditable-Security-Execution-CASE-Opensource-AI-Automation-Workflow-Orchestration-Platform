import React, { useState } from "react";
import {
  FiUsers,
  FiMoreVertical,
  FiShield,
  FiUserCheck,
  FiEye,
  FiEdit2,
  FiKey,
  FiUserX,
} from "react-icons/fi";
import ActionMenu from "../../../components/ActionMenu";

export type UserRole = "admin" | "staff" | "auditor";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
  joinedDate: string;
  status: "active" | "inactive";
}

interface EmployeeListProps {
  employees?: Employee[];
  onEditRole?: (employee: Employee) => void;
  onResetPassword?: (employee: Employee) => void;
  onRemoveEmployee?: (id: string) => void;
  onNavigateToEmployees?: () => void;
}

// UI-REGION: Employee roster table — avatar, role badge, status, and the
// per-row action menu (edit role / reset password / remove).
// TODO[BACKEND]: This defaultEmployees list is only a fallback used when no
// `employees` prop is passed (Dashboard embed) — the parent should fetch
// from GET /api/employees and pass the result down instead of relying on
// this hard-coded roster; the reset-password action should POST
// /api/employees/:id/reset-password (SSO-managed accounts will not need it).
const defaultEmployees: Employee[] = [
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

export const EmployeeList: React.FC<EmployeeListProps> = ({
  employees = defaultEmployees,
  onEditRole,
  onResetPassword,
  onRemoveEmployee,
  onNavigateToEmployees,
}) => {
  const [activeMenu, setActiveMenu] = useState<{
    employee: Employee;
    position: { top: number; left: number };
  } | null>(null);

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case "admin":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-danger/10 text-danger border border-danger/20">
            <FiShield className="w-3 h-3" />
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-warning/10 text-warning border border-warning/20">
            <FiEye className="w-3 h-3" />
            Auditor
          </span>
        );
      case "staff":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <FiUserCheck className="w-3 h-3" />
            Staff
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-surface border border-subtle rounded-xl overflow-hidden shadow-sm">
      {/* Component Header */}
      <div className="p-4 border-b border-subtle flex items-center justify-between">
        {onNavigateToEmployees ? (
          <button
            type="button"
            onClick={onNavigateToEmployees}
            className="flex items-center gap-2 text-primary hover:text-accent-primary transition-colors group focus:outline-none"
          >
            <FiUsers className="text-accent-primary w-4 h-4 group-hover:scale-110 transition-transform" />
            <h3 className="text-sm font-semibold tracking-wide group-hover:underline">
              Team Members & Roles
            </h3>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-primary">
            <FiUsers className="text-accent-primary w-4 h-4" />
            <h3 className="text-sm font-semibold tracking-wide">
              Team Members & Roles
            </h3>
          </div>
        )}
        <span className="text-xs text-muted">
          {employees.length} Members
        </span>
      </div>

      {/* Employee Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-subtle text-[11px] uppercase tracking-wider text-muted bg-surface-sunken/30">
              <th className="py-3 px-4 font-medium">User ID</th>
              <th className="py-3 px-4 font-medium">Employee</th>
              <th className="py-3 px-4 font-medium">Assigned Role</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Joined</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/60 text-xs">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-faint">
                  No members found.
                </td>
              </tr>
            ) : (
              employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="hover:bg-surface-sunken/40 transition-colors group"
                >
                  {/* ID */}
                  <td className="py-3 px-4 font-mono text-[11px] text-muted">
                    {emp.id}
                  </td>

                  {/* Name + Initials Avatar */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-surface-hover border border-strong flex items-center justify-center text-[10px] font-semibold text-secondary">
                        {emp.avatarInitials}
                      </div>
                      <div>
                        <div className="font-medium text-secondary group-hover:text-primary">
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-faint">
                          {emp.email}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Role Badge */}
                  <td className="py-3 px-4">{getRoleBadge(emp.role)}</td>

                  {/* Status Indicator */}
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-medium capitalize ${
                        emp.status === "active"
                          ? "text-success"
                          : "text-faint"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          emp.status === "active"
                            ? "bg-success"
                            : "bg-muted"
                        }`}
                      />
                      {emp.status}
                    </span>
                  </td>

                  {/* Joined Date */}
                  <td className="py-3 px-4 text-muted">{emp.joinedDate}</td>

                  {/* 3-Dots Action Trigger */}
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      aria-label={`Actions for ${emp.name}`}
                      data-action-trigger="true"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeMenu?.employee.id === emp.id) {
                          setActiveMenu(null);
                          return;
                        }
                        const rect = e.currentTarget.getBoundingClientRect();
                        const menuWidth = 160;
                        setActiveMenu({
                          employee: emp,
                          position: {
                            top: rect.bottom + 6,
                            left: rect.right - menuWidth,
                          },
                        });
                      }}
                      className="p-1.5 rounded-lg text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                    >
                      <FiMoreVertical className="w-4 h-4 pointer-events-none" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Floating Action Menu */}
      {activeMenu && (
        <ActionMenu
          isOpen={Boolean(activeMenu)}
          position={activeMenu.position}
          onClose={() => setActiveMenu(null)}
          options={[
            {
              label: "Modify Role",
              icon: FiEdit2,
              onClick: () => onEditRole?.(activeMenu.employee),
            },
            {
              label: "Reset Password",
              icon: FiKey,
              onClick: () => onResetPassword?.(activeMenu.employee),
            },
            {
              label: "Revoke Access",
              icon: FiUserX,
              variant: "danger",
              onClick: () => onRemoveEmployee?.(activeMenu.employee.id),
            },
          ]}
        />
      )}
    </div>
  );
};

export default EmployeeList;
