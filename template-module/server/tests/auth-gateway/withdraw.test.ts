import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/auth-gateway/tokens.js";
import { buildGateway, operator } from "./helpers.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");

async function seedInvitation(
  gateway: ReturnType<typeof buildGateway>,
  adminId: string,
  overrides: { email?: string; token?: string } = {},
) {
  const token = overrides.token ?? "withdraw-me-token-0123456789";
  const invitation = await gateway.store.createInvitation({
    email: overrides.email ?? "pending@agency.gov.my",
    role: "operator",
    invitedBy: adminId,
    workspaceId: gateway.config.workspaceId,
    tokenHash: sha256Hex(token),
    createdAt: new Date("2026-11-17T09:30:00.000Z"),
    expiresAt: new Date("2026-11-17T11:30:00.000Z"),
  });
  return { invitation, token };
}

async function adminGateway() {
  const gateway = buildGateway({ now: () => NOW });
  const admin = gateway.store.seedOperator(
    operator({ email: "root@agency.gov.my", role: "admin", displayName: "Root Admin" }),
  );
  const token = await gateway.tokens.sign(admin);
  return { gateway, admin, token };
}

describe("withdrawing a pending invitation", () => {
  it("revokes the invitation, kills the magic link and audits the action", async () => {
    const { gateway, admin, token } = await adminGateway();
    const { invitation, token: magicToken } = await seedInvitation(
      gateway,
      admin.id,
    );

    const response = await request(gateway.app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      withdrawn: true,
      invitation: {
        invitationId: invitation.invitationId,
        status: "REVOKED",
        revokedAt: NOW.toISOString(),
      },
    });

    // The digest is still in the table, but the link can no longer be claimed.
    const after = await gateway.store.findInvitationById(invitation.invitationId);
    expect(after?.revokedAt).toEqual(NOW);

    const accept = await request(gateway.app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(magicToken)}`)
      .set("Accept", "application/json")
      .expect(410);
    expect(accept.body.error.code).toBe("REVOKED");
    expect(gateway.store.operators.size).toBe(1);

    const audit = gateway.audit.events.find(
      (event) => event.action === "OPERATOR_INVITATION_WITHDRAWN",
    );
    expect(audit).toMatchObject({
      actorId: admin.id,
      actorRole: "admin",
      targetType: "invitation",
      targetId: invitation.invitationId,
      outcome: "SUCCESS",
      details: {
        invitation_id: invitation.invitationId,
        role: "operator",
        reason_code: "ADMIN_WITHDREW_INVITATION",
        workspace_id: gateway.config.workspaceId,
      },
    });
    expect(audit?.details?.email_hash).toEqual(expect.any(String));
    expect(JSON.stringify(audit?.details)).not.toContain(invitation.email);
  });

  it("is admin-only and requires a session", async () => {
    const { gateway, admin, token } = await adminGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );
    const memberToken = await gateway.tokens.sign(member);
    const { invitation } = await seedInvitation(gateway, admin.id);

    await request(gateway.app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .set("Cookie", `case_session=${memberToken}`)
      .expect(403);

    await request(gateway.app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .expect(401);

    // Guaranteed distinct from the invitation UUID.
    const randomId = randomUUID();

    await request(gateway.app)
      .delete(`/api/invitations/${randomId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(404);

    expect(
      (await gateway.store.findInvitationById(invitation.invitationId))?.revokedAt,
    ).toBeNull();
  });

  it("refuses an invitation that was accepted or already withdrawn", async () => {
    const { gateway, admin, token } = await adminGateway();
    const accepted = await seedInvitation(gateway, admin.id, {
      email: "accepted@agency.gov.my",
      token: "accepted-token-0123456789",
    });

    await request(gateway.app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(accepted.token)}`)
      .set("Accept", "application/json")
      .expect(200);

    const conflict = await request(gateway.app)
      .delete(`/api/invitations/${accepted.invitation.invitationId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(409);
    expect(conflict.body.error.code).toBe("INVITATION_ALREADY_ACCEPTED");

    const pending = await seedInvitation(gateway, admin.id, {
      email: "twice@agency.gov.my",
      token: "withdraw-twice-token-0123456789",
    });

    await request(gateway.app)
      .delete(`/api/invitations/${pending.invitation.invitationId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    const again = await request(gateway.app)
      .delete(`/api/invitations/${pending.invitation.invitationId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(409);
    expect(again.body.error.code).toBe("INVITATION_ALREADY_WITHDRAWN");
  });

  it("rejects expired invitations without pretending to withdraw them", async () => {
    const { gateway, admin, token } = await adminGateway();
    const invitation = await gateway.store.createInvitation({
      email: "expired@agency.gov.my",
      role: "auditor",
      invitedBy: admin.id,
      workspaceId: gateway.config.workspaceId,
      tokenHash: sha256Hex("expired-token-0123456789"),
      createdAt: new Date("2026-11-17T07:00:00.000Z"),
      expiresAt: new Date("2026-11-17T09:00:00.000Z"),
    });

    const response = await request(gateway.app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .set("Cookie", `case_session=${token}`)
      .expect(410);

    expect(response.body.error.code).toBe("INVITATION_EXPIRED");
    expect(
      (await gateway.store.findInvitationById(invitation.invitationId))?.revokedAt,
    ).toBeNull();
    expect(
      gateway.audit.events.some(
        (event) => event.action === "OPERATOR_INVITATION_WITHDRAWN",
      ),
    ).toBe(false);
  });

  it("returns 404 for a malformed invitation id", async () => {
    const { gateway, token } = await adminGateway();

    const response = await request(gateway.app)
      .delete("/api/invitations/not-a-uuid")
      .set("Cookie", `case_session=${token}`)
      .expect(404);

    expect(response.body.error.code).toBe("INVITATION_NOT_FOUND");
  });
});
