import React, { useState } from "react";
import {
  FiUsers,
  FiMoreVertical,
  FiShield,
  FiUserCheck,
  FiEye,
  FiEdit2,
  FiUserX,
  FiUserPlus,
} from "react-icons/fi";
import ActionMenu from "../../../components/ActionMenu";

/** UI role labels: the API's "operator" role is shown as "staff". */
export type UserRole = "admin" | "staff" | "auditor";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
  joinedDate: string;
  status: "active" | "revoked";
}

interface EmployeeListProps {
  employees?: Employee[];
  onEditRole?: (employee: Employee) => void;
  onRemoveEmployee?: (id: string) => void;
  onRestoreEmployee?: (employee: Employee) => void;
  onNavigateToEmployees?: () => void;
}

// UI-REGION: Team roster — role badge, access status, and the per-row action
// menu. Access is a whitelist: revoking keeps the row (and its history), so a
// revoked person can be restored with the same member id.
export const EmployeeList: React.FC<EmployeeListProps> = ({
  employees = [],
  onEditRole,
  onRemoveEmployee,
  onRestoreEmployee,
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
      <div className="p-4 border-b border-subtle flex items-center justify-between">
        {onNavigateToEmployees ? (
          <button
            type="button"
            onClick={onNavigateToEmployees}
            className="flex items-center gap-2 text-primary hover:text-accent-primary transition-colors group focus:outline-none"
          >
            <FiUsers className="text-accent-primary w-4 h-4 group-hover:scale-110 transition-transform" />
            <h3 className="text-sm font-semibold tracking-wide group-hover:underline">
              Team Members &amp; Roles
            </h3>
          </button>
        ) : (
          <div className="flex items-center gap-2 text-primary">
            <FiUsers className="text-accent-primary w-4 h-4" />
            <h3 className="text-sm font-semibold tracking-wide">Team Members &amp; Roles</h3>
          </div>
        )}
        <span className="text-xs text-muted">{employees.length} members</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-subtle text-[11px] uppercase tracking-wider text-muted bg-surface-sunken/30">
              <th className="py-3 px-4 font-medium">Member ID</th>
              <th className="py-3 px-4 font-medium">Employee</th>
              <th className="py-3 px-4 font-medium">Assigned Role</th>
              <th className="py-3 px-4 font-medium">Access</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/60 text-xs">
            {employees.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-8 text-center text-faint">
                  No members found.
                </td>
              </tr>
            ) : (
              employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-surface-sunken/40 transition-colors group">
                  <td className="py-3 px-4 font-mono text-[10px] text-muted">
                    {emp.id.length > 14 ? `${emp.id.slice(0, 14)}…` : emp.id}
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-full bg-surface-hover border border-strong flex items-center justify-center text-[10px] font-semibold text-secondary">
                        {emp.avatarInitials}
                      </div>
                      <div>
                        <div className="font-medium text-secondary group-hover:text-primary">
                          {emp.name}
                        </div>
                        <div className="text-[11px] text-faint">{emp.email}</div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3 px-4">{getRoleBadge(emp.role)}</td>

                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                        emp.status === "active" ? "text-success" : "text-danger"
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          emp.status === "active" ? "bg-success" : "bg-danger"
                        }`}
                      />
                      {emp.status === "active" ? "Active" : "Access removed"}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right">
                    {(onEditRole || onRemoveEmployee || onRestoreEmployee) && (
                      <button
                        type="button"
                        aria-label={`Actions for ${emp.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeMenu?.employee.id === emp.id) {
                            setActiveMenu(null);
                            return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          setActiveMenu({
                            employee: emp,
                            position: { top: rect.bottom + 6, left: rect.right - 160 },
                          });
                        }}
                        className="p-1.5 rounded-lg text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
                      >
                        <FiMoreVertical className="w-4 h-4 pointer-events-none" />
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {activeMenu && (
        <ActionMenu
          isOpen
          position={activeMenu.position}
          onClose={() => setActiveMenu(null)}
          options={[
            ...(activeMenu.employee.role !== "admin" && activeMenu.employee.status === "active"
              ? [
                  {
                    label: "Modify Role",
                    icon: FiEdit2,
                    onClick: () => onEditRole?.(activeMenu.employee),
                  },
                ]
              : []),
            ...(activeMenu.employee.status === "active"
              ? [
                  {
                    label: "Remove Access",
                    icon: FiUserX,
                    variant: "danger" as const,
                    onClick: () => onRemoveEmployee?.(activeMenu.employee.id),
                  },
                ]
              : [
                  {
                    label: "Restore Access",
                    icon: FiUserPlus,
                    onClick: () => onRestoreEmployee?.(activeMenu.employee),
                  },
                ]),
          ]}
        />
      )}
    </div>
  );
};

export default EmployeeList;
