import { createServer, type Server } from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuthGatewayApp } from "../../src/auth-gateway/app.js";
import { createOAuthStateService, createSessionTokens } from "../../src/auth-gateway/tokens.js";
import {
  FakeGoogle,
  MemoryAudit,
  MemoryMailer,
  MemoryStore,
  operator,
  testConfig,
} from "./helpers.js";

interface SeenRequest {
  url: string;
  headers: Record<string, string | string[] | undefined>;
}

function listen(handler: (req: SeenRequest) => unknown): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          upstream: handler({ url: req.url ?? "", headers: req.headers }),
        }),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

describe("reverse proxy routing", () => {
  let nodeServer: Server;
  let fastapiServer: Server;
  let nodeSeen: SeenRequest[] = [];
  let fastapiSeen: SeenRequest[] = [];
  let app: ReturnType<typeof createAuthGatewayApp>;
  let token = "";
  let memberId = "";

  beforeAll(async () => {
    const node = await listen((seen) => {
      nodeSeen.push(seen);
      return "node";
    });
    const fastapi = await listen((seen) => {
      fastapiSeen.push(seen);
      return "fastapi";
    });
    nodeServer = node.server;
    fastapiServer = fastapi.server;

    const config = testConfig({
      LEGACY_NODE_API_URL: `http://127.0.0.1:${node.port}`,
      FASTAPI_BASE_URL: `http://127.0.0.1:${fastapi.port}`,
      AUTH_FASTAPI_PREFIXES: "/api/v1",
    });
    const store = new MemoryStore();
    const member = store.seedOperator(
      operator({ email: "member@agency.gov.my", role: "operator" }),
    );
    const tokens = createSessionTokens(config);
    token = await tokens.sign(member);
    memberId = member.id;

    app = createAuthGatewayApp({
      config,
      store,
      tokens,
      oauthState: createOAuthStateService(config),
      google: new FakeGoogle(),
      mailer: new MemoryMailer(),
      audit: new MemoryAudit(),
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => nodeServer.close(() => resolve()));
    await new Promise<void>((resolve) => fastapiServer.close(() => resolve()));
  });

  it("keeps the full path and injects identity when proxying to Node", async () => {
    const response = await request(app)
      .get("/api/templates?status=PENDING")
      .set("Cookie", `case_session=${token}`)
      .set("x-operator-id", "attacker")
      .set("x-operator-role", "admin")
      .expect(200);

    expect(response.body.upstream).toBe("node");
    expect(nodeSeen).toHaveLength(1);
    expect(nodeSeen[0]!.url).toBe("/api/templates?status=PENDING");
    expect(nodeSeen[0]!.headers["x-operator-id"]).toBe(memberId);
    expect(nodeSeen[0]!.headers["x-operator-id"]).not.toBe("attacker");
    expect(nodeSeen[0]!.headers["x-operator-role"]).toBe("operator");
    expect(nodeSeen[0]!.headers["x-operator-role"]).not.toBe("admin");
    expect(nodeSeen[0]!.headers["x-mock-role"]).toBe("OPERATOR");
  });

  it("routes /api/v1 to FastAPI and everything else to Node", async () => {
    await request(app)
      .get("/api/v1/audit/events")
      .set("Cookie", `case_session=${token}`)
      .expect(200);

    expect(fastapiSeen).toHaveLength(1);
    expect(fastapiSeen[0]!.url).toBe("/api/v1/audit/events");
    expect(fastapiSeen[0]!.headers["x-mock-workspace"]).toBe(
      "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    );
    expect(nodeSeen).toHaveLength(1);
  });
});
