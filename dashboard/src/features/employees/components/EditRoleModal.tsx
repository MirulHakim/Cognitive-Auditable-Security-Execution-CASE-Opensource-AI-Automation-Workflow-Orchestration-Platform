import React, { useState, useEffect } from "react";
import { FiX, FiShield, FiUserCheck, FiEye, FiCheck } from "react-icons/fi";
import { type Employee, type UserRole } from "./EmployeeList";

interface EditRoleModalProps {
  isOpen: boolean;
  employee: Employee | null;
  onClose: () => void;
  onSaveRole: (employeeId: string, newRole: UserRole) => void;
}

export const EditRoleModal: React.FC<EditRoleModalProps> = ({
  isOpen,
  employee,
  onClose,
  onSaveRole,
}) => {
  const [selectedRole, setSelectedRole] = useState<UserRole>("staff");

  useEffect(() => {
    if (employee) {
      setSelectedRole(employee.role);
    }
  }, [employee]);

  if (!isOpen || !employee) return null;

  const roleOptions: {
    role: UserRole;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
  }[] = [
    {
      role: "admin",
      title: "Administrator",
      description:
        "Full cluster management, user provisioning, and destructive actions.",
      icon: FiShield,
      accentColor: "border-danger/40 text-danger bg-danger/10",
    },
    {
      role: "staff",
      title: "Staff Member",
      description:
        "Standard workflow execution, task dispatch, and routine monitoring.",
      icon: FiUserCheck,
      accentColor: "border-accent-primary/40 text-accent-primary bg-accent-primary/10",
    },
    {
      role: "auditor",
      title: "Security Auditor",
      description:
        "Read-only access to execution histories, logs, and telemetry charts.",
      icon: FiEye,
      accentColor: "border-warning/40 text-warning bg-warning/10",
    },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveRole(employee.id, selectedRole);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-primary">
              Modify Employee Role
            </h3>
            <p className="text-[11px] text-muted mt-0.5">
              Updating access level for{" "}
              <span className="text-primary font-medium">{employee.name}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-3">
          {roleOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = selectedRole === opt.role;

            return (
              <div
                key={opt.role}
                onClick={() => setSelectedRole(opt.role)}
                className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-3 select-none ${
                  isSelected
                    ? "bg-surface-hover/80 border-accent-primary/80 ring-1 ring-accent-primary/40"
                    : "bg-background border-subtle/80 hover:border-strong"
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center border shrink-0 mt-0.5 ${opt.accentColor}`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-primary">
                      {opt.title}
                    </span>
                    {isSelected && (
                      <span className="h-4 w-4 rounded-full bg-accent-primary text-accent-contrast flex items-center justify-center">
                        <FiCheck className="w-2.5 h-2.5 stroke-3" />
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted mt-0.5 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-subtle text-xs">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
            >
              Update Role
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditRoleModal;
