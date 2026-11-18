import type { RequestHandler } from "express";
import type { AuthStore } from "./store.js";

/**
 * Credential destruction on revocation.
 *
 * The legacy API revokes access with a soft delete (`operators.revoked_at`),
 * because template/run/review rows reference the operator and must keep a real
 * name. That is the right call for *history*, but it means the gateway would
 * otherwise keep holding the person's Google identity link, their delegated
 * Gmail tokens and their refresh tokens — credentials for someone who is no
 * longer allowed in.
 *
 * So revocation is completed here, without modifying the legacy route:
 *   - immediately, when the proxied `DELETE /api/operators/:id` succeeds;
 *   - and by a sweep, which catches revocations performed out of band (another
 *     admin tool, SQL, a restored backup) and never depends on the proxy path.
 *
 * What is deleted: `auth_accounts` (google_sub + sealed tokens) and
 * `auth_refresh_tokens`. What is kept: the `operators` row, so the audit trail
 * and every historical reference still resolve to a name.
 *
 * Access is already blocked independently: the auth middleware re-reads the
 * operator on every request and returns 403 ACCESS_REVOKED when revoked_at is
 * set, and a purged member can no longer re-link, because sign-in finds no
 * account and falls through to the revoked operator by email.
 */

export interface PurgeResult {
  accounts: number;
  refreshTokens: number;
}

export interface SweepResult extends PurgeResult {
  operators: string[];
}

export interface CredentialRevoker {
  purge(operatorId: string): Promise<PurgeResult>;
  sweep(): Promise<SweepResult>;
}

export type RevocationLog = (message: string) => void;

const defaultLog: RevocationLog = (message) => console.log(message);

export function createCredentialRevoker(deps: {
  store: AuthStore;
  log?: RevocationLog;
}): CredentialRevoker {
  const log = deps.log ?? defaultLog;

  async function purge(operatorId: string): Promise<PurgeResult> {
    const result = await deps.store.purgeCredentials(operatorId);
    if (result.accounts > 0 || result.refreshTokens > 0) {
      log(
        `[auth-gateway] credentials purged for revoked member ${operatorId}: ` +
          `${result.accounts} identity link(s), ${result.refreshTokens} refresh token(s)`,
      );
    }
    return result;
  }

  return {
    purge,

    async sweep() {
      const operators = await deps.store.listRevokedOperatorsWithCredentials();
      const totals: SweepResult = { operators: [], accounts: 0, refreshTokens: 0 };
      for (const operatorId of operators) {
        try {
          const purged = await purge(operatorId);
          totals.accounts += purged.accounts;
          totals.refreshTokens += purged.refreshTokens;
          totals.operators.push(operatorId);
        } catch (error) {
          // One bad row must not stop the others from being cleaned.
          log(
            `[auth-gateway] credential purge failed for ${operatorId}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        }
      }
      return totals;
    },
  };
}

/** `DELETE /api/operators/<id>` — the legacy route this gateway proxies. */
const REVOKE_PATH = /^\/api\/operators\/([A-Za-z0-9._-]{1,64})\/?$/;

/**
 * Mounts after authentication and before the proxy. Purging only happens when
 * the legacy API actually answered 2xx — a rejected revoke (own account, admin
 * target, already revoked) must not touch credentials.
 */
export function createCredentialPurgeHook(deps: {
  revoker: CredentialRevoker;
  log?: RevocationLog;
}): RequestHandler {
  const log = deps.log ?? defaultLog;

  return (req, res, next) => {
    if (req.method !== "DELETE") return next();
    const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
    const match = REVOKE_PATH.exec(path);
    if (!match) return next();

    const operatorId = decodeURIComponent(match[1]!);
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void deps.revoker
        .purge(operatorId)
        .catch((error: unknown) => {
          log(
            `[auth-gateway] credential purge failed for ${operatorId}: ` +
              (error instanceof Error ? error.message : String(error)),
          );
        });
    });
    next();
  };
}
