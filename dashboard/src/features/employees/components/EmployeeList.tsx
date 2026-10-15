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
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <FiShield className="w-3 h-3" />
            Admin
          </span>
        );
      case "auditor":
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <FiEye className="w-3 h-3" />
            Auditor
          </span>
        );
      case "staff":
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <FiUserCheck className="w-3 h-3" />
            Staff
          </span>
        );
    }
  };

  return (
    <div className="w-full bg-[#0f172a] border border-slate-800 rounded-xl overflow-hidden shadow-sm">
      {/* Component Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between">
        {onNavigateToEmployees ? (
          <button
            type="button"
            onClick={onNavigateToEmployees}
            className="flex items-center gap-2 text-white hover:text-cyan-400 transition-colors group focus:outline-none"
          >
            <FiUsers className="text-cyan-400 w-4 h-4 group-hover:scale-110 transition-transform" />
            <h3 className="text-sm font-semibold tracking-wide group-hover:underline">
              Team Members & Roles
            </h3>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-white">
            <FiUsers className="text-cyan-400 w-4 h-4" />
            <h3 className="text-sm font-semibold tracking-wide">
              Team Members & Roles
            </h3>
          </div>
        )}
        <span className="text-xs text-slate-400">
          {employees.length} Members
        </span>
      </div>

      {/* Employee Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-800 text-[11px] uppercase tracking-wider text-slate-400 bg-slate-900/30">
              <th className="py-3 px-4 font-medium">User ID</th>
              <th className="py-3 px-4 font-medium">Employee</th>
              <th className="py-3 px-4 font-medium">Assigned Role</th>
              <th className="py-3 px-4 font-medium">Status</th>
              <th className="py-3 px-4 font-medium">Joined</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 text-xs">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-500">
                  No members found.
                </td>
              </tr>
            ) : (
              employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="hover:bg-slate-900/40 transition-colors group"
                >
                  {/* ID */}
                  <td className="py-3 px-4 font-mono text-[11px] text-slate-400">
                    {emp.id}
                  </td>

                  {/* Name + Initials Avatar */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-[10px] font-semibold text-slate-200">
                        {emp.avatarInitials}
                      </div>
                      <div>
                        <div className="font-medium text-slate-200 group-hover:text-white">
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-slate-500">
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
                          ? "text-emerald-400"
                          : "text-slate-500"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          emp.status === "active"
                            ? "bg-emerald-400"
                            : "bg-slate-500"
                        }`}
                      />
                      {emp.status}
                    </span>
                  </td>

                  {/* Joined Date */}
                  <td className="py-3 px-4 text-slate-400">{emp.joinedDate}</td>

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
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
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
