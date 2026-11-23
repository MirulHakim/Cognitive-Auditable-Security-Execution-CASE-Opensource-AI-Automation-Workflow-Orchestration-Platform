import type { GoogleTokenSet } from "./google.js";
import type { AuthStore } from "./store.js";
import type { TokenVault } from "./tokenVault.js";

/**
 * Bridges the store (opaque sealed envelopes) and the Google sender (plaintext
 * tokens). Nothing outside this module handles both representations, so there is
 * exactly one place where a credential exists in the clear — for the few
 * milliseconds it takes to hand it to the transport.
 */

export interface GoogleCredential {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface CredentialService {
  /** Called after a successful code exchange; never fails sign-in by itself. */
  saveFromExchange(googleSub: string, tokens: GoogleTokenSet): Promise<void>;
  load(operatorId: string): Promise<GoogleCredential | null>;
  updateAccessToken(
    operatorId: string,
    accessToken: string,
    expiresAt: Date | null,
  ): Promise<void>;
}

export function createCredentialService(deps: {
  store: AuthStore;
  vault: TokenVault;
}): CredentialService {
  return {
    async saveFromExchange(googleSub, tokens) {
      await deps.store.saveAccountTokens({
        googleSub,
        accessTokenEnc: tokens.accessToken ? deps.vault.seal(tokens.accessToken) : null,
        refreshTokenEnc: tokens.refreshToken ? deps.vault.seal(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
        scopes: tokens.scopes,
      });
    },

    async load(operatorId) {
      const stored = await deps.store.findAccountTokens(operatorId);
      if (!stored) return null;
      try {
        return {
          accessToken: stored.accessTokenEnc ? deps.vault.open(stored.accessTokenEnc) : null,
          refreshToken: stored.refreshTokenEnc
            ? deps.vault.open(stored.refreshTokenEnc)
            : null,
          expiresAt: stored.expiresAt,
          scopes: stored.scopes,
        };
      } catch (error) {
        // Wrong/rotated key, or a tampered envelope. Treat as "no delegation"
        // rather than crashing a login or an invite: the admin can simply sign
        // in again to re-seal fresh tokens.
        console.error(
          "[auth-gateway] stored Google tokens could not be opened:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async updateAccessToken(operatorId, accessToken, expiresAt) {
      await deps.store.updateAccountAccessToken({
        operatorId,
        accessTokenEnc: deps.vault.seal(accessToken),
        expiresAt,
      });
    },

  };
}
