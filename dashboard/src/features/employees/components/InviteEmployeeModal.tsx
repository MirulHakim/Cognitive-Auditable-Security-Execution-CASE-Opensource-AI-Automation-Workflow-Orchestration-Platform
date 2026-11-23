import React, { useState } from "react";
import { FiX, FiMail, FiShield } from "react-icons/fi";
import { errorMessage, inviteMember } from "../../../api/client";
import {
  initials,
  pendingMemberFromInvitation,
  uiRole,
} from "../../../lib/format";
import { type Employee, type UserRole } from "./EmployeeList";

interface InviteEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (newEmployee: Employee) => void;
}

/**
 * Reusable invite dialog. The real directory screen renders its own modal, but
 * this component stays on the same gateway contract: create an invitation,
 * email the magic link, and hand the caller an optimistic Pending row.
 */
export const InviteEmployeeModal: React.FC<InviteEmployeeModalProps> = ({
  isOpen,
  onClose,
  onAdd,
}) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address || sending) return;

    setSending(true);
    setError(null);
    try {
      const result = await inviteMember({
        email: address,
        // The gateway invites operator or auditor only; "staff" is the UI label
        // for the operator role.
        role: role === "auditor" ? "auditor" : "operator",
      });
      const member = pendingMemberFromInvitation(result.invitation);
      onAdd({
        id: member.id,
        name: member.displayName,
        email: member.email,
        role: uiRole(member.role),
        avatarInitials: initials(member.displayName),
        joinedDate: "—",
        online: false,
        lastSeenAt: null,
        pending: true,
        pendingExpiresAt: member.expiresAt ?? null,
        invitedAt: member.invitedAt ?? null,
      });
      setEmail("");
      setRole("staff");
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSending(false);
    }
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
          onSubmit={(event) => void handleSubmit(event)}
          className="p-4 flex flex-col gap-4 text-xs"
        >
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
                placeholder="alex@agency.gov.my"
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
              </select>
            </div>
          </div>

          <p className="text-[11px] text-faint leading-relaxed">
            A single-use link is emailed from the CASE system account and expires
            in 2 hours. The invitee appears as Pending until they accept.
          </p>

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[11px] text-danger">
              {error}
            </p>
          )}

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
              disabled={sending || !email.includes("@")}
              className="px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send Invitation"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InviteEmployeeModal;
