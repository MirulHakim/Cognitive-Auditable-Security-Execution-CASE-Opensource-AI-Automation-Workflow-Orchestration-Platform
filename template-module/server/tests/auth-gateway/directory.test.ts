import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildGateway, operator, testConfig } from "./helpers.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");

function legacyDirectory(operators: unknown[]): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ operators, count: operators.length }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
}

const LEGACY_MEMBERS = [
  {
    id: "op-admin",
    displayName: "Root Admin",
    email: "root@agency.gov.my",
    role: "admin",
    revokedAt: null,
  },
  {
    id: "op-existing",
    displayName: "Existing Member",
    email: "existing@agency.gov.my",
    role: "operator",
    revokedAt: null,
  },
];

describe("unified member directory", () => {
  it("merges pending invitations with legacy members for an admin", async () => {
    let forwardedIdentity: unknown;
    let forwardedUrl: string | undefined;
    const config = testConfig({ LEGACY_NODE_API_URL: "http://legacy.test" });
    const { app, store, tokens } = buildGateway({
      config,
      now: () => NOW,
      directoryFetch: async (input, init) => {
        forwardedUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        forwardedIdentity = (init?.headers as Record<string, string> | undefined)?.[
          "x-operator-id"
        ];
        return new Response(JSON.stringify({ operators: LEGACY_MEMBERS }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });
    const admin = store.seedOperator(
      operator({ id: "op-admin", email: "root@agency.gov.my", role: "admin" }),
    );
    const token = await tokens.sign(admin);

    await store.createInvitation({
      email: "new.person@agency.gov.my",
      role: "operator",
      invitedBy: admin.id,
      workspaceId: config.workspaceId,
      tokenHash: "hash-new-person",
      createdAt: new Date("2026-11-17T09:30:00.000Z"),
      expiresAt: new Date("2026-11-17T11:30:00.000Z"),
    });

    const response = await request(app)
      .get("/api/operators")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    // The legacy read authenticates as the signed-in admin, never the browser.
    expect(forwardedUrl).toBe("http://legacy.test/api/operators");
    expect(forwardedIdentity).toBe(admin.id);
    expect(response.body.count).toBe(3);
    expect(response.body.pendingCount).toBe(1);

    const pending = response.body.operators[0];
    expect(pending).toMatchObject({
      id: "invitation:".concat(response.body.operators[0].invitationId),
      displayName: "New Person",
      email: "new.person@agency.gov.my",
      role: "operator",
      status: "pending",
      isPending: true,
      revokedAt: null,
      expiresAt: "2026-11-17T11:30:00.000Z",
      invitedAt: "2026-11-17T09:30:00.000Z",
    });

    // Legacy rows keep every existing field and gain an explicit status.
    expect(response.body.operators.slice(1)).toEqual([
      { ...LEGACY_MEMBERS[0], status: "active", isPending: false },
      { ...LEGACY_MEMBERS[1], status: "active", isPending: false },
    ]);
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("hides invitee addresses from non-admin members", async () => {
    const config = testConfig({ LEGACY_NODE_API_URL: "http://legacy.test" });
    const { app, store, tokens } = buildGateway({
      config,
      now: () => NOW,
      directoryFetch: legacyDirectory(LEGACY_MEMBERS),
    });
    const member = store.seedOperator(
      operator({ id: "op-existing", email: "existing@agency.gov.my", role: "operator" }),
    );
    const token = await tokens.sign(member);

    await store.createInvitation({
      email: "secret.invitee@agency.gov.my",
      role: "auditor",
      invitedBy: "op-admin",
      workspaceId: config.workspaceId,
      tokenHash: "hash-secret",
      createdAt: new Date("2026-11-17T09:30:00.000Z"),
      expiresAt: new Date("2026-11-17T11:30:00.000Z"),
    });

    const response = await request(app)
      .get("/api/operators")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.pendingCount).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain("secret.invitee");
    expect(response.body.operators).toHaveLength(2);
  });

  it("drops expired and revoked invitations from the pending list", async () => {
    const config = testConfig({ LEGACY_NODE_API_URL: "http://legacy.test" });
    const { app, store, tokens } = buildGateway({
      config,
      now: () => NOW,
      directoryFetch: legacyDirectory(LEGACY_MEMBERS),
    });
    const admin = store.seedOperator(
      operator({ id: "op-admin", email: "root@agency.gov.my", role: "admin" }),
    );
    const token = await tokens.sign(admin);

    await store.createInvitation({
      email: "expired@agency.gov.my",
      role: "operator",
      invitedBy: admin.id,
      workspaceId: config.workspaceId,
      tokenHash: "hash-expired",
      createdAt: new Date("2026-11-17T07:00:00.000Z"),
      expiresAt: new Date("2026-11-17T09:00:00.000Z"),
    });
    const revoked = await store.createInvitation({
      email: "withdrawn@agency.gov.my",
      role: "operator",
      invitedBy: admin.id,
      workspaceId: config.workspaceId,
      tokenHash: "hash-revoked",
      createdAt: new Date("2026-11-17T09:00:00.000Z"),
      expiresAt: new Date("2026-11-17T11:00:00.000Z"),
    });
    await store.revokeInvitation(revoked.invitationId);

    const response = await request(app)
      .get("/api/operators")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.pendingCount).toBe(0);
    expect(JSON.stringify(response.body)).not.toContain("expired@agency.gov.my");
    expect(JSON.stringify(response.body)).not.toContain("withdrawn@agency.gov.my");
  });

  it("returns 502 when the legacy directory is unavailable", async () => {
    const config = testConfig({ LEGACY_NODE_API_URL: "http://legacy.test" });
    const { app, store, tokens } = buildGateway({
      config,
      directoryFetch: async () => new Response("down", { status: 503 }),
    });
    const admin = store.seedOperator(
      operator({ id: "op-admin", email: "root@agency.gov.my", role: "admin" }),
    );
    const token = await tokens.sign(admin);

    const response = await request(app)
      .get("/api/operators")
      .set("Cookie", `case_session=${token}`)
      .expect(502);

    expect(response.body.error.code).toBe("DIRECTORY_UNAVAILABLE");
  });
});
