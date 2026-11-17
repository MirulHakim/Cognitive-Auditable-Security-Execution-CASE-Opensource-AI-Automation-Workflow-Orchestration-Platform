import request from "supertest";
import { describe, expect, it } from "vitest";
import { buildGateway, operator, type MemoryStore } from "./helpers.js";

async function memberGateway(withAccount = true) {
  const gateway = buildGateway();
  const member = gateway.store.seedOperator(
    operator({
      email: "member@agency.gov.my",
      role: "operator",
      displayName: "Member Name",
    }),
  );
  if (withAccount) {
    gateway.store.accounts.set("google-sub-member", {
      accountId: "account-member",
      operatorId: member.id,
      email: member.email,
    });
  }
  const token = await gateway.tokens.sign(member);
  return { gateway, member, token };
}

function seed(store: MemoryStore) {
  return store.seedOperator(
    operator({ email: "member2@agency.gov.my", role: "operator" }),
  );
}

describe("member profile", () => {
  it("returns the signed-in member's editable profile", async () => {
    const { gateway, member, token } = await memberGateway();

    const response = await request(gateway.app)
      .get("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(response.body.profile).toEqual({
      id: member.id,
      displayName: "Member Name",
      email: member.email,
      role: "operator",
      contactNumber: null,
      themePreference: null,
    });
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("saves display name and contact number, and can clear the number", async () => {
    const { gateway, member, token } = await memberGateway();

    const updated = await request(gateway.app)
      .patch("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .send({ displayName: "  Farid Hakim  ", contactNumber: "+60 12-345 6789" })
      .expect(200);

    expect(updated.body.profile).toMatchObject({
      id: member.id,
      displayName: "Farid Hakim",
      contactNumber: "+60 12-345 6789",
    });
    expect(gateway.store.operators.get(member.id)?.displayName).toBe(
      "Farid Hakim",
    );

    const cleared = await request(gateway.app)
      .patch("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .send({ contactNumber: "   " })
      .expect(200);
    expect(cleared.body.profile.contactNumber).toBeNull();

    const reread = await request(gateway.app)
      .get("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
    expect(reread.body.profile).toMatchObject({
      displayName: "Farid Hakim",
      contactNumber: null,
    });
  });

  it("rejects invalid input and attempts to address another member", async () => {
    const { gateway, member, token } = await memberGateway();
    const other = seed(gateway.store);

    for (const body of [
      { displayName: "A" },
      { contactNumber: "call me maybe" },
      { contactNumber: "+".repeat(41) },
      {},
    ]) {
      const response = await request(gateway.app)
        .patch("/api/users/me")
        .set("Cookie", `case_session=${token}`)
        .send(body)
        .expect(400);
      expect(["INVALID_PROFILE", "INVALID_CONTACT_NUMBER"]).toContain(
        response.body.error.code,
      );
    }

    // The schema is strict: another id cannot be smuggled into the update.
    await request(gateway.app)
      .patch("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .send({ id: other.id, displayName: "Hijacked" })
      .expect(400);

    expect(gateway.store.operators.get(member.id)?.displayName).toBe(
      "Member Name",
    );
    expect(gateway.store.operators.get(other.id)?.displayName).not.toBe(
      "Hijacked",
    );
  });

  it("persists the theme on the account and reports when there is no account", async () => {
    const { gateway, token } = await memberGateway();

    const saved = await request(gateway.app)
      .patch("/api/users/me/preferences")
      .set("Cookie", `case_session=${token}`)
      .send({ theme: "dark" })
      .expect(200);
    expect(saved.body).toEqual({ themePreference: "dark", persisted: true });

    const reread = await request(gateway.app)
      .get("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
    expect(reread.body.profile.themePreference).toBe("dark");

    await request(gateway.app)
      .patch("/api/users/me/preferences")
      .set("Cookie", `case_session=${token}`)
      .send({ theme: "neon" })
      .expect(400);

    // A dev identity without a Google link has nowhere to store the choice yet;
    // the response says so instead of failing the theme switch.
    const { gateway: noAccount, member: legacy, token: legacyToken } =
      await memberGateway(false);
    const unpersisted = await request(noAccount.app)
      .patch("/api/users/me/preferences")
      .set("Cookie", `case_session=${legacyToken}`)
      .send({ theme: "light" })
      .expect(200);
    expect(unpersisted.body).toEqual({
      themePreference: "light",
      persisted: false,
    });
    expect(
      (await noAccount.store.findProfile(legacy.id))?.themePreference,
    ).toBeNull();
  });

  it("requires an authenticated session for every profile route", async () => {
    const { gateway, member, token } = await memberGateway();

    await request(gateway.app).get("/api/users/me").expect(401);
    await request(gateway.app)
      .patch("/api/users/me")
      .send({ displayName: "No Session" })
      .expect(401);
    await request(gateway.app)
      .patch("/api/users/me/preferences")
      .send({ theme: "dark" })
      .expect(401);

    expect(gateway.store.operators.get(member.id)?.displayName).toBe(
      "Member Name",
    );
    expect(gateway.store.themes.has(member.id)).toBe(false);

    // Sanity: the same session is accepted, so the 401s above are about auth.
    await request(gateway.app)
      .get("/api/users/me")
      .set("Cookie", `case_session=${token}`)
      .expect(200);
  });
});
