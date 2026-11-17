import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createSessionTokens, hashEmail, normalizeEmail } from "../../src/auth-gateway/tokens.js";
import { TEST_SECRET, testConfig } from "./helpers.js";

describe("session tokens", () => {
  const config = testConfig();
  const tokens = createSessionTokens(config);
  const member = {
    id: "op-123",
    email: "Aisyah@Agency.Gov.My",
    role: "admin" as const,
  };

  it("round-trips the operator id, email, role and workspace", async () => {
    const token = await tokens.sign(member);
    const claims = await tokens.verify(token);
    expect(claims.sub).toBe(member.id);
    expect(claims.email).toBe(member.email);
    expect(claims.role).toBe("admin");
    expect(claims.workspaceId).toBe(config.workspaceId);
    expect(claims.iss).toBe(config.jwt.issuer);
    expect(claims.aud).toBe(config.jwt.audience);
  });

  it("rejects a token signed with another secret", async () => {
    const other = createSessionTokens(
      testConfig({ AUTH_JWT_SECRET: `${TEST_SECRET}-different` }),
    );
    const token = await other.sign(member);
    await expect(tokens.verify(token)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const key = new TextEncoder().encode(config.jwt.secret);
    const expired = await new SignJWT({
      email: member.email,
      role: member.role,
      workspaceId: config.workspaceId,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(member.id)
      .setIssuer(config.jwt.issuer)
      .setAudience(config.jwt.audience)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(key);
    await expect(tokens.verify(expired)).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED" });
  });

  it("normalises emails and hashes them deterministically without storing raw text", () => {
    expect(normalizeEmail("  Aisyah@Agency.Gov.My ")).toBe("aisyah@agency.gov.my");
    const hash = hashEmail("Aisyah@Agency.Gov.My");
    expect(hash).toBe(hashEmail("aisyah@agency.gov.my"));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("aisyah");
  });
});
