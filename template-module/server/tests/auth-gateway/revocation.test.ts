import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "../../src/auth/operators.js";
import { buildGateway, FakeGoogle, MemoryStore, operator } from "./helpers.js";
import type { TokenVault } from "../../src/auth-gateway/tokenVault.js";

function setCookies(response: request.Response): string[] {
  const raw = response.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const hit = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return hit?.split(";")[0]?.slice(name.length + 1);
}

/** A member with a linked Google account, delegated tokens and a refresh token. */
function seedMemberWithCredentials(
  store: MemoryStore,
  vault: TokenVault,
  options: { revoked?: boolean; role?: Role; email?: string } = {},
) {
  const member = store.seedOperator(
    operator({
      email: options.email ?? "member@agency.gov.my",
      role: options.role ?? "operator",
      revokedAt: options.revoked ? new Date("2026-11-17T09:00:00.000Z") : null,
    }),
  );
  const googleSub = `google-sub-${member.id}`;
  store.accounts.set(googleSub, {
    accountId: `account-${member.id}`,
    operatorId: member.id,
    email: member.email,
  });
  store.googleTokens.set(member.id, {
    accessTokenEnc: vault.seal("member-access-token"),
    refreshTokenEnc: vault.seal("member-refresh-token"),
    expiresAt: new Date("2026-11-17T12:00:00.000Z"),
    scopes: ["openid", "email"],
  });
  store.refresh.set(`refresh-hash-${member.id}`, {
    operatorId: member.id,
    expiresAt: new Date("2026-12-17T12:00:00.000Z"),
    revokedAt: null,
  });
  return { member, googleSub };
}

describe("revocation: credential purge", () => {
  it("purges identity link, delegated tokens and refresh tokens after a successful revoke", async () => {
    const gateway = buildGateway();
    const admin = gateway.store.seedOperator(
      operator({ email: "admin@agency.gov.my", role: "admin" }),
    );
    const session = await gateway.tokens.sign(admin);
    const { member } = seedMemberWithCredentials(gateway.store, gateway.vault);

    const response = await request(gateway.app)
      .delete(`/api/operators/${member.id}`)
      .set("Cookie", `case_session=${session}`)
      .expect(200);

    expect(response.body.proxied).toBe(true);

    await vi.waitFor(() => {
      expect(gateway.store.accounts.size).toBe(0);
      expect(gateway.store.googleTokens.size).toBe(0);
      expect(gateway.store.refresh.size).toBe(0);
    });

    // The operator row survives so history keeps a real identity.
    expect(gateway.store.operators.get(member.id)).toBeDefined();
    expect(gateway.store.operators.get(admin.id)).toBeDefined();
  });

  it("does not purge when the legacy API rejects the revoke", async () => {
    const gateway = buildGateway({ proxyStatus: 409 });
    const admin = gateway.store.seedOperator(
      operator({ email: "admin@agency.gov.my", role: "admin" }),
    );
    const session = await gateway.tokens.sign(admin);
    const { member } = seedMemberWithCredentials(gateway.store, gateway.vault);

    await request(gateway.app)
      .delete(`/api/operators/${member.id}`)
      .set("Cookie", `case_session=${session}`)
      .expect(409);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(gateway.store.accounts.size).toBe(1);
    expect(gateway.store.googleTokens.size).toBe(1);
    expect(gateway.store.refresh.size).toBe(1);
  });

  it("sweeps revocations that happened outside the proxy path", async () => {
    const gateway = buildGateway();
    const { member } = seedMemberWithCredentials(gateway.store, gateway.vault, {
      revoked: true,
    });

    const swept = await gateway.revoker.sweep();

    expect(swept.operators).toContain(member.id);
    expect(swept.accounts).toBe(1);
    expect(swept.refreshTokens).toBe(1);
    expect(gateway.store.accounts.size).toBe(0);
    expect(gateway.store.googleTokens.size).toBe(0);
    expect(gateway.store.operators.get(member.id)?.revokedAt).not.toBeNull();

    // Idempotent: nothing left to do on a second pass.
    const again = await gateway.revoker.sweep();
    expect(again).toEqual({ operators: [], accounts: 0, refreshTokens: 0 });
  });

  it("blocks sign-in after the purge and re-links nothing", async () => {
    const gateway = buildGateway();
    const admin = gateway.store.seedOperator(
      operator({ email: "admin@agency.gov.my", role: "admin" }),
    );
    const { member, googleSub } = seedMemberWithCredentials(gateway.store, gateway.vault, {
      revoked: true,
    });

    await gateway.revoker.purge(member.id);
    expect(gateway.store.accounts.size).toBe(0);

    // The revoked member's Google account tries again.
    const google = new FakeGoogle();
    google.profile = { ...google.profile, sub: googleSub, email: member.email };
    const app = buildGateway({ google, store: gateway.store, audit: gateway.audit }).app;

    const start = await request(app).get("/api/auth/google/start").expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const oauthCookie = cookieValue(setCookies(start), "case_oauth");

    const callback = await request(app)
      .get(`/api/auth/google/callback?code=x&state=${encodeURIComponent(state!)}`)
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    expect(callback.headers.location).toContain("reason=ACCESS_REVOKED");
    const failed = gateway.audit.events.find(
      (event) => event.action === "AUTHENTICATION_FAILED",
    );
    expect(failed?.details?.reason_code).toBe("ACCESS_REVOKED");

    // No identity link was silently recreated, and the operator still exists.
    expect(gateway.store.accounts.size).toBe(0);
    expect(admin.role).toBe("admin");
    expect(gateway.store.operators.get(member.id)?.revokedAt).not.toBeNull();
  });

  it("is idempotent and reports zero counts when there is nothing to purge", async () => {
    const gateway = buildGateway();
    const { member } = seedMemberWithCredentials(gateway.store, gateway.vault, {
      revoked: true,
    });

    const first = await gateway.revoker.purge(member.id);
    const second = await gateway.revoker.purge(member.id);

    expect(first).toEqual({ accounts: 1, refreshTokens: 1 });
    expect(second).toEqual({ accounts: 0, refreshTokens: 0 });
  });
});
