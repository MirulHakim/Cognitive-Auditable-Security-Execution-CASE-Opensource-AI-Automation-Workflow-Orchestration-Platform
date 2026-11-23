import request from "supertest";
import { describe, expect, it } from "vitest";
import { createGoogleOAuth } from "../../src/auth-gateway/google.js";
import { buildGateway, testConfig, TEST_SECRET } from "./helpers.js";

function setCookies(response: request.Response): string[] {
  const raw = response.headers["set-cookie"];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw as string];
}

function cookieValue(cookies: string[], name: string): string | undefined {
  const hit = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return hit?.split(";")[0]?.slice(name.length + 1);
}

describe("Google OAuth consent", () => {
  it("asks for identity only: no gmail.send and no forced offline consent", () => {
    const url = new URL(
      createGoogleOAuth(testConfig()).authorizationUrl({ state: "s", nonce: "n" }),
    );

    const scope = url.searchParams.get("scope") ?? "";
    expect(scope).toContain("openid");
    expect(scope).toContain("email");
    expect(scope).toContain("profile");
    // Invitations go out from the CASE SMTP account, not the admin's mailbox.
    expect(scope).not.toContain("gmail");
    expect(url.searchParams.get("access_type")).toBeNull();
    expect(url.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("Google token storage", () => {
  it("seals the tokens from sign-in instead of storing them readable", async () => {
    const { app, store, credentials } = buildGateway();

    const start = await request(app)
      .get("/api/auth/google/start")
      .set("Accept", "application/json")
      .expect(302);
    const state = new URL(start.headers.location as string).searchParams.get("state");
    const oauthCookie = cookieValue(setCookies(start), "case_oauth");

    await request(app)
      .get(`/api/auth/google/callback?code=fake-code&state=${encodeURIComponent(state!)}`)
      .set("Cookie", `case_oauth=${oauthCookie}`)
      .expect(303);

    const root = [...store.operators.values()][0]!;
    expect(root.role).toBe("admin");

    const stored = store.googleTokens.get(root.id);
    expect(stored).toBeDefined();
    expect(stored!.accessTokenEnc).toMatch(/^v1\./);
    expect(stored!.refreshTokenEnc).toMatch(/^v1\./);
    // The raw tokens must not be recoverable from the stored columns.
    expect(stored!.accessTokenEnc).not.toContain("fake-google-access-token");
    expect(stored!.refreshTokenEnc).not.toContain("fake-google-refresh-token");

    const loaded = await credentials.load(root.id);
    expect(loaded?.accessToken).toBe("fake-google-access-token");
    expect(loaded?.refreshToken).toBe("fake-google-refresh-token");
    expect(loaded?.scopes).toContain("openid");
  });
});

describe("Google token vault", () => {
  it("round-trips a token and rejects tampering", () => {
    const { vault } = buildGateway();
    const sealed = vault.seal("secret-token");

    expect(sealed).toMatch(/^v1\./);
    expect(vault.open(sealed)).toBe("secret-token");

    const parts = sealed.split(".");
    // Flip a real ciphertext character: GCM's tag must reject it. (Appending
    // padding-less base64 junk would decode to the same bytes, so a byte-level
    // change is the honest test.)
    const ciphertext = parts[3]!;
    const flipped = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    expect(() => vault.open([parts[0], parts[1], parts[2], flipped].join("."))).toThrow();

    const tag = parts[2]!;
    const flippedTag = `${tag[0] === "A" ? "B" : "A"}${tag.slice(1)}`;
    expect(() => vault.open([parts[0], parts[1], flippedTag, ciphertext].join("."))).toThrow();
  });

  it("derives a different key from different material", async () => {
    const { createTokenVault } = await import("../../src/auth-gateway/tokenVault.js");
    const sealed = createTokenVault(TEST_SECRET).seal("value");
    expect(() => createTokenVault("a-completely-different-secret").open(sealed)).toThrow();
  });
});
