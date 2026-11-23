import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PostgresAuditLog } from "../audit/auditLog.js";
import { createPool } from "../db/pool.js";
import { createAuthGatewayApp } from "./app.js";
import { loadConfig, type AuthGatewayConfig } from "./config.js";
import { createCredentialService } from "./credentials.js";
import { assertAuditTable, migrateAuthGateway } from "./db/migrate.js";
import { createGoogleOAuth } from "./google.js";
import { createMailer } from "./mailer.js";
import { createCredentialRevoker } from "./revocation.js";
import { PostgresAuthStore } from "./store.js";
import { createTokenVault } from "./tokenVault.js";
import { createOAuthStateService, createSessionTokens } from "./tokens.js";

/**
 * Startup proof that .env reached this process. Never prints the password:
 * the length is enough to tell "not loaded" apart from "loaded but wrong".
 */
function logSmtpStartupDiagnostics(config: AuthGatewayConfig, env: NodeJS.ProcessEnv): void {
  const smtp = config.smtp;
  const envPath = resolve(process.cwd(), ".env");
  const pass = env.SMTP_PASS?.trim() ?? "";

  console.log("[auth-gateway][smtp] ── invitation mail configuration ──");
  console.log(`  process cwd:   ${process.cwd()}`);
  console.log(
    `  .env:          ${existsSync(envPath) ? `${envPath} (found)` : `${envPath} (MISSING — values must come from the shell)`}`,
  );
  console.log(`  SMTP_HOST:     ${env.SMTP_HOST?.trim() || "(unset)"}`);
  console.log(`  SMTP_PORT:     ${env.SMTP_PORT?.trim() || "(default 587)"}`);
  console.log(`  SMTP_SECURE:   ${String(smtp?.secure ?? "(unset)")}`);
  console.log(`  SMTP_USER:     ${env.SMTP_USER?.trim() || "(unset)"}`);
  console.log(
    `  SMTP_PASS:     ${pass ? `set (length: ${pass.length})` : "MISSING"}`,
  );
  console.log(`  From:          ${smtp?.from ?? "(unset)"}`);
  console.log(`  protocol log:  ${smtp?.debug ? "ON (SMTP_DEBUG)" : "off"}`);

  if (!smtp) {
    console.warn(
      "  ⚠ SMTP_HOST is empty: invitations will fail with 503 unless AUTH_DEV_LOG_MAGIC_LINKS=true.",
    );
    return;
  }
  if (!pass) {
    console.warn("  ⚠ SMTP_PASS is empty — Google will reject the AUTH exchange with 535.");
  } else if (/\s/.test(pass)) {
    console.warn(
      "  ⚠ SMTP_PASS contains whitespace. Gmail App Passwords are 16 characters; remove the grouping spaces.",
    );
  } else if (/gmail\.com$/i.test(smtp.host) && pass.length !== 16) {
    console.warn(
      `  ⚠ Gmail App Passwords are exactly 16 characters; SMTP_PASS has ${pass.length}. A normal account password will fail with 535-5.7.8.`,
    );
  }
  if (!smtp.user) {
    console.warn("  ⚠ SMTP_USER is empty: the transport will connect without authenticating.");
  }
  if (smtp.port === 25) {
    console.warn(
      "  ⚠ SMTP_PORT=25 is commonly blocked by cloud providers and ISPs; use 587 (STARTTLS) or 465 (TLS).",
    );
  }
  if (smtp.port === 465 && !smtp.secure) {
    console.warn("  ⚠ Port 465 expects SMTP_SECURE=true (implicit TLS).");
  }
  if (smtp.port === 587 && smtp.secure) {
    console.warn("  ⚠ Port 587 expects SMTP_SECURE=false (STARTTLS).");
  }
  const fromAddress = /<([^>]+)>/.exec(smtp.from)?.[1] ?? smtp.from.trim();
  if (
    smtp.user &&
    /gmail\.com$/i.test(smtp.host) &&
    fromAddress.toLowerCase() !== smtp.user.toLowerCase()
  ) {
    console.warn(
      `  ⚠ AUTH_EMAIL_FROM (${fromAddress}) differs from SMTP_USER (${smtp.user}). Gmail rewrites the sender, and some recipients may quarantine it.`,
    );
  }
}

/**
 * Standalone process. Run it beside the existing workflow API:
 *
 *   server/  PORT=8001           (existing Express, never modified)
 *   backend/ uvicorn :8000       (existing FastAPI, never modified)
 *   gateway  :8080               (this file; browser talks only to this)
 */
async function main(): Promise<void> {
  const config = loadConfig();
  logSmtpStartupDiagnostics(config, process.env);
  const pool = createPool(config.databaseUrl);
  pool.on("error", (error) => {
    console.error("[auth-gateway][postgres] idle client error:", error.message);
  });

  if (config.autoMigrate) {
    const applied = await migrateAuthGateway(pool);
    if (applied.length > 0) {
      console.log(`[auth-gateway][migrations] applied: ${applied.join(", ")}`);
    }
  }
  await assertAuditTable(pool);

  const store = new PostgresAuthStore(pool);
  // Delegated Google tokens are sealed before they reach the database. A
  // dedicated AUTH_TOKEN_ENCRYPTION_KEY is preferred; the JWT secret is an
  // acceptable development fallback (rotating one then invalidates the other).
  const vault = createTokenVault(config.tokenEncryptionKey ?? config.jwt.secret);
  const credentials = createCredentialService({ store, vault });
  const revoker = createCredentialRevoker({ store });
  // One dedicated CASE system mailbox for every invitation. Misconfiguration
  // or a bad password surfaces per-request as a clear 502, never as a crash.
  const mailer = createMailer(config);

  // Catch revocations performed outside the proxy path (another tool, SQL, a
  // restored dump) so "revoked" and "no credentials left" never drift apart.
  const sweepRevoked = (): void => {
    void revoker.sweep().catch((error: unknown) => {
      console.error(
        "[auth-gateway] credential sweep failed:",
        error instanceof Error ? error.message : error,
      );
    });
  };
  sweepRevoked();
  setInterval(sweepRevoked, 10 * 60_000).unref();

  const app = createAuthGatewayApp({
    config,
    store,
    tokens: createSessionTokens(config),
    oauthState: createOAuthStateService(config),
    google: createGoogleOAuth(config),
    mailer,
    credentials,
    revoker,
    audit: new PostgresAuditLog(pool),
  });

  const server = app.listen(config.port, () => {
    console.log(`[auth-gateway] listening on ${config.publicUrl} (port ${config.port})`);
    console.log(`[auth-gateway] Google callback: ${config.google.redirectUri}`);
    console.log(
      `[auth-gateway] upstreams: node=${config.nodeApiUrl ?? "unset"} fastapi=${config.fastapiUrl ?? "unset"} (${config.fastapiPrefixes.join(", ")})`,
    );
    console.log(
      config.smtp
        ? `[auth-gateway] invitation email: SMTP ${config.smtp.host}:${config.smtp.port} as ${config.smtp.user ?? "anonymous"}`
        : `[auth-gateway] invitation email: SMTP not configured${config.invitation.devLogLinks ? " (dev links enabled)" : ""}`,
    );
    if (!config.tokenEncryptionKey) {
      console.log("[auth-gateway] token key derived from AUTH_JWT_SECRET");
    }
    if (config.smtp) {
      // Non-blocking: a temporarily unreachable mail server must not prevent the
      // gateway from serving sign-in and proxied requests. The failure banner is
      // deliberately loud — a silent bad password otherwise looks like a
      // successful invite whose email vanished.
      void mailer.verify().then((result) => {
        if (result.ok) {
          console.log(
            "[auth-gateway][smtp] ✓ verify() passed — DNS, TCP, STARTTLS and authentication are all working.",
          );
          return;
        }
        console.error("");
        console.error("╔══════════════════════════════════════════════════════════════════════╗");
        console.error("║  ✖ SMTP VERIFICATION FAILED — INVITATION EMAIL WILL NOT BE SENT  ✖  ║");
        console.error("╚══════════════════════════════════════════════════════════════════════╝");
        console.error(`  Server:  ${config.smtp?.host}:${config.smtp?.port} (secure=${String(config.smtp?.secure)})`);
        console.error(`  Account: ${config.smtp?.user ?? "(anonymous)"}`);
        console.error(`  Reason:  ${result.error}`);
        console.error("  What to check:");
        for (const hint of result.hints) {
          console.error(`    • ${hint}`);
        }
        console.error("");
        console.error("  The gateway is still running; POST /api/invitations will return");
        console.error("  502 INVITATION_EMAIL_* with the same diagnosis until this is fixed.");
        console.error("");
      });
    }
    if (config.allowLegacyIdentity) {
      console.warn(
        "[auth-gateway] AUTH_ALLOW_LEGACY_IDENTITY=true — the bare x-operator-id header is trusted. Development only.",
      );
    }
  });

  const shutdown = (signal: string): void => {
    console.log(`[auth-gateway] ${signal}; shutting down.`);
    server.close(() => {
      void pool.end().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(
    "[auth-gateway][startup] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
