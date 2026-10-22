import React, { useState } from "react";
import { FiX, FiMail, FiUser, FiShield } from "react-icons/fi";
import { type Employee, type UserRole } from "./EmployeeList";

interface InviteEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (newEmployee: Employee) => void;
}

export const InviteEmployeeModal: React.FC<InviteEmployeeModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    const initials = name
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();

    const newEmp: Employee = {
      id: `EMP-${String(Math.floor(Math.random() * 900) + 100)}`,
      name,
      email,
      role,
      avatarInitials: initials || "EX",
      joinedDate: "Oct 2026",
      status: "active",
    };

    onAdd(newEmp);
    setName("");
    setEmail("");
    setRole("staff");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <h3 className="text-sm font-semibold text-primary">
            Invite Team Member
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-4 flex flex-col gap-4 text-xs"
        >
          <div>
            <label className="block text-secondary font-medium mb-1">
              Full Name
            </label>
            <div className="relative">
              <FiUser className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-3.5 h-3.5" />
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Alex Morgan"
                className="w-full bg-background border border-subtle rounded-lg pl-9 pr-3 py-2 text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-secondary font-medium mb-1">
              Email Address
            </label>
            <div className="relative">
              <FiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-3.5 h-3.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="alex@axiomflow.internal"
                className="w-full bg-background border border-subtle rounded-lg pl-9 pr-3 py-2 text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
              />
            </div>
          </div>

          <div>
            <label className="block text-secondary font-medium mb-1">
              Role Allocation
            </label>
            <div className="relative">
              <FiShield className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-3.5 h-3.5 pointer-events-none" />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full bg-background border border-subtle rounded-lg pl-9 pr-3 py-2 text-primary focus:outline-none focus:border-accent-primary/50"
              >
                <option value="staff">Staff (Standard execution)</option>
                <option value="auditor">Auditor (View logs & telemetry)</option>
                <option value="admin">Administrator (Full control)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 mt-2 pt-3 border-t border-subtle">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
            >
              Send Invitation
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InviteEmployeeModal;
