import request from "supertest";
import { describe, expect, it } from "vitest";
import { MailDeliveryError } from "../../src/auth-gateway/mailer.js";
import {
  buildGateway,
  FailingMailer,
  MemoryStore,
  operator,
  testConfig,
} from "./helpers.js";

function setCookies(response: request.Response): string[] {
  const raw = response.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const hit = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  if (!hit) return undefined;
  return hit.split(";")[0]?.slice(name.length + 1);
}

describe("auth gateway middleware", () => {
  it("rejects unauthenticated API requests", async () => {
    const { app } = buildGateway();
    await request(app).get("/api/templates").expect(401);
  });

  it("ignores spoofed identity headers and injects the JWT identity", async () => {
    const { app, store, tokens, proxyRequests, config } = buildGateway();
    const member = store.seedOperator(operator({ email: "member@agency.gov.my", role: "operator" }));
    const token = await tokens.sign(member);

    const response = await request(app)
      .get("/api/templates")
      .set("x-operator-id", "ops-admin")
      .set("x-operator-role", "admin")
      .set("x-mock-role", "ADMIN")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.proxied).toBe(true);
    expect(proxyRequests).toHaveLength(1);
    const forwarded = proxyRequests[0]!.headers;
    expect(forwarded["x-operator-id"]).toBe(member.id);
    expect(forwarded["x-operator-role"]).toBe("operator");
    expect(forwarded["x-mock-user"]).toBe(member.id);
    expect(forwarded["x-mock-role"]).toBe("OPERATOR");
    expect(forwarded["x-mock-workspace"]).toBe(config.workspaceId);
    expect(proxyRequests[0]!.path).toBe("/api/templates");
  });

  it("accepts a bearer token and exposes /api/auth/me", async () => {
    const { app, store, tokens } = buildGateway();
    const admin = store.seedOperator(operator({ email: "admin@agency.gov.my", role: "admin" }));
    const token = await tokens.sign(admin);

    const me = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(me.body.operator.id).toBe(admin.id);
    expect(me.body.workspaceId).toBe("6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b");
    expect(me.body.permissions).toContain("users:manage");
  });

  it("rejects a revoked operator and audits the failure", async () => {
    const { app, store, tokens, audit } = buildGateway();
    const revoked = store.seedOperator(
      operator({
        email: "revoked@agency.gov.my",
        role: "operator",
        revokedAt: new Date("2026-11-01T00:00:00.000Z"),
      }),
    );
    const token = await tokens.sign(revoked);

    await request(app)
      .get("/api/templates")
      .set("Cookie", `case_session=${token}`)
      .expect(403);

    const failed = audit.events.find((event) => event.action === "AUTHENTICATION_FAILED");
    expect(failed?.details?.reason_code).toBe("ACCESS_REVOKED");
    expect(failed?.outcome).toBe("FAILURE");
  });

  it("does not trust legacy identity headers by default", async () => {
    const { app, store, proxyRequests } = buildGateway();
    store.seedOperator(operator({ id: "ops-admin", email: "admin@agency.gov.my", role: "admin" }));

    await request(app)
      .get("/api/templates")
      .set("x-operator-id", "ops-admin")
      .expect(401);
    expect(proxyRequests).toHaveLength(0);
  });

  it("supports the explicit development legacy identity switch", async () => {
    const { app, store, proxyRequests } = buildGateway({
      config: testConfig({ AUTH_ALLOW_LEGACY_IDENTITY: "true" }),
    });
    store.seedOperator(operator({ id: "ops-admin", email: "admin@agency.gov.my", role: "admin" }));

    await request(app)
      .get("/api/templates")
      .set("x-operator-id", "ops-admin")
      .expect(200);
    expect(proxyRequests[0]!.headers["x-operator-id"]).toBe("ops-admin");
  });

  it("blocks cross-origin cookie mutations", async () => {
    const { app, store, tokens } = buildGateway();
    const admin = store.seedOperator(operator({ email: "admin@agency.gov.my", role: "admin" }));
    const token = await tokens.sign(admin);

    await request(app)
      .post("/api/invitations")
      .set("Origin", "https://evil.example")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(403);
  });
});

describe("first-run root admin and Google callback", () => {
  it("bootstraps the first Google user as admin and audits the chain events", async () => {
    const { app, store, audit } = buildGateway();

    const start = await request(app)
      .get("/api/auth/google/start")
      .set("Accept", "application/json")
      .expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const cookies = setCookies(start);
    const oauthCookie = cookieValue(cookies, "case_oauth");
    expect(state).toBeTruthy();
    expect(oauthCookie).toBeTruthy();

    const callback = await request(app)
      .get(`/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(state!)}`)
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    expect(callback.headers.location).toContain("auth=success");
    const sessionCookies = setCookies(callback);
    expect(cookieValue(sessionCookies, "case_session")).toBeTruthy();
    expect(cookieValue(sessionCookies, "case_refresh")).toBeTruthy();

    expect(await store.countOperators()).toBe(1);
    const root = [...store.operators.values()][0]!;
    expect(root.role).toBe("admin");
    expect(root.email).toBe("root@agency.gov.my");

    const actions = audit.events.map((event) => event.action);
    expect(actions).toContain("ROOT_ADMIN_INITIALIZED");
    expect(actions).toContain("AUTHENTICATION_SUCCESS");
    const initialized = audit.events.find((event) => event.action === "ROOT_ADMIN_INITIALIZED");
    expect(initialized?.details).toMatchObject({ role: "admin", bootstrap: true });
  });

  it("rejects a callback whose state does not match the signed cookie", async () => {
    const { app, audit } = buildGateway();
    const start = await request(app).get("/api/auth/google/start").expect(302);
    const oauthCookie = cookieValue(setCookies(start), "case_oauth");

    await request(app)
      .get("/api/auth/google/callback?code=fake&state=wrong")
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    const failed = audit.events.find((event) => event.action === "AUTHENTICATION_FAILED");
    expect(failed?.details?.reason_code).toBe("OAUTH_STATE_INVALID");
  });

  it("refuses an uninvited Google account when the workspace is not empty", async () => {
    const store = new MemoryStore();
    store.seedOperator(operator({ email: "admin@agency.gov.my", role: "admin" }));
    const { app, audit } = buildGateway({ store });

    const start = await request(app).get("/api/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const oauthCookie = cookieValue(setCookies(start), "case_oauth");

    const callback = await request(app)
      .get(`/api/auth/google/callback?code=fake&state=${encodeURIComponent(state!)}`)
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    expect(callback.headers.location).toContain("reason=INVITATION_REQUIRED");
    const failed = audit.events.find((event) => event.action === "AUTHENTICATION_FAILED");
    expect(failed?.details?.reason_code).toBe("INVITATION_REQUIRED");
  });
});

describe("invitations", () => {
  async function adminToken(store: MemoryStore, tokens: ReturnType<typeof buildGateway>["tokens"]) {
    const admin = store.seedOperator(operator({ email: "admin@agency.gov.my", role: "admin" }));
    return tokens.sign(admin);
  }

  it("is admin-only and never returns the raw token", async () => {
    const { app, store, tokens, mailer, audit } = buildGateway();
    const token = await adminToken(store, tokens);

    const response = await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(201);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("new@agency.gov.my");
    expect(mailer.sent[0]!.magicLink).toContain("/api/invitations/accept?token=");
    expect(JSON.stringify(response.body)).not.toContain("token=");
    expect(response.body.delivery).toBe("SENT");
    expect(response.body.channel).toBe("SMTP");
    expect(response.body.invitation.status).toBe("PENDING");

    const expiresAt = new Date(response.body.invitation.expiresAt);
    const createdAt = new Date(response.body.invitation.createdAt);
    expect(expiresAt.getTime() - createdAt.getTime()).toBe(120 * 60 * 1000);

    const invited = audit.events.find((event) => event.action === "OPERATOR_INVITED");
    expect(invited?.details?.delivery).toBe("SENT");
    expect(invited?.details?.channel).toBe("SMTP");
    expect(String(invited?.details?.email_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(invited?.details)).not.toContain("new@agency.gov.my");
  });

  it("survives an SMTP failure: 502, revoked invite, FAILED audit, server alive", async () => {
    const { app, store, tokens, audit } = buildGateway({
      mailer: new FailingMailer(
        new MailDeliveryError("SMTP_AUTH_FAILED", "bad credentials", "EAUTH: Invalid login"),
      ),
    });
    const token = await adminToken(store, tokens);

    const response = await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(502);

    expect(response.body.error.code).toBe("INVITATION_EMAIL_AUTH_FAILED");
    // The message points at the real fix without exposing the password.
    expect(response.body.error.message).toContain("App Password");
    expect(JSON.stringify(response.body)).not.toContain("bad credentials");

    // A link nobody received must not remain redeemable.
    const [invitation] = await store.listInvitations();
    expect(invitation?.revokedAt).not.toBeNull();

    const invited = audit.events.find((event) => event.action === "OPERATOR_INVITED");
    expect(invited?.outcome).toBe("FAILURE");
    expect(invited?.details).toMatchObject({ delivery: "FAILED", channel: "SMTP" });

    // Delivery failure is an invitation error, not a process crash.
    await request(app).get("/api/health").expect(200);
  });

  it("rejects non-admin members", async () => {
    const { app, store, tokens } = buildGateway();
    const member = store.seedOperator(operator({ email: "member@agency.gov.my", role: "operator" }));
    const token = await tokens.sign(member);

    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "new@agency.gov.my", role: "operator" })
      .expect(403);
  });

  it("accepts the magic link once and redirects into Google sign-in", async () => {
    const { app, store, tokens, mailer, audit } = buildGateway();
    const token = await adminToken(store, tokens);
    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "invitee@agency.gov.my", role: "auditor" })
      .expect(201);

    const magic = new URL(mailer.sent[0]!.magicLink);
    const rawToken = magic.searchParams.get("token")!;

    const accepted = await request(app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(rawToken)}`)
      .expect(303);
    expect(accepted.headers.location).toContain("/api/auth/google/start");

    const invitee = await store.findOperatorByEmail("invitee@agency.gov.my");
    expect(invitee?.role).toBe("auditor");
    const acceptedEvent = audit.events.find((event) => event.action === "INVITATION_ACCEPTED");
    expect(acceptedEvent?.details?.operator_id).toBe(invitee?.id);

    await request(app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(rawToken)}`)
      .expect(409);
  });

  it("rejects an expired token", async () => {
    const { app, store, tokens, mailer } = buildGateway();
    const token = await adminToken(store, tokens);
    await request(app)
      .post("/api/invitations")
      .set("Cookie", `case_session=${token}`)
      .send({ email: "late@agency.gov.my", role: "operator" })
      .expect(201);

    // The fake clock is fixed; rewrite the stored expiry to the past.
    const stored = [...store.invitations.values()][0]!;
    stored.record.expiresAt = new Date("2026-11-17T09:00:00.000Z");

    const rawToken = new URL(mailer.sent[0]!.magicLink).searchParams.get("token")!;
    await request(app)
      .get(`/api/invitations/accept?token=${encodeURIComponent(rawToken)}`)
      .expect(410);
  });
});

describe("refresh rotation", () => {
  it("rotates the refresh cookie and detects replay", async () => {
    const { app, tokens } = buildGateway();
    const start = await request(app).get("/api/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const oauthCookie = cookieValue(setCookies(start), "case_oauth");
    const callback = await request(app)
      .get(`/api/auth/google/callback?code=fake&state=${encodeURIComponent(state!)}`)
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    const refresh = cookieValue(setCookies(callback), "case_refresh")!;
    const refreshed = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `case_refresh=${refresh}`)
      .expect(200);
    const rotated = cookieValue(setCookies(refreshed), "case_refresh");
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(refresh);

    // A refresh mints a new access token from the operator row, including role.
    const access = cookieValue(setCookies(refreshed), "case_session")!;
    const claims = await tokens.verify(access);
    expect(claims.role).toBe("admin");

    await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", `case_refresh=${refresh}`)
      .expect(401);
  });
});
