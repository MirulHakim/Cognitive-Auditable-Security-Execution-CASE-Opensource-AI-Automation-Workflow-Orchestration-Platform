import { describe, expect, it } from "vitest";
import { canonicalize, computeAuditHash } from "../../src/audit/auditLog.js";
import { createAuthAuditor } from "../../src/auth-gateway/audit.js";
import { MemoryAudit } from "./helpers.js";

const WORKSPACE = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
const FORBIDDEN = /(^|_)(token|secret|password|api_key|credentials)($|_)/;

function walk(value: unknown, path: string, problems: string[]): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) problems.push(`${path}: float`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, problems));
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.test(key)) problems.push(`${path}.${key}: forbidden key`);
      walk(child, `${path}.${key}`, problems);
    }
    return;
  }
  problems.push(`${path}: ${typeof value}`);
}

describe("auth audit consumer", () => {
  it("emits the required actions with canonical, PII-free details", async () => {
    const recorder = new MemoryAudit();
    const audit = createAuthAuditor(recorder, WORKSPACE);

    audit.rootAdminInitialized({ operatorId: "op-root", role: "admin", workspaceId: WORKSPACE });
    audit.operatorInvited({
      actorId: "op-root",
      actorRole: "admin",
      invitationId: "inv-1",
      email: "Person@Agency.Gov.My",
      role: "operator",
      expiresAt: new Date("2026-11-17T12:00:00.000Z"),
      delivery: "SENT",
      channel: "SMTP",
    });
    audit.invitationAccepted({
      invitationId: "inv-1",
      operatorId: "op-2",
      role: "operator",
      workspaceId: WORKSPACE,
    });
    audit.authenticationSucceeded({
      operatorId: "op-2",
      role: "operator",
      email: "Person@Agency.Gov.My",
      workspaceId: WORKSPACE,
    });
    audit.authenticationFailed({
      reasonCode: "INVITATION_REQUIRED",
      email: "stranger@agency.gov.my",
      workspaceId: WORKSPACE,
    });
    audit.authenticationLogout({
      operatorId: "op-2",
      role: "operator",
      workspaceId: WORKSPACE,
    });
    audit.operatorRevoked({
      actorId: "op-root",
      actorRole: "admin",
      operatorId: "op-3",
      role: "auditor",
      email: "Gone@Agency.Gov.My",
      reasonCode: "ADMIN_HARD_DELETE",
      accountsDeleted: 1,
      refreshTokensDeleted: 2,
      invitationsUnlinked: 0,
      workspaceId: WORKSPACE,
    });

    // The adapter records asynchronously (best effort); await the microtasks.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(recorder.events.map((event) => event.action)).toEqual([
      "ROOT_ADMIN_INITIALIZED",
      "OPERATOR_INVITED",
      "INVITATION_ACCEPTED",
      "AUTHENTICATION_SUCCESS",
      "AUTHENTICATION_FAILED",
      "AUTHENTICATION_LOGOUT",
      "OPERATOR_REVOKED",
    ]);

    for (const event of recorder.events) {
      const problems: string[] = [];
      walk(event.details, "details", problems);
      expect(problems, `${event.action}: ${problems.join(", ")}`).toEqual([]);
      expect(JSON.stringify(event.details)).not.toMatch(/@agency\.gov\.my/i);
      expect(JSON.stringify(event.details)).not.toContain("1234567890abcdef");
      // Feed the exact payload the real writer hashes; it must be stable and
      // produce a 64-hex digest under the existing formula.
      const canonical = canonicalize(event.details);
      expect(JSON.stringify(canonical)).toBe(JSON.stringify(canonicalize(event.details)));
      const hash = computeAuditHash(
        {
          sequence: 1,
          recordedAt: "2026-11-17T10:00:00.000Z",
          actorId: event.actorId,
          actorRole: event.actorRole,
          action: event.action,
          targetType: event.targetType ?? "",
          targetId: event.targetId ?? "",
          outcome: event.outcome ?? "SUCCESS",
          details: event.details ?? {},
        },
        "0".repeat(64),
      );
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }

    const invited = recorder.events[1]!;
    expect(invited.details?.expires_at).toBe("2026-11-17T12:00:00.000Z");
    expect(invited.details?.email_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(recorder.events[4]!.outcome).toBe("FAILURE");
    expect(recorder.events[4]!.details?.reason_code).toBe("INVITATION_REQUIRED");

    const revoked = recorder.events[6]!;
    expect(revoked).toMatchObject({
      action: "OPERATOR_REVOKED",
      targetType: "operator",
      targetId: "op-3",
      outcome: "SUCCESS",
    });
    expect(revoked.details).toMatchObject({
      reason_code: "ADMIN_HARD_DELETE",
      accounts_deleted: 1,
      refresh_tokens_deleted: 2,
      invitations_unlinked: 0,
    });
  });
});
