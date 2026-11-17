import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  createSecretVault,
  decodeVaultMasterKey,
  vaultAad,
} from "../../src/auth-gateway/vault.js";
import { buildGateway, operator, testConfig } from "./helpers.js";

const MASTER_KEY = "test-vault-master-key-32-bytes!!";
const INTERNAL_KEY = "test-internal-vault-key-0123456789abcdef";
const TELEGRAM_TOKEN = "123456789:AAH-secret-telegram-bot-token";

describe("vault cryptography", () => {
  it("round-trips with AES-256-GCM and a fresh IV every time", () => {
    const vault = createSecretVault(MASTER_KEY);
    const first = vault.encrypt(TELEGRAM_TOKEN, vaultAad("op-1", "telegram"));
    const second = vault.encrypt(TELEGRAM_TOKEN, vaultAad("op-1", "telegram"));

    expect(first.iv).not.toBe(second.iv);
    expect(first.cipherText).not.toContain(TELEGRAM_TOKEN);
    expect(vault.decrypt(first, vaultAad("op-1", "telegram"))).toBe(
      TELEGRAM_TOKEN,
    );
  });

  it("rejects tampered ciphertext, IV and auth tag", () => {
    const vault = createSecretVault(MASTER_KEY);
    const sealed = vault.encrypt("gmail-app-password", vaultAad("op-1", "gmail"));

    expect(() =>
      vault.decrypt({ ...sealed, cipherText: `A${sealed.cipherText.slice(1)}` }, vaultAad("op-1", "gmail")),
    ).toThrow();
    expect(() => vault.decrypt({ ...sealed, iv: "AAAAAAAAAAAAAAAA" }, vaultAad("op-1", "gmail"))).toThrow();
    expect(() =>
      vault.decrypt({ ...sealed, authTag: "AAAAAAAAAAAAAAAAAAAAAA==" }, vaultAad("op-1", "gmail")),
    ).toThrow();
  });

  it("binds a ciphertext to its operator and provider", () => {
    const vault = createSecretVault(MASTER_KEY);
    const sealed = vault.encrypt("token", vaultAad("op-1", "telegram"));

    // Same key, same payload, different AAD: a row copied to another operator
    // (or provider) must not open.
    expect(() => vault.decrypt(sealed, vaultAad("op-2", "telegram"))).toThrow();
    expect(() => vault.decrypt(sealed, vaultAad("op-1", "gmail"))).toThrow();
  });

  it("requires a key that decodes to exactly 32 bytes", () => {
    expect(decodeVaultMasterKey(MASTER_KEY)).toHaveLength(32);
    expect(decodeVaultMasterKey("00".repeat(32))).toHaveLength(32);
    expect(() => decodeVaultMasterKey("too-short")).toThrow(/32 bytes/);
    expect(() => decodeVaultMasterKey("")).toThrow(/required/);
    expect(() => createSecretVault("another-short-key")).toThrow(/32 bytes/);
  });
});

describe("vault API", () => {
  async function sessionFor(
    gateway: ReturnType<typeof buildGateway>,
    email = "member@agency.gov.my",
    role: "admin" | "operator" | "auditor" = "operator",
  ) {
    const member = gateway.store.seedOperator(operator({ email, role }));
    return { member, token: await gateway.tokens.sign(member) };
  }

  it("requires a session and starts disconnected", async () => {
    const gateway = buildGateway();
    await request(gateway.app).get("/api/auth/vault").expect(401);

    const { token } = await sessionFor(gateway);
    const response = await request(gateway.app)
      .get("/api/auth/vault")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body).toEqual({ telegram: false, gmail: false });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("seals a pasted token and returns status only, never the secret", async () => {
    const gateway = buildGateway();
    const { member, token } = await sessionFor(gateway);

    const connected = await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: TELEGRAM_TOKEN })
      .expect(200);

    expect(connected.body).toMatchObject({ provider: "telegram", connected: true });
    expect(JSON.stringify(connected.body)).not.toContain(TELEGRAM_TOKEN);

    const stored = gateway.store.vaultSecrets.get(`${member.id}:telegram`);
    expect(stored).toBeDefined();
    expect(stored!.cipherText).not.toContain(TELEGRAM_TOKEN);
    expect(stored!.operatorId).toBe(member.id);

    const status = await request(gateway.app)
      .get("/api/auth/vault")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
    expect(status.body).toEqual({ telegram: true, gmail: false });
    const serialized = JSON.stringify(status.body);
    expect(serialized).not.toContain(TELEGRAM_TOKEN);
    expect(serialized).not.toContain(stored!.cipherText);
    expect(serialized).not.toContain(stored!.authTag);
  });

  it("rotates in place: one active secret per provider", async () => {
    const gateway = buildGateway();
    const { member, token } = await sessionFor(gateway);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: "first-token" })
      .expect(200);
    const first = gateway.store.vaultSecrets.get(`${member.id}:telegram`);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: "second-token" })
      .expect(200);
    const second = gateway.store.vaultSecrets.get(`${member.id}:telegram`);

    expect(gateway.store.vaultSecrets.size).toBe(1);
    expect(second!.cipherText).not.toBe(first!.cipherText);
    expect(second!.iv).not.toBe(first!.iv);
  });

  it("scopes reads and writes to the signed-in operator", async () => {
    const gateway = buildGateway();
    const alice = await sessionFor(gateway, "alice@agency.gov.my");
    const bob = await sessionFor(gateway, "bob@agency.gov.my");

    await request(gateway.app)
      .post("/api/auth/vault/gmail")
      .set("Cookie", `case_session=${alice.token}`)
      .send({ token: "alice-app-password" })
      .expect(200);

    const bobStatus = await request(gateway.app)
      .get("/api/auth/vault")
      .set("Cookie", `case_session=${bob.token}`)
      .expect(200);
    expect(bobStatus.body).toEqual({ telegram: false, gmail: false });

    const internal = await request(gateway.app)
      .get(`/api/internal/vault/${bob.member.id}/gmail`)
      .set("x-internal-api-key", INTERNAL_KEY)
      .expect(404);
    expect(internal.body.error.code).toBe("VAULT_SECRET_NOT_FOUND");
  });

  it("disconnects and stays idempotent", async () => {
    const gateway = buildGateway();
    const { member, token } = await sessionFor(gateway);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: TELEGRAM_TOKEN })
      .expect(200);

    const removed = await request(gateway.app)
      .delete("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
    expect(removed.body).toEqual({ provider: "telegram", connected: false, deleted: true });
    expect(gateway.store.vaultSecrets.has(`${member.id}:telegram`)).toBe(false);

    const again = await request(gateway.app)
      .delete("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
    expect(again.body.deleted).toBe(false);
  });

  it("rejects unsupported providers and malformed bodies", async () => {
    const gateway = buildGateway();
    const { token } = await sessionFor(gateway);

    await request(gateway.app)
      .post("/api/auth/vault/slack")
      .set("Cookie", `case_session=${token}`)
      .send({ token: "x" })
      .expect(400);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ secret: "wrong-field" })
      .expect(400);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: "   " })
      .expect(400);
  });

  it("blocks cross-origin writes", async () => {
    const gateway = buildGateway();
    const { token } = await sessionFor(gateway);

    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .set("Origin", "https://evil.example")
      .send({ token: TELEGRAM_TOKEN })
      .expect(403);
  });
});

describe("internal vault decryption", () => {
  async function connectedGateway() {
    const gateway = buildGateway();
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );
    const token = await gateway.tokens.sign(member);
    await request(gateway.app)
      .post("/api/auth/vault/telegram")
      .set("Cookie", `case_session=${token}`)
      .send({ token: TELEGRAM_TOKEN })
      .expect(200);
    return { gateway, member, token };
  }

  it("returns the plaintext only with the pre-shared internal key", async () => {
    const { gateway, member, token } = await connectedGateway();

    // A browser session is not enough.
    await request(gateway.app)
      .get(`/api/internal/vault/${member.id}/telegram`)
      .set("Cookie", `case_session=${token}`)
      .expect(401);

    await request(gateway.app)
      .get(`/api/internal/vault/${member.id}/telegram`)
      .set("x-internal-api-key", "wrong-key-that-is-also-long-enough")
      .expect(401);

    const response = await request(gateway.app)
      .get(`/api/internal/vault/${member.id}/telegram`)
      .set("x-internal-api-key", INTERNAL_KEY)
      .expect(200);

    expect(response.body).toMatchObject({
      operatorId: member.id,
      provider: "telegram",
      secret: TELEGRAM_TOKEN,
    });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("is disabled entirely when no internal key is configured", async () => {
    const gateway = buildGateway({
      config: testConfig({ VAULT_INTERNAL_API_KEY: "" }),
    });
    const member = gateway.store.seedOperator(
      operator({ email: "member@agency.gov.my" }),
    );

    const response = await request(gateway.app)
      .get(`/api/internal/vault/${member.id}/telegram`)
      .set("x-internal-api-key", INTERNAL_KEY)
      .expect(503);
    expect(response.body.error.code).toBe("INTERNAL_VAULT_DISABLED");
  });

  it("purges sealed secrets when credentials are revoked", async () => {
    const { gateway, member } = await connectedGateway();
    expect(gateway.store.vaultSecrets.has(`${member.id}:telegram`)).toBe(true);

    await gateway.revoker.purge(member.id);

    expect(gateway.store.vaultSecrets.has(`${member.id}:telegram`)).toBe(false);
  });
});
