import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiUserPlus, FiSearch, FiFilter, FiDownloadCloud, FiX } from "react-icons/fi";
import EmployeeList, { type Employee } from "./components/EmployeeList";
import EmployeeStats from "./components/EmployeeStats";
import ConfirmModal from "../../components/ConfirmModal";
import {
  addMember,
  errorMessage,
  listMembers,
  revokeMember,
  setMemberRole,
} from "../../api/client";
import type { Member } from "../../api/types";
import { initials, uiRole } from "../../lib/format";
import { useSession } from "../../context/SessionContext";

/**
 * Team directory backed by the real membership whitelist.
 *
 * Inviting an email grants access; removing access is a soft delete (the row
 * and all history stay); re-inviting the same email restores that member.
 * Admin accounts are provisioned outside this module, so their role and access
 * cannot be changed here — mirroring the server rules.
 */
export const EmployeeView: React.FC = () => {
  const { can, member: caller } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"operator" | "auditor">("operator");
  const [busy, setBusy] = useState(false);

  const [roleTarget, setRoleTarget] = useState<Member | null>(null);
  const [roleDraft, setRoleDraft] = useState<"operator" | "auditor">("operator");
  const [revokeTarget, setRevokeTarget] = useState<Member | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    listMembers()
      .then((result) => {
        setMembers(result);
        setError(null);
      })
      .catch((caught) => setError(errorMessage(caught)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const employees = useMemo<Employee[]>(
    () =>
      members.map((entry) => ({
        id: entry.id,
        name: entry.displayName,
        email: entry.email,
        role: uiRole(entry.role),
        avatarInitials: initials(entry.displayName),
        joinedDate: "—",
        status: entry.revokedAt === null ? "active" : "revoked",
      })),
    [members],
  );

  const filteredEmployees = employees.filter((emp) => {
    const query = searchQuery.trim().toLowerCase();
    const matchesSearch =
      query.length === 0 ||
      emp.name.toLowerCase().includes(query) ||
      emp.email.toLowerCase().includes(query) ||
      emp.id.toLowerCase().includes(query);
    const matchesRole = roleFilter === "all" || emp.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  const handleInvite = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await addMember({
        email: inviteEmail.trim(),
        displayName: inviteName.trim() || undefined,
        role: inviteRole,
      });
      setNotice(
        `${created.displayName} can now sign in as ${created.role}.`,
      );
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      setInviteRole("operator");
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveRole = async () => {
    if (!roleTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setMemberRole(roleTarget.id, roleDraft);
      setNotice(`${updated.displayName} is now ${updated.role}. Their next request is checked against it.`);
      setRoleTarget(null);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget || busy) return;
    setBusy(true);
    setError(null);
    try {
      const revoked = await revokeMember(revokeTarget.id);
      setNotice(
        `${revoked.displayName} no longer has access — their templates, reviews and runs still name them.`,
      );
      setRevokeTarget(null);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (employee: Employee) => {
    if (busy) return;
    const source = members.find((entry) => entry.id === employee.id);
    if (!source) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await addMember({
        email: source.email,
        role: source.role === "admin" ? "operator" : source.role,
      });
      setNotice(`${restored.displayName} can access the workspace again — same member id.`);
      refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    const header = "id,name,email,role,access\n";
    const body = members
      .map(
        (entry) =>
          `${entry.id},"${entry.displayName}",${entry.email},${entry.role},${
            entry.revokedAt === null ? "active" : "revoked"
          }`,
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([header + body], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "case-members.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const isAdmin = can("users:manage");

  return (
    <div className="w-full min-h-screen bg-background text-primary p-6 flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-primary tracking-wide">
            Team Directory &amp; Access Control
          </h1>
          <p className="text-xs text-muted mt-1">
            Invite by email, switch roles, and remove access — history is never
            deleted.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-subtle bg-surface hover:bg-surface-hover text-xs font-medium text-secondary transition-colors"
          >
            <FiDownloadCloud className="w-3.5 h-3.5 text-muted" />
            <span>Export CSV</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-sm shadow-accent-primary/40"
            >
              <FiUserPlus className="w-4 h-4 stroke-[2.5]" />
              <span>Invite Member</span>
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-xs text-danger">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-success/30 bg-success/10 px-4 py-3 text-xs text-success">
          {notice}
        </div>
      )}
      {!isAdmin && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-xs text-warning">
          Only an admin can invite, re-role or remove members.
        </div>
      )}

      <EmployeeStats employees={employees} />

      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-surface border border-subtle p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-faint w-4 h-4" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email, or ID…"
            className="w-full bg-background border border-subtle rounded-lg pl-9 pr-3 py-1.5 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <FiFilter className="w-3.5 h-3.5 text-accent-primary" />
            <span>Filter Role:</span>
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="bg-background border border-subtle text-xs text-primary rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-accent-primary/50"
          >
            <option value="all">All Roles</option>
            <option value="admin">Admins</option>
            <option value="staff">Staff</option>
            <option value="auditor">Auditors</option>
          </select>
        </div>
      </div>

      {loading && members.length === 0 ? (
        <p className="text-xs text-muted">Loading members…</p>
      ) : (
        <EmployeeList
          employees={filteredEmployees}
          onEditRole={
            isAdmin
              ? (employee) => {
                  const source = members.find((entry) => entry.id === employee.id);
                  if (!source) return;
                  setRoleTarget(source);
                  setRoleDraft(source.role === "auditor" ? "auditor" : "operator");
                }
              : undefined
          }
          onRemoveEmployee={
            isAdmin
              ? (id) => {
                  const source = members.find((entry) => entry.id === id);
                  if (source) setRevokeTarget(source);
                }
              : undefined
          }
          onRestoreEmployee={isAdmin ? (employee) => void handleRestore(employee) : undefined}
        />
      )}

      {inviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-subtle flex items-center justify-between">
              <h3 className="text-sm font-semibold text-primary">Whitelist a member</h3>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover"
                aria-label="Close invite"
              >
                <FiX className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Work email
                </span>
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder="farid.hakim@agency.gov.my"
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Display name (optional)
                </span>
                <input
                  value={inviteName}
                  onChange={(event) => setInviteName(event.target.value)}
                  placeholder="Derived from the email when left empty"
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent-primary/50"
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                  Role
                </span>
                <select
                  value={inviteRole}
                  onChange={(event) =>
                    setInviteRole(event.target.value as "operator" | "auditor")
                  }
                  className="mt-1 w-full bg-background border border-subtle rounded-lg px-3 py-2 text-xs text-primary focus:outline-none focus:border-accent-primary/50"
                >
                  <option value="operator">Operator — create, approve, run</option>
                  <option value="auditor">Auditor — read only</option>
                </select>
              </label>
              <p className="text-[11px] text-faint leading-relaxed">
                The address itself becomes a valid identity. Re-inviting a revoked
                email restores the same member and their history.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleInvite()}
                  disabled={busy || !inviteEmail.includes("@")}
                  className="px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Grant access"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {roleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-primary">
              Change role — {roleTarget.displayName}
            </h3>
            <p className="text-[11px] text-muted">
              The very next request from this member is checked against the new
              role on the server.
            </p>
            <div className="space-y-2">
              {(["operator", "auditor"] as const).map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => setRoleDraft(role)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-xs ${
                    roleDraft === role
                      ? "border-accent-primary/50 bg-accent-primary/10 text-primary"
                      : "border-subtle text-secondary hover:bg-surface-hover"
                  }`}
                >
                  <span className="font-semibold capitalize">{role}</span>
                  <span className="block text-[10px] text-muted mt-0.5">
                    {role === "operator"
                      ? "Create, edit, approve templates and run workflows."
                      : "Read-only over templates, runs and documents."}
                  </span>
                </button>
              ))}
            </div>
            {caller?.role === "admin" && roleTarget.role === "admin" && (
              <p className="text-[11px] text-warning">
                Admin roles are provisioned outside this module.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRoleTarget(null)}
                className="px-3 py-1.5 rounded-lg border border-strong text-xs text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveRole()}
                disabled={busy}
                className="px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast text-xs font-semibold disabled:opacity-50"
              >
                Save role
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={revokeTarget !== null}
        title="Remove access"
        message={`Remove ${revokeTarget?.displayName ?? "this member"}'s access? They will be blocked on their next request, but every template, review and run they touched keeps their identity.`}
        confirmLabel="Remove access"
        cancelLabel="Keep access"
        variant="danger"
        onConfirm={() => void handleRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </div>
  );
};

export default EmployeeView;
