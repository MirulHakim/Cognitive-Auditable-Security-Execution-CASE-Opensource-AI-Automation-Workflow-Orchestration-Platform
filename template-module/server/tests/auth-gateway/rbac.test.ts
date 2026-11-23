import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { AuthContext } from "../../src/auth-gateway/middleware.js";
import { requireRole } from "../../src/auth-gateway/middleware.js";
import { sha256Hex } from "../../src/auth-gateway/tokens.js";
import { buildGateway, operator, type MemoryStore } from "./helpers.js";

function seedMember(store: MemoryStore, role: "admin" | "operator" | "auditor") {
  return store.seedOperator(
    operator({
      email: `${role}@agency.gov.my`,
      role,
      displayName: `${role} member`,
    }),
  );
}

describe("gateway RBAC", () => {
  it("lets only an admin create an invitation", async () => {
    const { app, store, tokens, mailer } = buildGateway();
    const admin = seedMember(store, "admin");
    const operatorMember = seedMember(store, "operator");
    const auditor = seedMember(store, "auditor");

    for (const member of [operatorMember, auditor]) {
      const token = await tokens.sign(member);
      const denied = await request(app)
        .post("/api/invitations")
        .set("Cookie", `case_session=${token}`)
        .send({ email: "new@agency.gov.my", role: "operator" })
        .expect(403);

      expect(denied.body.error).toMatchObject({
        code: "FORBIDDEN",
        details: { requiredRoles: ["admin"], role: member.role },
      });
    }
    expect(mailer.sent).toHaveLength(0);
    expect(await store.listInvitations()).toHaveLength(0);

    const adminToken = await tokens.sign(admin);
    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${adminToken}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(201);
    expect(mailer.sent).toHaveLength(1);
  });

  it("lets only an admin withdraw an invitation", async () => {
    const { app, store, tokens } = buildGateway();
    const admin = seedMember(store, "admin");
    const operatorMember = seedMember(store, "operator");

    const invitation = await store.createInvitation({
      email: "pending@agency.gov.my",
      role: "operator",
      invitedBy: admin.id,
      workspaceId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
      tokenHash: sha256Hex("rbac-withdraw-token"),
      createdAt: new Date("2026-11-17T09:00:00.000Z"),
      expiresAt: new Date("2026-11-17T11:00:00.000Z"),
    });

    const operatorToken = await tokens.sign(operatorMember);
    const denied = await request(app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .set("Cookie", `case_session=${operatorToken}`)
      .expect(403);
    expect(denied.body.error.details).toMatchObject({
      requiredRoles: ["admin"],
      role: "operator",
    });
    expect(
      (await store.findInvitationById(invitation.invitationId))?.revokedAt,
    ).toBeNull();

    const adminToken = await tokens.sign(admin);
    await request(app)
      .delete(`/api/invitations/${invitation.invitationId}`)
      .set("Cookie", `case_session=${adminToken}`)
      .expect(200);
    expect(
      (await store.findInvitationById(invitation.invitationId))?.revokedAt,
    ).not.toBeNull();
  });

  it("lets only an admin hard-revoke a member", async () => {
    const { app, store, tokens } = buildGateway();
    const admin = seedMember(store, "admin");
    const operatorMember = seedMember(store, "operator");
    const victim = store.seedOperator(
      operator({ email: "victim@agency.gov.my", role: "auditor" }),
    );

    const operatorToken = await tokens.sign(operatorMember);
    const denied = await request(app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${operatorToken}`)
      .expect(403);
    expect(denied.body.error).toMatchObject({
      code: "FORBIDDEN",
      details: { requiredRoles: ["admin"], role: "operator" },
    });
    expect(store.operators.has(victim.id)).toBe(true);

    const adminToken = await tokens.sign(admin);
    await request(app)
      .delete(`/api/auth/operators/${victim.id}`)
      .set("Cookie", `case_session=${adminToken}`)
      .expect(200);
    expect(store.operators.has(victim.id)).toBe(false);
  });

  it("answers 401 before 403 when there is no session", async () => {
    const { app, store } = buildGateway();
    const victim = store.seedOperator(
      operator({ email: "victim@agency.gov.my", role: "operator" }),
    );

    await request(app)
      .post("/api/invitations")
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(401);
    await request(app)
      .delete(`/api/auth/operators/${victim.id}`)
      .expect(401);
  });

  it("accepts any configured role in requireRole", async () => {
    function appFor(role: "admin" | "operator" | "auditor") {
      const member = operator({ email: `${role}@agency.gov.my`, role });
      const app = express();
      app.use((req, _res, next) => {
        req.auth = {
          operator: member,
          claims: {
            sub: member.id,
            email: member.email,
            role: member.role,
            workspaceId: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
          },
        } satisfies AuthContext;
        next();
      });
      app.get("/mixed", requireRole(["admin", "auditor"]), (_req, res) => {
        res.json({ ok: true });
      });
      return app;
    }

    await request(appFor("admin")).get("/mixed").expect(200);
    await request(appFor("auditor")).get("/mixed").expect(200);
    await request(appFor("operator")).get("/mixed").expect(403);
  });

  it("uses the live DB role, not a stale role claim in the token", async () => {
    const { app, store, tokens } = buildGateway();
    const member = store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );

    // A token with an escalated claim cannot bypass the live operator row.
    const escalated = await tokens.sign({ ...member, role: "admin" });
    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${escalated}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(403);

    // Promote the member: the very next request sees the new role.
    store.operators.set(member.id, { ...member, role: "admin" });
    const fresh = await tokens.sign({ ...member, role: "operator" });
    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${fresh}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(201);
  });
});
