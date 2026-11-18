import request from "supertest";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/auth-gateway/tokens.js";
import {
  buildGateway,
  operator,
  type MemoryStore,
} from "./helpers.js";
import type { TokenVault } from "../../src/auth-gateway/tokenVault.js";

const FORBIDDEN_DETAIL_KEY = /(^|_)(secret|password|api_key|credentials)($|_)/;

function seedVictim(store: MemoryStore, vault: TokenVault) {
  const victim = store.seedOperator(
    operator({ email: "victim@agency.gov.my", role: "operator", displayName: "Vic Tim" }),
  );
  store.accounts.set("google-sub-victim", {
    accountId: "account-victim",
    operatorId: victim.id,
    email: victim.email,
  });
  store.googleTokens.set(victim.id, {
    accessTokenEnc: vault.seal("victim-access"),
    refreshTokenEnc: vault.seal("victim-refresh"),
    expiresAt: new Date("2026-11-17T12:00:00.000Z"),
    scopes: ["openid", "email"],
  });
  store.refresh.set("victim-refresh-hash", {
    operatorId: victim.id,
    expiresAt: new Date("2026-12-17T12:00:00.000Z"),
    revokedAt: null,
  });
  return victim;
}

async function adminSession(gateway: ReturnType<typeof buildGateway>) {
  const admin = gateway.store.seedOperator(
    operator({ email: "root@agency.gov.my", role: "admin", displayName: "Root Admin" }),
  );
  return { admin, token: await gateway.tokens.sign(admin) };
}

describe("hard revocation", () => {
  it("deletes the operator, its credentials and audits OPERATOR_REVOKED canonically", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);
    const victim = seedVictim(gateway.store, gateway.vault);

    const response = await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      revoked: true,
      operatorId: victim.id,
      deleted: { accounts: 1, refreshTokens: 1, invitationsUnlinked: 0 },
    });

    expect(gateway.store.operators.has(victim.id)).toBe(false);
    expect(gateway.store.accounts.size).toBe(0);
    expect(gateway.store.googleTokens.size).toBe(0);
    expect(gateway.store.refresh.size).toBe(0);

    const revoked = gateway.audit.events.find(
      (event) => event.action === "OPERATOR_REVOKED",
    );
    expect(revoked?.outcome).toBe("SUCCESS");
    expect(revoked?.targetId).toBe(victim.id);
    expect(revoked?.details).toMatchObject({
      operator_id: victim.id,
      role: "operator",
      reason_code: "ADMIN_HARD_DELETE",
      accounts_deleted: 1,
      refresh_tokens_deleted: 1,
      workspace_id: gateway.config.workspaceId,
    });
    // Canonicalisation gates: hashed email, integers, no free-text/PII/secrets.
    expect(revoked?.details?.email_hash).toEqual(expect.any(String));
    expect(JSON.stringify(revoked?.details)).not.toContain(victim.email);
    for (const [key, value] of Object.entries(revoked?.details ?? {})) {
      expect(FORBIDDEN_DETAIL_KEY.test(key)).toBe(false);
      if (typeof value === "number") expect(Number.isInteger(value)).toBe(true);
      if (value !== null && typeof value === "object") {
        throw new Error(`detail ${key} is not a primitive`);
      }
    }
  });

  it("unlinks invitations the deleted admin had sent", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);
    const victim = seedVictim(gateway.store, gateway.vault);

    const invitation = await gateway.store.createInvitation({
      email: "invitee@agency.gov.my",
      role: "auditor",
      invitedBy: victim.id,
      workspaceId: gateway.config.workspaceId,
      tokenHash: sha256Hex("invite-token"),
      createdAt: new Date("2026-11-17T09:00:00.000Z"),
      expiresAt: new Date("2026-11-17T11:00:00.000Z"),
    });

    const response = await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.deleted.invitationsUnlinked).toBe(1);
    const stored = await gateway.store.listInvitations();
    expect(stored.find((row) => row.invitationId === invitation.invitationId)?.invitedBy).toBeNull();
  });

  it("keeps an accepted invitation consumable after its operator is deleted", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);
    const victim = seedVictim(gateway.store, gateway.vault);

    const invitation = await gateway.store.createInvitation({
      email: victim.email,
      role: "operator",
      invitedBy: victim.id,
      workspaceId: gateway.config.workspaceId,
      tokenHash: sha256Hex("accepted-invite-token"),
      createdAt: new Date("2026-11-17T09:00:00.000Z"),
      expiresAt: new Date("2026-11-17T11:00:00.000Z"),
    });
    const acceptedAt = new Date("2026-11-17T09:30:00.000Z");
    const stored = gateway.store.invitations.get(invitation.invitationId)!;
    gateway.store.invitations.set(invitation.invitationId, {
      ...stored,
      record: {
        ...stored.record,
        consumedAt: acceptedAt,
        acceptedOperatorId: victim.id,
      },
    });

    await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    const after = await gateway.store.findInvitationById(
      invitation.invitationId,
    );
    // The FK behaves like ON DELETE SET NULL: the acceptance reference goes,
    // but consumedAt stays so the magic link is still dead.
    expect(after).toMatchObject({
      invitationId: invitation.invitationId,
      consumedAt: acceptedAt,
      acceptedOperatorId: null,
    });
  });

  it("only lets an admin call it, and refuses self-revocation", async () => {
    const gateway = buildGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );
    const victim = seedVictim(gateway.store, gateway.vault);
    const memberToken = await gateway.tokens.sign(member);

    await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${memberToken}`)
      .expect(403);

    await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .expect(401);

    const { admin, token } = await adminSession(gateway);
    const self = await request(gateway.app)
      .delete(`/api/auth/operators/${admin.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(409);
    expect(self.body.error.code).toBe("SELF_REVOKE_FORBIDDEN");

    // Both targets survived the rejected attempts.
    expect(gateway.store.operators.has(victim.id)).toBe(true);
    expect(gateway.store.operators.has(admin.id)).toBe(true);
  });

  it("returns 404 for a member that does not exist", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);

    const response = await request(gateway.app)
      .delete("/api/auth/operators/does-not-exist")
      .set("Cookie", `case_session=${token}`)
      .expect(404);

    expect(response.body.error.code).toBe("OPERATOR_NOT_FOUND");
  });

  it("drops the deleted member's access token and refresh token immediately", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);
    const victim = seedVictim(gateway.store, gateway.vault);
    const victimToken = await gateway.tokens.sign(victim);
    await gateway.store.createRefreshToken({
      tokenHash: sha256Hex("victim-raw-refresh"),
      operatorId: victim.id,
      expiresAt: new Date("2026-12-17T12:00:00.000Z"),
    });

    await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    const me = await request(gateway.app)
      .get("/api/auth/me")
      .set("Cookie", `case_session=${victimToken}`)
      .expect(401);
    expect(me.body.error.code).toBe("SESSION_INVALID");

    await request(gateway.app)
      .post("/api/auth/refresh")
      .set("Cookie", `case_refresh=victim-raw-refresh`)
      .expect(401);
  });

  it("lets the person return only through a brand-new invitation", async () => {
    const gateway = buildGateway();
    const { token } = await adminSession(gateway);
    const victim = seedVictim(gateway.store, gateway.vault);

    await request(gateway.app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    // Re-inviting the same address now succeeds: the old operator is gone.
    await request(gateway.app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: victim.email, role: "operator" })
      .expect(201);

    const magicLink = gateway.mailer.sent.at(-1)?.magicLink ?? "";
    const magicToken = new URL(magicLink).searchParams.get("token");
    expect(magicToken).toBeTruthy();

    await request(gateway.app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(magicToken!)}`)
      .expect(303);

    const recreated = await gateway.store.findOperatorByEmail(victim.email);
    expect(recreated).toBeDefined();
    // Fresh identity: new operator id, no Google link until they sign in.
    expect(recreated!.id).not.toBe(victim.id);
    expect(gateway.store.accounts.size).toBe(0);
  });
});
