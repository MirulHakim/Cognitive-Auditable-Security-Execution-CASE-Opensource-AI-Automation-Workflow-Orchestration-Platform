import "dotenv/config";

/**
 * Configuration for the standalone auth gateway.
 *
 * Nothing here is read by the existing workflow API: the gateway is a separate
 * process with its own port, its own .env keys (AUTH_*), and its own migrations.
 * That keeps the zero-modification boundary explicit.
 */

/**
 * Shape-only UUID check (8-4-4-4-12 hex).
 *
 * The RFC 4122 version/variant nibbles are deliberately not enforced: PostgreSQL's
 * `uuid` type and Python's `uuid.UUID` both accept namespaced/nil-style ids such as
 * 11111111-1111-1111-1111-111111111111, and the workspace id is only ever passed to
 * those two. Enforcing the nibbles rejected valid configurations the audit chain
 * already accepts, so a shared workspace id failed at gateway startup.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function csv(value: string | undefined, fallback: string[]): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new Error(`[auth-gateway] ${key} is required.`);
  return value;
}

/**
 * Dedicated SMTP account the platform sends from. Invitations are delivered by
 * the CASE system mailbox, never by an admin's personal mailbox.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  /** true for implicit TLS (465); false for STARTTLS (587). */
  secure: boolean;
  /** Null only for unauthenticated relays. */
  user: string | null;
  pass: string | null;
  from: string;
  replyTo: string | null;
  /**
   * Nodemailer protocol transcript (handshake, capabilities, commands, Google's
   * numeric replies). Defaults to on outside production because it is the only
   * way to see why a message was accepted-but-undelivered; SMTP_DEBUG=false
   * silences it. Credentials are redacted by the mailer's logger.
   */
  debug: boolean;
}

export interface AuthGatewayConfig {
  port: number;
  /** Public origin the browser uses; OAuth redirects and cookies are anchored to it. */
  publicUrl: string;
  dashboardUrl: string;
  databaseUrl: string;
  autoMigrate: boolean;
  /** Existing Express API; JWT-validated requests are reverse-proxied here. */
  nodeApiUrl: string | null;
  /** Existing FastAPI API; paths under fastapiPrefixes are proxied here. */
  fastapiUrl: string | null;
  fastapiPrefixes: string[];
  corsOrigins: string[];
  /** Python audit workspace the gateway injects as X-Mock-Workspace. */
  workspaceId: string;
  jwt: {
    secret: string;
    issuer: string;
    audience: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    hostedDomain: string | null;
  };
  invitation: {
    ttlMinutes: number;
    appName: string;
    /** Development only: log the magic link instead of requiring SMTP. */
    devLogLinks: boolean;
  };
  /** Null when SMTP is not configured; sending then fails gracefully. */
  smtp: SmtpConfig | null;
  /**
   * Key material for sealing stored Google tokens. Null derives one from the JWT
   * secret, which is fine for development but should be set explicitly in
   * production so the two secrets can be rotated independently.
   */
  tokenEncryptionKey: string | null;
  /**
   * User-scoped integration vault (Telegram / Gmail credentials).
   *
   * `masterKey` is required and must decode to exactly 32 bytes; there is no
   * JWT-derived fallback because these are operator-owned third-party secrets,
   * not session material. `internalApiKey` is the pre-shared credential the
   * workflow engine presents to the internal just-in-time decryption route.
   * Leaving it unset disables that route rather than exposing it unauthenticated.
   */
  vault: {
    masterKey: string;
    internalApiKey: string | null;
  };
  cookies: {
    secure: boolean;
    sessionName: string;
    refreshName: string;
    oauthStateName: string;
  };
  /**
   * Development escape hatch: trust a bare x-operator-id when no JWT is present.
   * This preserves the old demo identities locally. Never enable in production.
   */
  allowLegacyIdentity: boolean;
  trustProxy: boolean;
  rateLimit: {
    windowMs: number;
    max: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AuthGatewayConfig {
  const publicUrl = trimSlash(env.AUTH_PUBLIC_URL?.trim() || "http://localhost:5174");
  const secret = required(env, "AUTH_JWT_SECRET");
  if (secret.length < 32) {
    throw new Error("[auth-gateway] AUTH_JWT_SECRET must be at least 32 characters.");
  }

  const workspaceId = env.AUTH_WORKSPACE_ID?.trim() || "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  if (!UUID_RE.test(workspaceId)) {
    throw new Error(
      `[auth-gateway] AUTH_WORKSPACE_ID must be a UUID (8-4-4-4-12 hex), got "${workspaceId}".`,
    );
  }

  const redirectUri =
    env.AUTH_GOOGLE_REDIRECT_URI?.trim() || `${publicUrl}/api/auth/google/callback`;
  if (!redirectUri.startsWith("http://") && !redirectUri.startsWith("https://")) {
    throw new Error("[auth-gateway] AUTH_GOOGLE_REDIRECT_URI must be an absolute http(s) URL.");
  }

  const nodeApiUrl = env.LEGACY_NODE_API_URL?.trim()
    ? trimSlash(env.LEGACY_NODE_API_URL.trim())
    : null;
  const fastapiUrl = env.FASTAPI_BASE_URL?.trim()
    ? trimSlash(env.FASTAPI_BASE_URL.trim())
    : null;

  if (nodeApiUrl && nodeApiUrl === fastapiUrl) {
    throw new Error("[auth-gateway] LEGACY_NODE_API_URL and FASTAPI_BASE_URL must differ.");
  }

  const cookieSecure = bool(env.AUTH_COOKIE_SECURE, publicUrl.startsWith("https://"));
  const allowLegacyIdentity = bool(env.AUTH_ALLOW_LEGACY_IDENTITY, false);

  if (allowLegacyIdentity && env.NODE_ENV === "production") {
    throw new Error(
      "[auth-gateway] AUTH_ALLOW_LEGACY_IDENTITY must not be enabled in production.",
    );
  }

  const appName = env.AUTH_APP_NAME?.trim() || "CASE";
  // No fallback: a missing or weak vault key is a startup error, not a silent
  // downgrade to a JWT-derived key. decodeVaultMasterKey() in vault.ts performs
  // the exact 32-byte check when the service is constructed.
  const vaultMasterKey = required(env, "VAULT_MASTER_KEY");
  const vaultInternalApiKey = env.VAULT_INTERNAL_API_KEY?.trim() || null;
  if (vaultInternalApiKey && vaultInternalApiKey.length < 32) {
    throw new Error(
      "[auth-gateway] VAULT_INTERNAL_API_KEY must be at least 32 characters when set.",
    );
  }
  const smtpHost = env.SMTP_HOST?.trim() || null;
  const smtpPort = int(env.SMTP_PORT, 587, 1, 65535);
  const smtpUser = env.SMTP_USER?.trim() || null;
  // Gmail rewrites a From that is not the authenticated mailbox, so derive the
  // default from SMTP_USER instead of advertising an address that cannot send.
  const defaultFrom = smtpUser
    ? `${appName} <${smtpUser}>`
    : `${appName} <no-reply@case.local>`;
  const smtp: SmtpConfig | null = smtpHost
    ? {
        host: smtpHost,
        port: smtpPort,
        secure: bool(env.SMTP_SECURE, smtpPort === 465),
        user: smtpUser,
        pass: env.SMTP_PASS?.trim() || null,
        from: env.AUTH_EMAIL_FROM?.trim() || defaultFrom,
        replyTo: env.AUTH_EMAIL_REPLY_TO?.trim() || null,
        debug: bool(env.SMTP_DEBUG, env.NODE_ENV !== "production"),
      }
    : null;

  return {
    port: int(env.AUTH_GATEWAY_PORT, 8080, 1, 65535),
    publicUrl,
    dashboardUrl: trimSlash(env.AUTH_DASHBOARD_URL?.trim() || publicUrl),
    databaseUrl:
      env.AUTH_DATABASE_URL?.trim() ||
      env.DATABASE_URL ||
      "postgresql://postgres:postgres@127.0.0.1:5432/template_module",
    autoMigrate: bool(env.AUTH_AUTO_MIGRATE, true),
    nodeApiUrl,
    fastapiUrl,
    fastapiPrefixes: csv(env.AUTH_FASTAPI_PREFIXES, ["/api/v1"]).map(trimSlash),
    corsOrigins: csv(env.AUTH_CORS_ORIGINS, [publicUrl]),
    workspaceId: workspaceId.toLowerCase(),
    jwt: {
      secret,
      issuer: env.AUTH_JWT_ISSUER?.trim() || "case-auth-gateway",
      audience: env.AUTH_JWT_AUDIENCE?.trim() || "case-platform",
      accessTtlSeconds: int(env.AUTH_ACCESS_TTL_SECONDS, 15 * 60, 60, 24 * 60 * 60),
      refreshTtlSeconds: int(env.AUTH_REFRESH_TTL_SECONDS, 7 * 24 * 60 * 60, 300, 90 * 24 * 60 * 60),
    },
    google: {
      clientId: required(env, "GOOGLE_CLIENT_ID"),
      clientSecret: required(env, "GOOGLE_CLIENT_SECRET"),
      redirectUri,
      hostedDomain: env.GOOGLE_HOSTED_DOMAIN?.trim() || null,
    },
    invitation: {
      // Hard ceiling of two hours: the database enforces the same limit.
      ttlMinutes: int(env.AUTH_INVITATION_TTL_MINUTES, 120, 1, 120),
      appName,
      devLogLinks: bool(env.AUTH_DEV_LOG_MAGIC_LINKS, false),
    },
    smtp,
    tokenEncryptionKey: env.AUTH_TOKEN_ENCRYPTION_KEY?.trim() || null,
    vault: {
      masterKey: vaultMasterKey,
      internalApiKey: vaultInternalApiKey,
    },
    cookies: {
      secure: cookieSecure,
      sessionName: env.AUTH_SESSION_COOKIE?.trim() || "case_session",
      refreshName: env.AUTH_REFRESH_COOKIE?.trim() || "case_refresh",
      oauthStateName: env.AUTH_OAUTH_COOKIE?.trim() || "case_oauth",
    },
    allowLegacyIdentity,
    trustProxy: bool(env.AUTH_TRUST_PROXY, false),
    rateLimit: {
      windowMs: int(env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000, 1000, 60 * 60 * 1000),
      max: int(env.AUTH_RATE_LIMIT_MAX, 30, 1, 10_000),
    },
  };
}
