import { randomUUID } from "node:crypto";
import type { AuditEvent, AuditEventInput, AuditRecorder } from "../../src/audit/auditLog.js";
import { GENESIS_HASH } from "../../src/audit/auditLog.js";
import type { Role } from "../../src/auth/operators.js";
import { createAuthGatewayApp } from "../../src/auth-gateway/app.js";
import type { AuthGatewayConfig } from "../../src/auth-gateway/config.js";
import { loadConfig } from "../../src/auth-gateway/config.js";
import { createCredentialService } from "../../src/auth-gateway/credentials.js";
import type {
  GoogleExchangeResult,
  GoogleOAuth,
  GoogleProfile,
  GoogleTokenSet,
} from "../../src/auth-gateway/google.js";
import type { InvitationMail, Mailer } from "../../src/auth-gateway/mailer.js";
import { displayNameFromEmail } from "../../src/auth-gateway/names.js";
import type { CredentialService } from "../../src/auth-gateway/credentials.js";
import {
  createCredentialRevoker,
  type CredentialRevoker,
} from "../../src/auth-gateway/revocation.js";
import { createTokenVault } from "../../src/auth-gateway/tokenVault.js";
import type { VaultProvider } from "../../src/auth-gateway/vault.js";
import type {
  AuthStore,
  ClaimInvitationResult,
  InvitationRecord,
  OperatorRecord,
  ProfileRecord,
  RotateRefreshResult,
  ThemePreference,
} from "../../src/auth-gateway/store.js";
import { createOAuthStateService, createSessionTokens, sha256Hex } from "../../src/auth-gateway/tokens.js";

export const TEST_SECRET = "test-secret-that-is-long-enough-for-hs256";

export function testConfig(overrides: Record<string, string> = {}): AuthGatewayConfig {
  return loadConfig({
    NODE_ENV: "test",
    AUTH_JWT_SECRET: TEST_SECRET,
    AUTH_PUBLIC_URL: "http://localhost:5174",
    AUTH_GATEWAY_PORT: "8080",
    AUTH_DATABASE_URL: "postgresql://unused",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    AUTH_GOOGLE_REDIRECT_URI: "http://localhost:5174/api/auth/google/callback",
    AUTH_WORKSPACE_ID: "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",
    AUTH_CORS_ORIGINS: "http://localhost:5174",
    AUTH_RATE_LIMIT_MAX: "10000",
    // Exactly 32 raw bytes; the vault service rejects anything shorter.
    VAULT_MASTER_KEY: "test-vault-master-key-32-bytes!!",
    VAULT_INTERNAL_API_KEY: "test-internal-vault-key-0123456789abcdef",
    ...overrides,
  });
}

export function operator(overrides: Partial<OperatorRecord> & { email: string }): OperatorRecord {
  return {
    id: overrides.id ?? `op-${randomUUID().slice(0, 8)}`,
    displayName: overrides.displayName ?? "Test Member",
    email: overrides.email,
    role: outRole(overrides.role),
    revokedAt: overrides.revokedAt ?? null,
  };
}

function outRole(role: Role | undefined): Role {
  return role ?? "operator";
}

interface StoredInvitation {
  record: InvitationRecord;
  tokenHash: string;
}

export class MemoryStore implements AuthStore {
  operators = new Map<string, OperatorRecord>();
  accounts = new Map<string, { accountId: string; operatorId: string; email: string }>();
  invitations = new Map<string, StoredInvitation>();
  refresh = new Map<string, { operatorId: string; expiresAt: Date; revokedAt: Date | null }>();
  /** Presence state, keyed by operator id (as auth_accounts does). */
  presence = new Map<string, { lastSeenAt: Date | null; isOnline: boolean }>();
  /** Editable profile overlay, keyed by operator id. */
  contacts = new Map<string, string | null>();
  themes = new Map<string, ThemePreference>();
  /** Sealed integration credentials, keyed by `${operatorId}:${provider}`. */
  vaultSecrets = new Map<
    string,
    {
      operatorId: string;
      provider: VaultProvider;
      cipherText: string;
      iv: string;
      authTag: string;
      updatedAt: Date;
    }
  >();
  /** Sealed Google delegation material, keyed by operator id (as Postgres does). */
  googleTokens = new Map<
    string,
    {
      accessTokenEnc: string | null;
      refreshTokenEnc: string | null;
      expiresAt: Date | null;
      scopes: string[];
    }
  >();

  seedOperator(input: OperatorRecord): OperatorRecord {
    this.operators.set(input.id, input);
    return input;
  }

  async findOperatorById(id: string): Promise<OperatorRecord | null> {
    return this.operators.get(id) ?? null;
  }

  async findOperatorByEmail(email: string): Promise<OperatorRecord | null> {
    return (
      [...this.operators.values()].find(
        (entry) => entry.email.toLowerCase() === email.toLowerCase(),
      ) ?? null
    );
  }

  async findAccountByGoogleSub(
    googleSub: string,
  ): Promise<{ accountId: string; operator: OperatorRecord } | null> {
    const account = this.accounts.get(googleSub);
    if (!account) return null;
    const operator = this.operators.get(account.operatorId);
    if (!operator) return null;
    return { accountId: account.accountId, operator };
  }

  async countOperators(): Promise<number> {
    return this.operators.size;
  }

  async bootstrapRootAdmin(input: {
    googleSub: string;
    email: string;
    displayName: string;
    workspaceId: string;
  }): Promise<{ created: boolean; operator: OperatorRecord | null }> {
    if (this.operators.size > 0) return { created: false, operator: null };
    const admin = this.seedOperator({
      id: randomUUID(),
      displayName: input.displayName,
      email: input.email,
      role: "admin",
      revokedAt: null,
    });
    this.accounts.set(input.googleSub, {
      accountId: randomUUID(),
      operatorId: admin.id,
      email: input.email,
    });
    return { created: true, operator: admin };
  }

  async linkAccount(input: {
    googleSub: string;
    operatorId: string;
    email: string;
  }): Promise<OperatorRecord | null> {
    const existing = this.accounts.get(input.googleSub);
    if (existing && existing.operatorId !== input.operatorId) return null;
    this.accounts.set(input.googleSub, {
      accountId: existing?.accountId ?? randomUUID(),
      operatorId: input.operatorId,
      email: input.email,
    });
    return this.operators.get(input.operatorId) ?? null;
  }

  async touchAccount(googleSub: string, email: string): Promise<void> {
    const account = this.accounts.get(googleSub);
    if (account) this.accounts.set(googleSub, { ...account, email });
  }

  async createInvitation(input: {
    email: string;
    role: Role;
    invitedBy: string;
    workspaceId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<InvitationRecord> {
    for (const [id, stored] of this.invitations) {
      if (
        stored.record.email.toLowerCase() === input.email.toLowerCase() &&
        !stored.record.consumedAt &&
        !stored.record.revokedAt
      ) {
        this.invitations.set(id, {
          ...stored,
          record: { ...stored.record, revokedAt: input.createdAt },
        });
      }
    }
    const record: InvitationRecord = {
      invitationId: randomUUID(),
      email: input.email,
      role: input.role,
      invitedBy: input.invitedBy,
      workspaceId: input.workspaceId,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      consumedAt: null,
      acceptedOperatorId: null,
      revokedAt: null,
    };
    this.invitations.set(record.invitationId, { record, tokenHash: input.tokenHash });
    return record;
  }

  async listInvitations(): Promise<InvitationRecord[]> {
    return [...this.invitations.values()]
      .map((entry) => entry.record)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    const stored = this.invitations.get(invitationId);
    if (stored && !stored.record.consumedAt) {
      this.invitations.set(invitationId, {
        ...stored,
        record: { ...stored.record, revokedAt: new Date() },
      });
    }
  }

  async findInvitationById(
    invitationId: string,
  ): Promise<InvitationRecord | null> {
    return this.invitations.get(invitationId)?.record ?? null;
  }

  async withdrawInvitation(
    invitationId: string,
    at: Date,
  ): Promise<InvitationRecord | null> {
    const stored = this.invitations.get(invitationId);
    if (!stored || stored.record.consumedAt || stored.record.revokedAt) {
      return null;
    }
    const updated: InvitationRecord = { ...stored.record, revokedAt: at };
    this.invitations.set(invitationId, { ...stored, record: updated });
    return updated;
  }

  async claimInvitation(input: {
    tokenHash: string;
    now: Date;
    workspaceId: string;
  }): Promise<ClaimInvitationResult> {
    const stored = [...this.invitations.values()].find(
      (entry) => entry.tokenHash === input.tokenHash,
    );
    if (!stored) return { status: "invalid" };
    if (stored.record.revokedAt) return { status: "revoked" };
    if (stored.record.consumedAt) return { status: "consumed" };
    if (stored.record.expiresAt.getTime() <= input.now.getTime()) return { status: "expired" };
    if (stored.record.workspaceId !== input.workspaceId) return { status: "invalid" };
    if (await this.findOperatorByEmail(stored.record.email)) return { status: "email_taken" };

    const created = this.seedOperator({
      id: randomUUID(),
      displayName: displayNameFromEmail(stored.record.email),
      email: stored.record.email,
      role: stored.record.role,
      revokedAt: null,
    });
    const updated: InvitationRecord = {
      ...stored.record,
      consumedAt: input.now,
      acceptedOperatorId: created.id,
    };
    this.invitations.set(stored.record.invitationId, { ...stored, record: updated });
    return { status: "ok", invitation: updated, operator: created };
  }

  async createRefreshToken(input: {
    tokenHash: string;
    operatorId: string;
    expiresAt: Date;
  }): Promise<void> {
    this.refresh.set(input.tokenHash, {
      operatorId: input.operatorId,
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async rotateRefreshToken(input: {
    oldTokenHash: string;
    newTokenHash: string;
    newExpiresAt: Date;
    now: Date;
  }): Promise<RotateRefreshResult> {
    const current = this.refresh.get(input.oldTokenHash);
    if (!current) return { status: "invalid" };
    if (current.revokedAt) {
      for (const [hash, token] of this.refresh) {
        if (token.operatorId === current.operatorId && !token.revokedAt) {
          this.refresh.set(hash, { ...token, revokedAt: input.now });
        }
      }
      return { status: "reuse" };
    }
    if (current.expiresAt.getTime() <= input.now.getTime()) return { status: "expired" };
    this.refresh.set(input.oldTokenHash, { ...current, revokedAt: input.now });
    this.refresh.set(input.newTokenHash, {
      operatorId: current.operatorId,
      expiresAt: input.newExpiresAt,
      revokedAt: null,
    });
    return { status: "ok", operatorId: current.operatorId };
  }

  async revokeRefreshToken(tokenHash: string): Promise<string | null> {
    const token = this.refresh.get(tokenHash);
    if (!token || token.revokedAt) return null;
    this.refresh.set(tokenHash, { ...token, revokedAt: new Date() });
    return token.operatorId;
  }

  async findProfile(operatorId: string): Promise<ProfileRecord | null> {
    const operator = this.operators.get(operatorId);
    if (!operator) return null;
    return {
      id: operator.id,
      displayName: operator.displayName,
      email: operator.email,
      role: operator.role,
      contactNumber: this.contacts.get(operatorId) ?? null,
      themePreference: this.themes.get(operatorId) ?? null,
    };
  }

  async updateProfile(
    operatorId: string,
    input: { displayName?: string; contactNumber?: string | null },
  ): Promise<ProfileRecord | null> {
    const operator = this.operators.get(operatorId);
    if (!operator) return null;
    if (input.displayName !== undefined) {
      this.operators.set(operatorId, {
        ...operator,
        displayName: input.displayName,
      });
    }
    if (input.contactNumber !== undefined) {
      this.contacts.set(operatorId, input.contactNumber);
    }
    return this.findProfile(operatorId);
  }

  async setThemePreference(
    operatorId: string,
    theme: ThemePreference,
  ): Promise<boolean> {
    const hasAccount = [...this.accounts.values()].some(
      (account) => account.operatorId === operatorId,
    );
    if (!hasAccount) return false;
    this.themes.set(operatorId, theme);
    return true;
  }

  async touchPresence(operatorId: string, at: Date): Promise<void> {
    this.presence.set(operatorId, { lastSeenAt: at, isOnline: true });
  }

  async setPresenceOffline(operatorId: string): Promise<void> {
    const current = this.presence.get(operatorId);
    this.presence.set(operatorId, {
      lastSeenAt: current?.lastSeenAt ?? null,
      isOnline: false,
    });
  }

  async listPresence() {
    return [...this.operators.values()]
      .filter((entry) => entry.revokedAt === null)
      .sort((a, b) =>
        a.displayName.toLowerCase().localeCompare(b.displayName.toLowerCase()),
      )
      .map((entry) => {
        const presence = this.presence.get(entry.id);
        return {
          operatorId: entry.id,
          displayName: entry.displayName,
          role: entry.role,
          lastSeenAt: presence?.lastSeenAt ?? null,
          isOnline: presence?.isOnline ?? false,
        };
      });
  }

  async findVaultSecret(operatorId: string, provider: VaultProvider) {
    return this.vaultSecrets.get(`${operatorId}:${provider}`) ?? null;
  }

  async listVaultSecretProviders(operatorId: string) {
    return [...this.vaultSecrets.values()]
      .filter((row) => row.operatorId === operatorId)
      .map((row) => ({ provider: row.provider, updatedAt: row.updatedAt }));
  }

  async upsertVaultSecret(input: {
    operatorId: string;
    provider: VaultProvider;
    cipherText: string;
    iv: string;
    authTag: string;
    at: Date;
  }): Promise<Date> {
    this.vaultSecrets.set(`${input.operatorId}:${input.provider}`, {
      operatorId: input.operatorId,
      provider: input.provider,
      cipherText: input.cipherText,
      iv: input.iv,
      authTag: input.authTag,
      updatedAt: input.at,
    });
    return input.at;
  }

  async deleteVaultSecret(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<boolean> {
    return this.vaultSecrets.delete(`${operatorId}:${provider}`);
  }

  async deleteOperator(operatorId: string) {
    let invitationsUnlinked = 0;
    for (const [id, stored] of [...this.invitations]) {
      const invited = stored.record.invitedBy === operatorId;
      const accepted = stored.record.acceptedOperatorId === operatorId;
      if (!invited && !accepted) continue;
      this.invitations.set(id, {
        ...stored,
        record: {
          ...stored.record,
          ...(invited ? { invitedBy: null } : {}),
          // Mirrors the FK's ON DELETE SET NULL; consumedAt stays set so the
          // invitation remains CONSUMED and its magic link cannot be reused.
          ...(accepted ? { acceptedOperatorId: null } : {}),
        },
      });
      if (invited) invitationsUnlinked += 1;
    }
    let accounts = 0;
    for (const [sub, account] of [...this.accounts]) {
      if (account.operatorId === operatorId) {
        this.accounts.delete(sub);
        accounts += 1;
      }
    }
    let refreshTokens = 0;
    for (const [hash, token] of [...this.refresh]) {
      if (token.operatorId === operatorId) {
        this.refresh.delete(hash);
        refreshTokens += 1;
      }
    }
    this.googleTokens.delete(operatorId);
    for (const [key, row] of [...this.vaultSecrets]) {
      if (row.operatorId === operatorId) this.vaultSecrets.delete(key);
    }
    this.presence.delete(operatorId);
    this.contacts.delete(operatorId);
    this.themes.delete(operatorId);
    const deleted = this.operators.delete(operatorId);
    return { deleted, accounts, refreshTokens, invitationsUnlinked };
  }

  async saveAccountTokens(input: {
    googleSub: string;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    expiresAt: Date | null;
    scopes: string[];
  }): Promise<void> {
    const account = this.accounts.get(input.googleSub);
    if (!account) throw new Error("no account for sub " + input.googleSub);
    const existing = this.googleTokens.get(account.operatorId);
    this.googleTokens.set(account.operatorId, {
      accessTokenEnc: input.accessTokenEnc ?? existing?.accessTokenEnc ?? null,
      refreshTokenEnc: input.refreshTokenEnc ?? existing?.refreshTokenEnc ?? null,
      expiresAt: input.expiresAt,
      scopes: input.scopes.length > 0 ? input.scopes : (existing?.scopes ?? []),
    });
  }

  async findAccountTokens(operatorId: string) {
    return this.googleTokens.get(operatorId) ?? null;
  }

  async updateAccountAccessToken(input: {
    operatorId: string;
    accessTokenEnc: string;
    expiresAt: Date | null;
  }): Promise<void> {
    const existing = this.googleTokens.get(input.operatorId);
    if (!existing) throw new Error("no stored tokens for " + input.operatorId);
    this.googleTokens.set(input.operatorId, {
      ...existing,
      accessTokenEnc: input.accessTokenEnc,
      expiresAt: input.expiresAt,
    });
  }

  async purgeCredentials(
    operatorId: string,
  ): Promise<{ accounts: number; refreshTokens: number }> {
    let accounts = 0;
    for (const [sub, account] of [...this.accounts]) {
      if (account.operatorId === operatorId) {
        this.accounts.delete(sub);
        accounts += 1;
      }
    }
    this.googleTokens.delete(operatorId);
    for (const [key, row] of [...this.vaultSecrets]) {
      if (row.operatorId === operatorId) this.vaultSecrets.delete(key);
    }
    let refreshTokens = 0;
    for (const [hash, token] of [...this.refresh]) {
      if (token.operatorId === operatorId) {
        this.refresh.delete(hash);
        refreshTokens += 1;
      }
    }
    return { accounts, refreshTokens };
  }

  async listRevokedOperatorsWithCredentials(limit = 200): Promise<string[]> {
    return [...this.operators.values()]
      .filter((entry) => {
        if (entry.revokedAt === null) return false;
        const hasAccount = [...this.accounts.values()].some(
          (account) => account.operatorId === entry.id,
        );
        const hasRefresh = [...this.refresh.values()].some(
          (token) => token.operatorId === entry.id,
        );
        const hasVaultSecret = [...this.vaultSecrets.values()].some(
          (row) => row.operatorId === entry.id,
        );
        return hasAccount || hasRefresh || hasVaultSecret || this.googleTokens.has(entry.id);
      })
      .map((entry) => entry.id)
      .slice(0, limit);
  }
}

export class MemoryMailer implements Mailer {
  sent: InvitationMail[] = [];

  async sendInvitation(mail: InvitationMail) {
    this.sent.push(mail);
    return { transport: "SMTP" as const, messageId: `fake-${this.sent.length}` };
  }

  async verify() {
    return { ok: true, error: null, hints: [] };
  }
}

/** Simulates the dedicated SMTP account being down or misconfigured. */
export class FailingMailer implements Mailer {
  sent = 0;

  constructor(readonly error: Error) {}

  async sendInvitation(): Promise<never> {
    this.sent += 1;
    throw this.error;
  }

  async verify() {
    return {
      ok: false,
      error: this.error.message,
      hints: ["Simulated mailer failure."],
    };
  }
}

export class FakeGoogle implements GoogleOAuth {
  profile: GoogleProfile = {
    sub: "google-sub-1",
    email: "root@agency.gov.my",
    emailVerified: true,
    name: "Root Admin",
    hostedDomain: null,
  };

  tokens: GoogleTokenSet = {
    accessToken: "fake-google-access-token",
    refreshToken: "fake-google-refresh-token",
    expiresAt: new Date("2026-11-17T11:00:00.000Z"),
    scopes: ["openid", "email", "profile"],
  };

  authorizationUrl({ state }: { state: string; nonce: string }): string {
    return `https://accounts.google.test/auth?state=${encodeURIComponent(state)}`;
  }

  async exchangeCode(): Promise<GoogleExchangeResult> {
    return { profile: this.profile, tokens: this.tokens };
  }
}

export class MemoryAudit implements AuditRecorder {
  events: AuditEventInput[] = [];

  async record(input: AuditEventInput): Promise<AuditEvent> {
    this.events.push(structuredClone(input));
    return {
      id: randomUUID(),
      sequence: this.events.length,
      recordedAt: new Date().toISOString(),
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType ?? "",
      targetId: input.targetId ?? "",
      outcome: input.outcome ?? "SUCCESS",
      details: input.details ?? {},
      prevHash: GENESIS_HASH,
      hash: GENESIS_HASH,
    };
  }
}

export function buildGateway(
  overrides: {
    config?: AuthGatewayConfig;
    store?: MemoryStore;
    google?: FakeGoogle;
    audit?: MemoryAudit;
    credentials?: CredentialService;
    /** Replaces the default SMTP-backed mailer (used to simulate failures). */
    mailer?: Mailer;
    revoker?: CredentialRevoker;
    /** Status the fake legacy API answers proxied requests with. */
    proxyStatus?: number;
    now?: () => Date;
    /** Fake legacy directory response for GET /api/operators. */
    directoryFetch?: typeof fetch;
  } = {},
) {
  const config = overrides.config ?? testConfig();
  const store = overrides.store ?? new MemoryStore();
  const google = overrides.google ?? new FakeGoogle();
  const audit = overrides.audit ?? new MemoryAudit();
  const memoryMailer = new MemoryMailer();
  const mailer = overrides.mailer ?? memoryMailer;
  const now = overrides.now ?? (() => new Date("2026-11-17T10:00:00.000Z"));
  const proxyRequests: { path: string; headers: Record<string, unknown> }[] = [];

  const vault = createTokenVault(TEST_SECRET);
  const credentials =
    overrides.credentials ??
    createCredentialService({ store, vault });

  const revoker =
    overrides.revoker ??
    createCredentialRevoker({ store, log: () => undefined });

  const app = createAuthGatewayApp({
    config,
    store,
    tokens: createSessionTokens(config),
    oauthState: createOAuthStateService(config),
    google,
    mailer,
    credentials,
    revoker,
    audit,
    now,
    fetchImpl: overrides.directoryFetch,
    proxyHandler: (req, res) => {
      const path = req.originalUrl.split("?")[0] ?? req.path;
      proxyRequests.push({ path, headers: { ...req.headers } });
      const status = overrides.proxyStatus ?? 200;
      res.status(status).json({ proxied: true, path, operator: { id: path.split("/").pop() } });
    },
  });

  return {
    app,
    config,
    store,
    google,
    audit,
    mailer: memoryMailer,
    credentials,
    vault,
    revoker,
    proxyRequests,
    tokens: createSessionTokens(config),
  };
}

export function tokenHash(token: string): string {
  return sha256Hex(token);
}
