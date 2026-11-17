import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/auth-gateway/tokens.js";
import { buildGateway, operator } from "./helpers.js";

const NOW = new Date("2026-11-17T10:00:00.000Z");

describe("presence: heartbeat", () => {
  it("marks the caller online and writes no audit event", async () => {
    const gateway = buildGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );
    const token = await gateway.tokens.sign(member);

    const response = await request(gateway.app)
      .post("/api/auth/heartbeat")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body).toEqual({
      online: true,
      lastSeenAt: NOW.toISOString(),
      heartbeatEverySeconds: 60,
      offlineAfterSeconds: 120,
    });
    expect(gateway.store.presence.get(member.id)).toEqual({
      lastSeenAt: NOW,
      isOnline: true,
    });
    // Heartbeats must never reach the hash chain.
    expect(gateway.audit.events).toHaveLength(0);
  });

  it("requires authentication", async () => {
    const gateway = buildGateway();
    await request(gateway.app).post("/api/auth/heartbeat").expect(401);
    await request(gateway.app).get("/api/auth/presence").expect(401);
  });
});

describe("presence: snapshot", () => {
  it("derives online from last_seen_at and excludes revoked members", async () => {
    const gateway = buildGateway();
    const caller = gateway.store.seedOperator(
      operator({ email: "root@agency.gov.my", role: "admin", displayName: "Root" }),
    );
    const active = gateway.store.seedOperator(
      operator({ email: "active@agency.gov.my", displayName: "Ana Active" }),
    );
    const stale = gateway.store.seedOperator(
      operator({ email: "stale@agency.gov.my", displayName: "Bob Stale" }),
    );
    const never = gateway.store.seedOperator(
      operator({ email: "never@agency.gov.my", displayName: "Cleo Never" }),
    );
    const revoked = gateway.store.seedOperator(
      operator({ email: "revoked@agency.gov.my", displayName: "Dan Revoked", revokedAt: NOW }),
    );

    // 30 s ago → online; 5 min ago → offline even though is_online is still true,
    // which is the whole point of deriving from the timestamp.
    await gateway.store.touchPresence(active.id, new Date(NOW.getTime() - 30_000));
    await gateway.store.touchPresence(stale.id, new Date(NOW.getTime() - 5 * 60_000));

    const token = await gateway.tokens.sign(caller);
    const response = await request(gateway.app)
      .get("/api/auth/presence")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.generatedAt).toBe(NOW.toISOString());
    expect(response.body.offlineAfterSeconds).toBe(120);

    const members = response.body.members as Array<{
      operatorId: string;
      online: boolean;
      isOnline: boolean;
      lastSeenAt: string | null;
      lastSeenSecondsAgo: number | null;
    }>;
    const byId = new Map(members.map((entry) => [entry.operatorId, entry]));

    expect(byId.get(active.id)).toMatchObject({
      online: true,
      isOnline: true,
      lastSeenSecondsAgo: 30,
    });
    expect(byId.get(stale.id)).toMatchObject({
      online: false,
      isOnline: true,
      lastSeenSecondsAgo: 300,
    });
    expect(byId.get(never.id)).toMatchObject({
      online: false,
      lastSeenAt: null,
      lastSeenSecondsAgo: null,
    });
    expect(byId.has(revoked.id)).toBe(false);
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });

  it("refreshes last_seen_at from ordinary authenticated requests", async () => {
    const gateway = buildGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my" }),
    );
    const token = await gateway.tokens.sign(member);

    await request(gateway.app)
      .get("/api/auth/me")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    // The write is fire-and-forget so it cannot delay the response.
    await vi.waitFor(() => {
      expect(gateway.store.presence.get(member.id)?.lastSeenAt).toEqual(NOW);
    });
    expect(gateway.store.presence.get(member.id)?.isOnline).toBe(true);
    expect(gateway.audit.events).toHaveLength(0);
  });
});

describe("presence: logout", () => {
  it("marks offline immediately, keeps last_seen_at and audits the logout only", async () => {
    const gateway = buildGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my" }),
    );
    const seenAt = new Date(NOW.getTime() - 10_000);
    await gateway.store.createRefreshToken({
      tokenHash: sha256Hex("raw-refresh-token"),
      operatorId: member.id,
      expiresAt: new Date("2026-12-17T10:00:00.000Z"),
    });
    await gateway.store.touchPresence(member.id, seenAt);

    await request(gateway.app)
      .post("/api/auth/logout")
      .set("Cookie", "case_refresh=raw-refresh-token")
      .expect(204);

    // Offline at once, without pretending they were seen later.
    expect(gateway.store.presence.get(member.id)).toEqual({
      lastSeenAt: seenAt,
      isOnline: false,
    });

    // The snapshot must agree immediately: `online` combines the timestamp with
    // the explicit flag, otherwise a member who just signed out stays green for
    // the full two-minute window (the bug this guards against).
    const viewer = gateway.store.seedOperator(
      operator({ email: "root@agency.gov.my", role: "admin" }),
    );
    const viewerToken = await gateway.tokens.sign(viewer);
    const snapshot = await request(gateway.app)
      .get("/api/auth/presence")
      .set("Cookie", `case_session=${viewerToken}`)
      .expect(200);
    const entry = (
      snapshot.body.members as Array<{ operatorId: string; online: boolean }>
    ).find((row) => row.operatorId === member.id);
    expect(entry?.online).toBe(false);

    expect(gateway.audit.events).toHaveLength(1);
    expect(gateway.audit.events[0]).toMatchObject({
      action: "AUTHENTICATION_LOGOUT",
      actorId: member.id,
      actorRole: "operator",
      outcome: "SUCCESS",
      details: {
        operator_id: member.id,
        session_revoked: true,
        workspace_id: gateway.config.workspaceId,
      },
    });
  });

  it("does not audit a logout that had no live session", async () => {
    const gateway = buildGateway();
    await request(gateway.app)
      .post("/api/auth/logout")
      .set("Cookie", "case_refresh=unknown-token")
      .expect(204);
    expect(gateway.audit.events).toHaveLength(0);
  });
});
