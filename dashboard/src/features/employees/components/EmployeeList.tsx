import React, { useState } from "react";
import {
  FiUsers,
  FiMoreVertical,
  FiShield,
  FiUserCheck,
  FiEye,
  FiEdit2,
  FiUserX,
} from "react-icons/fi";
import ActionMenu from "../../../components/ActionMenu";
import { formatDateTime, timeAgo } from "../../../lib/format";

/** UI role labels: the API's "operator" role is shown as "staff". */
export type UserRole = "admin" | "staff" | "auditor";

export interface Employee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarInitials: string;
  joinedDate: string;
  /** Live presence from the gateway: last activity within the 2-minute window. */
  online: boolean;
  /** Null means the member has never signed in through the gateway. */
  lastSeenAt: string | null;
  /** Invitation sent, not accepted yet — no presence to show. */
  pending: boolean;
  /** When the magic link stops working (only while pending). */
  pendingExpiresAt: string | null;
  /** When the invitation was sent (only while pending). */
  invitedAt: string | null;
}

interface EmployeeListProps {
  employees?: Employee[];
  onEditRole?: (employee: Employee) => void;
  /** Permanently deletes the account — there is nothing left to restore. */
  onRemoveEmployee?: (id: string) => void;
  /** Cancels a pending invite; its magic link stops working immediately. */
  onWithdrawInvite?: (employee: Employee) => void;
  onNavigateToEmployees?: () => void;
}

// UI-REGION: Team roster — role badge, live presence, and the per-row action
// menu. The Access column is presence (green = active now, gray = offline),
// not an account flag; revoked accounts are deleted and never listed.
export const EmployeeList: React.FC<EmployeeListProps> = ({
  employees = [],
  onEditRole,
  onRemoveEmployee,
  onWithdrawInvite,
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
        <span className="text-xs text-muted">
          {employees.length} members
          {employees.some((employee) => employee.pending)
            ? ` · ${employees.filter((employee) => employee.pending).length} pending`
            : ""}
        </span>
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
                    {emp.pending
                      ? "—"
                      : emp.id.length > 14
                        ? `${emp.id.slice(0, 14)}…`
                        : emp.id}
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
                    {emp.pending ? (
                      <span
                        title={`Invited ${emp.invitedAt ? timeAgo(emp.invitedAt) : "recently"} — expires ${
                          emp.pendingExpiresAt
                            ? formatDateTime(emp.pendingExpiresAt)
                            : "in 2 hours"
                        }`}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium text-warning"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                        Pending
                      </span>
                    ) : (
                      <span
                        title={
                          emp.online
                            ? "Active now"
                            : emp.lastSeenAt
                              ? `Last seen ${timeAgo(emp.lastSeenAt)}`
                              : "Has not signed in yet"
                        }
                        className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${
                          emp.online ? "text-success" : "text-muted"
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            emp.online ? "bg-success" : "bg-faint"
                          }`}
                        />
                        {emp.online ? "Active" : "Offline"}
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-4 text-right">
                    {((emp.pending && onWithdrawInvite) ||
                      (!emp.pending && (onEditRole || onRemoveEmployee))) && (
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
          options={
            activeMenu.employee.pending
              ? [
                  {
                    label: "Withdraw Invite",
                    icon: FiUserX,
                    variant: "danger" as const,
                    onClick: () => onWithdrawInvite?.(activeMenu.employee),
                  },
                ]
              : activeMenu.employee.role !== "admin"
                ? [
                    {
                      label: "Modify Role",
                      icon: FiEdit2,
                      onClick: () => onEditRole?.(activeMenu.employee),
                    },
                    {
                      label: "Revoke Access",
                      icon: FiUserX,
                      variant: "danger" as const,
                      onClick: () => onRemoveEmployee?.(activeMenu.employee.id),
                    },
                  ]
                : []
          }
        />
      )}
    </div>
  );
};

export default EmployeeList;
