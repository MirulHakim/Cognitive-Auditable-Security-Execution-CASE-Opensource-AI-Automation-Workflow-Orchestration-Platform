import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { Role } from "../auth/operators.js";
import { displayNameFromEmail } from "./names.js";
import { normalizeEmail } from "./tokens.js";
import type { VaultProvider } from "./vault.js";

/**
 * Data access for the gateway's own tables only. It reads `operators` because
 * that is the identity table the whole platform already uses; it never changes
 * the semantics of existing columns and never touches workflow tables.
 */

export interface OperatorRecord {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  revokedAt: Date | null;
}

export type ThemePreference = "light" | "dark" | "system";

/**
 * The signed-in member's editable profile. `themePreference` is null until the
 * person explicitly picks a theme; the browser-local choice is then kept.
 */
export interface ProfileRecord {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  contactNumber: string | null;
  themePreference: ThemePreference | null;
}

export interface InvitationRecord {
  invitationId: string;
  email: string;
  role: Role;
  /** Null once the inviting operator has been hard-deleted (migration 003). */
  invitedBy: string | null;
  workspaceId: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  acceptedOperatorId: string | null;
  revokedAt: Date | null;
}

export type ClaimInvitationResult =
  | { status: "ok"; invitation: InvitationRecord; operator: OperatorRecord }
  | { status: "invalid" | "expired" | "consumed" | "revoked" | "email_taken" };

export type RotateRefreshResult =
  | { status: "ok"; operatorId: string }
  | { status: "invalid" | "expired" | "reuse" };

/**
 * Google delegation material exactly as persisted: opaque sealed envelopes, no
 * plaintext tokens. Decryption belongs to credentials.ts, so a database read
 * path can never accidentally log a usable credential.
 */
export interface StoredGoogleCredentials {
  accessTokenEnc: string | null;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

/** One row of the presence projection: operator identity + last activity. */
/**
 * One sealed integration credential exactly as persisted. There is no plaintext
 * field: decryption belongs to vaultService.ts, so a careless read path cannot
 * accidentally log a usable token.
 */
export interface VaultSecretRecord {
  operatorId: string;
  provider: VaultProvider;
  cipherText: string;
  iv: string;
  authTag: string;
  updatedAt: Date;
}

export interface VaultSecretStatusRow {
  provider: VaultProvider;
  updatedAt: Date;
}

export interface PresenceRow {
  operatorId: string;
  displayName: string;
  role: Role;
  lastSeenAt: Date | null;
  isOnline: boolean;
}

export interface DeleteOperatorResult {
  /** False when the operator row did not exist. */
  deleted: boolean;
  accounts: number;
  refreshTokens: number;
  /** Invitation rows whose `invited_by` was cleared to allow the delete. */
  invitationsUnlinked: number;
}

export interface InvitationRow {
  invitation_id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  workspace_id: string;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  accepted_operator_id: string | null;
  revoked_at: Date | null;
}

const INVITATION_COLUMNS =
  "invitation_id, email, role, invited_by, workspace_id, created_at, expires_at, consumed_at, accepted_operator_id, revoked_at";

const OPERATOR_COLUMNS = "operator_id, display_name, email, role, revoked_at";

function toOperator(row: {
  operator_id: string;
  display_name: string;
  email: string;
  role: Role;
  revoked_at: Date | null;
}): OperatorRecord {
  return {
    id: row.operator_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role,
    revokedAt: row.revoked_at,
  };
}

function toInvitation(row: InvitationRow): InvitationRecord {
  return {
    invitationId: row.invitation_id,
    email: row.email,
    role: row.role,
    invitedBy: row.invited_by,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    acceptedOperatorId: row.accepted_operator_id,
    revokedAt: row.revoked_at,
  };
}

export interface AuthStore {
  findOperatorById(id: string): Promise<OperatorRecord | null>;
  findOperatorByEmail(email: string): Promise<OperatorRecord | null>;
  findAccountByGoogleSub(
    googleSub: string,
  ): Promise<{ accountId: string; operator: OperatorRecord } | null>;
  countOperators(): Promise<number>;
  bootstrapRootAdmin(input: {
    googleSub: string;
    email: string;
    displayName: string;
    workspaceId: string;
  }): Promise<{ created: boolean; operator: OperatorRecord | null }>;
  linkAccount(input: {
    googleSub: string;
    operatorId: string;
    email: string;
  }): Promise<OperatorRecord | null>;
  touchAccount(googleSub: string, email: string): Promise<void>;
  createInvitation(input: {
    email: string;
    role: Role;
    invitedBy: string;
    workspaceId: string;
    tokenHash: string;
    createdAt: Date;
    expiresAt: Date;
  }): Promise<InvitationRecord>;
  listInvitations(limit?: number): Promise<InvitationRecord[]>;
  findInvitationById(invitationId: string): Promise<InvitationRecord | null>;
  revokeInvitation(invitationId: string): Promise<void>;
  /**
   * Withdraws a still-pending invitation. Atomic so two admins cannot both
   * report a withdrawal, and returns the updated row for the audit trail.
   */
  withdrawInvitation(
    invitationId: string,
    at: Date,
  ): Promise<InvitationRecord | null>;
  claimInvitation(input: {
    tokenHash: string;
    now: Date;
    workspaceId: string;
  }): Promise<ClaimInvitationResult>;
  createRefreshToken(input: {
    tokenHash: string;
    operatorId: string;
    expiresAt: Date;
  }): Promise<void>;
  rotateRefreshToken(input: {
    oldTokenHash: string;
    newTokenHash: string;
    newExpiresAt: Date;
    now: Date;
  }): Promise<RotateRefreshResult>;
  /** Revokes one refresh token; returns its owner so logout can be audited. */
  revokeRefreshToken(tokenHash: string): Promise<string | null>;

  /** Editable profile, read from `operators` + the account's theme choice. */
  findProfile(operatorId: string): Promise<ProfileRecord | null>;
  /**
   * Updates only the supplied fields. The operator id always comes from the
   * verified session, never from the request body.
   */
  updateProfile(
    operatorId: string,
    input: { displayName?: string; contactNumber?: string | null },
  ): Promise<ProfileRecord | null>;
  /** Updates an existing Google link; false when the member has none yet. */
  setThemePreference(
    operatorId: string,
    theme: ThemePreference,
  ): Promise<boolean>;

  /** Records activity and marks online. No-op when no account row exists. */
  touchPresence(operatorId: string, at: Date): Promise<void>;
  /** Marks offline without moving last_seen_at, so logout is immediate. */
  setPresenceOffline(operatorId: string): Promise<void>;

  /** Active (non-revoked) members with their last known activity. */
  listPresence(): Promise<PresenceRow[]>;

  /** Sealed secret for one operator/provider, or null when not connected. */
  findVaultSecret(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<VaultSecretRecord | null>;

  /** Providers with a vault row, used for the status-only browser response. */
  listVaultSecretProviders(operatorId: string): Promise<VaultSecretStatusRow[]>;

  /**
   * Inserts or rotates the one secret for this operator/provider. The database
   * primary key is what makes "one active secret per provider" true under
   * concurrent requests, not a read-before-write in the route.
   */
  upsertVaultSecret(input: {
    operatorId: string;
    provider: VaultProvider;
    cipherText: string;
    iv: string;
    authTag: string;
    at: Date;
  }): Promise<Date>;

  /** False when there was nothing to delete (idempotent disconnect). */
  deleteVaultSecret(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<boolean>;

  /**
   * Hard delete: clears the operator's invitation references, then removes its
   * auth_accounts, auth_refresh_tokens and finally the operators row, in one
   * transaction. Historical rows that reference the operator are SET NULL by
   * the base schema, so templates and runs survive unnamed rather than broken.
   */
  deleteOperator(operatorId: string): Promise<DeleteOperatorResult>;

  /**
   * Persist the tokens from a completed OAuth exchange.
   *
   * `refreshTokenEnc` is only stored when Google actually returned a refresh
   * token; a null here must keep the previously stored one (repeat sign-ins
   * normally omit it).
   */
  saveAccountTokens(input: {
    googleSub: string;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    expiresAt: Date | null;
    scopes: string[];
  }): Promise<void>;
  findAccountTokens(operatorId: string): Promise<StoredGoogleCredentials | null>;
  updateAccountAccessToken(input: {
    operatorId: string;
    accessTokenEnc: string;
    expiresAt: Date | null;
  }): Promise<void>;
  /**
   * Destroy every credential the gateway holds for a member: the Google
   * identity link (including its delegated tokens) and all refresh tokens.
   * The `operators` row itself is intentionally NOT touched — it is the audit
   * identity that templates, runs and reviews still reference.
   */
  purgeCredentials(operatorId: string): Promise<{
    accounts: number;
    refreshTokens: number;
  }>;
  /** Revoked members that still have gateway credentials, oldest first. */
  listRevokedOperatorsWithCredentials(limit?: number): Promise<string[]>;
}

const BOOTSTRAP_LOCK_KEY = 728_931_402;

export class PostgresAuthStore implements AuthStore {
  constructor(private readonly pool: Pool) {}

  async findOperatorById(id: string): Promise<OperatorRecord | null> {
    const result = await this.pool.query(
      `SELECT ${OPERATOR_COLUMNS} FROM operators WHERE operator_id = $1`,
      [id],
    );
    const row = result.rows[0];
    return row ? toOperator(row) : null;
  }

  async findOperatorByEmail(email: string): Promise<OperatorRecord | null> {
    const result = await this.pool.query(
      `SELECT ${OPERATOR_COLUMNS} FROM operators WHERE lower(email) = lower($1) LIMIT 1`,
      [normalizeEmail(email)],
    );
    const row = result.rows[0];
    return row ? toOperator(row) : null;
  }

  async findAccountByGoogleSub(
    googleSub: string,
  ): Promise<{ accountId: string; operator: OperatorRecord } | null> {
    const result = await this.pool.query(
      `SELECT a.account_id, ${OPERATOR_COLUMNS.split(", ")
        .map((column) => `o.${column}`)
        .join(", ")}
         FROM auth_accounts a
         JOIN operators o ON o.operator_id = a.operator_id
        WHERE a.google_sub = $1`,
      [googleSub],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { accountId: row.account_id, operator: toOperator(row) };
  }

  async countOperators(): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM operators",
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async bootstrapRootAdmin(input: {
    googleSub: string;
    email: string;
    displayName: string;
    workspaceId: string;
  }): Promise<{ created: boolean; operator: OperatorRecord | null }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise the first-run check so two simultaneous callbacks cannot both
      // become root admin. This lock is local to the gateway and harmless to
      // the existing server's audit lock.
      await client.query("SELECT pg_advisory_xact_lock($1)", [BOOTSTRAP_LOCK_KEY]);

      const count = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM operators",
      );
      if (Number(count.rows[0]?.count ?? 0) > 0) {
        await client.query("COMMIT");
        return { created: false, operator: null };
      }

      const operatorId = randomUUID();
      const inserted = await client.query(
        `INSERT INTO operators (operator_id, display_name, email, role)
         VALUES ($1, $2, $3, 'admin')
         RETURNING ${OPERATOR_COLUMNS}`,
        [operatorId, input.displayName, normalizeEmail(input.email)],
      );
      const row = inserted.rows[0];
      if (!row) throw new Error("Root admin insert returned no row.");

      await client.query(
        `INSERT INTO auth_accounts (account_id, operator_id, google_sub, email, email_verified)
         VALUES ($1, $2, $3, $4, TRUE)`,
        [randomUUID(), operatorId, input.googleSub, normalizeEmail(input.email)],
      );

      await client.query("COMMIT");
      return { created: true, operator: toOperator(row) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async linkAccount(input: {
    googleSub: string;
    operatorId: string;
    email: string;
  }): Promise<OperatorRecord | null> {
    // A Google subject can only ever point at one operator. If a concurrent
    // callback linked it first, the second insert is a no-op and we re-read.
    await this.pool.query(
      `INSERT INTO auth_accounts (account_id, operator_id, google_sub, email, email_verified)
       VALUES ($1, $2, $3, $4, TRUE)
       ON CONFLICT (google_sub) DO NOTHING`,
      [randomUUID(), input.operatorId, input.googleSub, normalizeEmail(input.email)],
    );
    const linked = await this.findAccountByGoogleSub(input.googleSub);
    if (!linked || linked.operator.id !== input.operatorId) return null;
    return linked.operator;
  }

  async touchAccount(googleSub: string, email: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_accounts
          SET last_login_at = now(), email = $2
        WHERE google_sub = $1`,
      [googleSub, normalizeEmail(email)],
    );
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // One live invitation per email: re-inviting the same address invalidates
      // the previous magic link instead of leaving two valid tokens around.
      await client.query(
        `UPDATE auth_invitations
            SET revoked_at = $2
          WHERE lower(email) = lower($1)
            AND consumed_at IS NULL
            AND revoked_at IS NULL`,
        [normalizeEmail(input.email), input.createdAt],
      );
      const result = await client.query(
        `INSERT INTO auth_invitations
           (invitation_id, email, role, invited_by, workspace_id, token_hash, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${INVITATION_COLUMNS}`,
        [
          randomUUID(),
          normalizeEmail(input.email),
          input.role,
          input.invitedBy,
          input.workspaceId,
          input.tokenHash,
          input.createdAt,
          input.expiresAt,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error("Invitation insert returned no row.");
      await client.query("COMMIT");
      return toInvitation(row);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listInvitations(limit = 100): Promise<InvitationRecord[]> {
    const result = await this.pool.query(
      `SELECT ${INVITATION_COLUMNS}
         FROM auth_invitations
        ORDER BY created_at DESC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 200)],
    );
    return result.rows.map(toInvitation);
  }

  async findInvitationById(invitationId: string): Promise<InvitationRecord | null> {
    const result = await this.pool.query(
      `SELECT ${INVITATION_COLUMNS}
         FROM auth_invitations
        WHERE invitation_id = $1`,
      [invitationId],
    );
    const row = result.rows[0] as InvitationRow | undefined;
    return row ? toInvitation(row) : null;
  }

  async revokeInvitation(invitationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_invitations
          SET revoked_at = now()
        WHERE invitation_id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL`,
      [invitationId],
    );
  }

  async withdrawInvitation(
    invitationId: string,
    at: Date,
  ): Promise<InvitationRecord | null> {
    const result = await this.pool.query(
      `UPDATE auth_invitations
          SET revoked_at = $2
        WHERE invitation_id = $1
          AND consumed_at IS NULL
          AND revoked_at IS NULL
        RETURNING ${INVITATION_COLUMNS}`,
      [invitationId, at],
    );
    const row = result.rows[0] as InvitationRow | undefined;
    return row ? toInvitation(row) : null;
  }

  async claimInvitation(input: {
    tokenHash: string;
    now: Date;
    workspaceId: string;
  }): Promise<ClaimInvitationResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query(
        `SELECT ${INVITATION_COLUMNS}
           FROM auth_invitations
          WHERE token_hash = $1
          FOR UPDATE`,
        [input.tokenHash],
      );
      const row = found.rows[0] as InvitationRow | undefined;
      if (!row) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }
      const invitation = toInvitation(row);
      if (invitation.revokedAt) {
        await client.query("ROLLBACK");
        return { status: "revoked" };
      }
      if (invitation.consumedAt) {
        await client.query("ROLLBACK");
        return { status: "consumed" };
      }
      if (invitation.expiresAt.getTime() <= input.now.getTime()) {
        await client.query("ROLLBACK");
        return { status: "expired" };
      }
      if (invitation.workspaceId !== input.workspaceId) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }

      const existing = await client.query(
        "SELECT 1 FROM operators WHERE lower(email) = lower($1) LIMIT 1",
        [invitation.email],
      );
      if ((existing.rowCount ?? 0) > 0) {
        await client.query("ROLLBACK");
        return { status: "email_taken" };
      }

      const operatorId = randomUUID();
      // Same derivation the pending row used, so accepting does not rename the
      // person from "Farid Hakim" back to "farid.hakim".
      const displayName = displayNameFromEmail(invitation.email);
      const operator = await client.query(
        `INSERT INTO operators (operator_id, display_name, email, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${OPERATOR_COLUMNS}`,
        [operatorId, displayName, invitation.email, invitation.role],
      );
      const operatorRow = operator.rows[0];
      if (!operatorRow) throw new Error("Operator insert returned no row.");

      await client.query(
        `UPDATE auth_invitations
            SET consumed_at = $2, accepted_operator_id = $3
          WHERE invitation_id = $1`,
        [invitation.invitationId, input.now, operatorId],
      );

      await client.query("COMMIT");
      return {
        status: "ok",
        invitation: { ...invitation, consumedAt: input.now, acceptedOperatorId: operatorId },
        operator: toOperator(operatorRow),
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      // Unique email race: another acceptance created the operator first.
      if ((error as { code?: string }).code === "23505") return { status: "email_taken" };
      throw error;
    } finally {
      client.release();
    }
  }

  async createRefreshToken(input: {
    tokenHash: string;
    operatorId: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO auth_refresh_tokens (token_id, operator_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), input.operatorId, input.tokenHash, input.expiresAt],
    );
  }

  async rotateRefreshToken(input: {
    oldTokenHash: string;
    newTokenHash: string;
    newExpiresAt: Date;
    now: Date;
  }): Promise<RotateRefreshResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const found = await client.query<{
        token_id: string;
        operator_id: string;
        expires_at: Date;
        revoked_at: Date | null;
      }>(
        `SELECT token_id, operator_id, expires_at, revoked_at
           FROM auth_refresh_tokens
          WHERE token_hash = $1
          FOR UPDATE`,
        [input.oldTokenHash],
      );
      const row = found.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return { status: "invalid" };
      }

      if (row.revoked_at) {
        // A rotated token presented again means the cookie was replayed. Kill
        // every live refresh token for that operator and force a new sign-in.
        await client.query(
          `UPDATE auth_refresh_tokens
              SET revoked_at = $2
            WHERE operator_id = $1 AND revoked_at IS NULL`,
          [row.operator_id, input.now],
        );
        await client.query("COMMIT");
        return { status: "reuse" };
      }

      if (row.expires_at.getTime() <= input.now.getTime()) {
        await client.query("ROLLBACK");
        return { status: "expired" };
      }

      await client.query(
        `UPDATE auth_refresh_tokens SET revoked_at = $2 WHERE token_id = $1`,
        [row.token_id, input.now],
      );
      await client.query(
        `INSERT INTO auth_refresh_tokens (token_id, operator_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4)`,
        [randomUUID(), row.operator_id, input.newTokenHash, input.newExpiresAt],
      );
      await client.query("COMMIT");
      return { status: "ok", operatorId: row.operator_id };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeRefreshToken(tokenHash: string): Promise<string | null> {
    const result = await this.pool.query<{ operator_id: string }>(
      `UPDATE auth_refresh_tokens SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL
        RETURNING operator_id`,
      [tokenHash],
    );
    return result.rows[0]?.operator_id ?? null;
  }

  async findProfile(operatorId: string): Promise<ProfileRecord | null> {
    const result = await this.pool.query<{
      operator_id: string;
      display_name: string;
      email: string;
      role: Role;
      contact_number: string | null;
      theme_preference: ThemePreference | null;
    }>(
      `SELECT o.operator_id, o.display_name, o.email, o.role, o.contact_number,
              a.theme_preference
         FROM operators o
         LEFT JOIN auth_accounts a ON a.operator_id = o.operator_id
        WHERE o.operator_id = $1`,
      [operatorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.operator_id,
      displayName: row.display_name,
      email: row.email,
      role: row.role,
      contactNumber: row.contact_number,
      themePreference: row.theme_preference,
    };
  }

  async updateProfile(
    operatorId: string,
    input: { displayName?: string; contactNumber?: string | null },
  ): Promise<ProfileRecord | null> {
    if (input.displayName !== undefined) {
      await this.pool.query(
        "UPDATE operators SET display_name = $2 WHERE operator_id = $1",
        [operatorId, input.displayName],
      );
    }
    if (input.contactNumber !== undefined) {
      await this.pool.query(
        "UPDATE operators SET contact_number = $2 WHERE operator_id = $1",
        [operatorId, input.contactNumber],
      );
    }
    return this.findProfile(operatorId);
  }

  async setThemePreference(
    operatorId: string,
    theme: ThemePreference,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE auth_accounts SET theme_preference = $2 WHERE operator_id = $1",
      [operatorId, theme],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async touchPresence(operatorId: string, at: Date): Promise<void> {
    await this.pool.query(
      `UPDATE auth_accounts
          SET last_seen_at = $2, is_online = TRUE
        WHERE operator_id = $1`,
      [operatorId, at],
    );
  }

  async setPresenceOffline(operatorId: string): Promise<void> {
    await this.pool.query(
      `UPDATE auth_accounts SET is_online = FALSE WHERE operator_id = $1`,
      [operatorId],
    );
  }

  async listPresence(): Promise<PresenceRow[]> {
    const result = await this.pool.query<{
      operator_id: string;
      display_name: string;
      role: Role;
      last_seen_at: Date | null;
      is_online: boolean;
    }>(
      `SELECT o.operator_id, o.display_name, o.role,
              a.last_seen_at, COALESCE(a.is_online, FALSE) AS is_online
         FROM operators o
         LEFT JOIN auth_accounts a ON a.operator_id = o.operator_id
        WHERE o.revoked_at IS NULL
        ORDER BY lower(o.display_name), o.operator_id`,
    );
    return result.rows.map((row) => ({
      operatorId: row.operator_id,
      displayName: row.display_name,
      role: row.role,
      lastSeenAt: row.last_seen_at,
      isOnline: row.is_online,
    }));
  }

  async findVaultSecret(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<VaultSecretRecord | null> {
    const result = await this.pool.query<{
      operator_id: string;
      provider: VaultProvider;
      cipher_text: string;
      iv: string;
      auth_tag: string;
      updated_at: Date;
    }>(
      `SELECT operator_id, provider, cipher_text, iv, auth_tag, updated_at
         FROM auth_vault_secrets
        WHERE operator_id = $1 AND provider = $2`,
      [operatorId, provider],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      operatorId: row.operator_id,
      provider: row.provider,
      cipherText: row.cipher_text,
      iv: row.iv,
      authTag: row.auth_tag,
      updatedAt: row.updated_at,
    };
  }

  async listVaultSecretProviders(
    operatorId: string,
  ): Promise<VaultSecretStatusRow[]> {
    const result = await this.pool.query<{
      provider: VaultProvider;
      updated_at: Date;
    }>(
      `SELECT provider, updated_at
         FROM auth_vault_secrets
        WHERE operator_id = $1
        ORDER BY provider`,
      [operatorId],
    );
    return result.rows.map((row) => ({
      provider: row.provider,
      updatedAt: row.updated_at,
    }));
  }

  async upsertVaultSecret(input: {
    operatorId: string;
    provider: VaultProvider;
    cipherText: string;
    iv: string;
    authTag: string;
    at: Date;
  }): Promise<Date> {
    const result = await this.pool.query<{ updated_at: Date }>(
      `INSERT INTO auth_vault_secrets
         (operator_id, provider, cipher_text, iv, auth_tag, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $6)
       ON CONFLICT (operator_id, provider) DO UPDATE
         SET cipher_text = EXCLUDED.cipher_text,
             iv = EXCLUDED.iv,
             auth_tag = EXCLUDED.auth_tag,
             updated_at = EXCLUDED.updated_at
       RETURNING updated_at`,
      [
        input.operatorId,
        input.provider,
        input.cipherText,
        input.iv,
        input.authTag,
        input.at,
      ],
    );
    return result.rows[0]?.updated_at ?? input.at;
  }

  async deleteVaultSecret(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM auth_vault_secrets WHERE operator_id = $1 AND provider = $2",
      [operatorId, provider],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async deleteOperator(operatorId: string): Promise<DeleteOperatorResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // RESTRICT is the only blocker left; clearing it is also what preserves
      // the invitation history instead of losing rows to a cascade.
      const unlinked = await client.query(
        "UPDATE auth_invitations SET invited_by = NULL WHERE invited_by = $1",
        [operatorId],
      );
      const accounts = await client.query(
        "DELETE FROM auth_accounts WHERE operator_id = $1",
        [operatorId],
      );
      const refreshTokens = await client.query(
        "DELETE FROM auth_refresh_tokens WHERE operator_id = $1",
        [operatorId],
      );
      const operator = await client.query(
        "DELETE FROM operators WHERE operator_id = $1 RETURNING operator_id",
        [operatorId],
      );

      await client.query("COMMIT");
      return {
        deleted: (operator.rowCount ?? 0) > 0,
        accounts: accounts.rowCount ?? 0,
        refreshTokens: refreshTokens.rowCount ?? 0,
        invitationsUnlinked: unlinked.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAccountTokens(input: {
    googleSub: string;
    accessTokenEnc: string | null;
    refreshTokenEnc: string | null;
    expiresAt: Date | null;
    scopes: string[];
  }): Promise<void> {
    const result = await this.pool.query(
      `UPDATE auth_accounts
          SET oauth_access_token = COALESCE($2, oauth_access_token),
              oauth_refresh_token = COALESCE($3, oauth_refresh_token),
              oauth_token_expires_at = $4,
              oauth_scopes = CASE
                WHEN cardinality($5::text[]) > 0 THEN $5::text[]
                ELSE oauth_scopes
              END
        WHERE google_sub = $1
        RETURNING account_id`,
      [
        input.googleSub,
        input.accessTokenEnc,
        input.refreshTokenEnc,
        input.expiresAt,
        input.scopes,
      ],
    );
    if ((result.rowCount ?? 0) === 0) {
      throw new Error(
        `[auth-gateway] cannot store Google tokens: no auth_accounts row for sub ${input.googleSub}.`,
      );
    }
  }

  async findAccountTokens(
    operatorId: string,
  ): Promise<StoredGoogleCredentials | null> {
    const result = await this.pool.query<{
      oauth_access_token: string | null;
      oauth_refresh_token: string | null;
      oauth_token_expires_at: Date | null;
      oauth_scopes: string[] | null;
    }>(
      `SELECT oauth_access_token, oauth_refresh_token, oauth_token_expires_at, oauth_scopes
         FROM auth_accounts
        WHERE operator_id = $1`,
      [operatorId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      accessTokenEnc: row.oauth_access_token,
      refreshTokenEnc: row.oauth_refresh_token,
      expiresAt: row.oauth_token_expires_at,
      scopes: row.oauth_scopes ?? [],
    };
  }

  async updateAccountAccessToken(input: {
    operatorId: string;
    accessTokenEnc: string;
    expiresAt: Date | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE auth_accounts
          SET oauth_access_token = $2, oauth_token_expires_at = $3
        WHERE operator_id = $1`,
      [input.operatorId, input.accessTokenEnc, input.expiresAt],
    );
  }

  async purgeCredentials(
    operatorId: string,
  ): Promise<{ accounts: number; refreshTokens: number }> {
    const client = await this.pool.connect();
    try {
      // One transaction: a half-purged member would be able to refresh but not
      // sign in (or the reverse), which is harder to reason about than either.
      await client.query("BEGIN");
      const accounts = await client.query(
        "DELETE FROM auth_accounts WHERE operator_id = $1",
        [operatorId],
      );
      const refreshTokens = await client.query(
        "DELETE FROM auth_refresh_tokens WHERE operator_id = $1",
        [operatorId],
      );
      // Integration credentials are just as sensitive as refresh tokens: a
      // revoked member must not leave a usable Telegram bot token behind.
      await client.query(
        "DELETE FROM auth_vault_secrets WHERE operator_id = $1",
        [operatorId],
      );
      await client.query("COMMIT");
      return {
        accounts: accounts.rowCount ?? 0,
        refreshTokens: refreshTokens.rowCount ?? 0,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async listRevokedOperatorsWithCredentials(limit = 200): Promise<string[]> {
    const result = await this.pool.query<{ operator_id: string }>(
      `SELECT o.operator_id
         FROM operators o
        WHERE o.revoked_at IS NOT NULL
          AND (
            EXISTS (SELECT 1 FROM auth_accounts a WHERE a.operator_id = o.operator_id)
            OR EXISTS (SELECT 1 FROM auth_refresh_tokens r WHERE r.operator_id = o.operator_id)
            OR EXISTS (SELECT 1 FROM auth_vault_secrets v WHERE v.operator_id = o.operator_id)
          )
        ORDER BY o.revoked_at ASC
        LIMIT $1`,
      [Math.min(Math.max(limit, 1), 1000)],
    );
    return result.rows.map((row) => row.operator_id);
  }
}

