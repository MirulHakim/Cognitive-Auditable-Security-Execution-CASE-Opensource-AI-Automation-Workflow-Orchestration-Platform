import type {
  AuthStore,
  VaultSecretRecord,
  VaultSecretStatusRow,
} from "./store.js";
import {
  createSecretVault,
  type VaultProvider,
  vaultAad,
} from "./vault.js";

/**
 * Domain layer over the sealed rows: the only code that holds both the
 * ciphertext in Postgres and the plaintext in memory.
 *
 * Every operation takes the operator id explicitly. Browser routes always pass
 * `req.auth.operator.id`; only the internal route may name a different operator,
 * and only after presenting the pre-shared workflow-engine key.
 */

export type VaultStatus = Record<VaultProvider, boolean>;

export interface VaultConnectResult {
  provider: VaultProvider;
  connected: true;
  updatedAt: Date;
}

export interface RevealedVaultSecret {
  operatorId: string;
  provider: VaultProvider;
  /** Plaintext. Never log, cache, or include in an error. */
  secret: string;
  updatedAt: Date;
}

export interface VaultService {
  /** Status only. No ciphertext and no plaintext leaves this method. */
  status(operatorId: string): Promise<VaultStatus>;
  statusRows(operatorId: string): Promise<VaultSecretStatusRow[]>;
  connect(
    operatorId: string,
    provider: VaultProvider,
    plaintext: string,
  ): Promise<VaultConnectResult>;
  disconnect(operatorId: string, provider: VaultProvider): Promise<boolean>;
  /** Just-in-time decryption for the workflow engine. */
  reveal(
    operatorId: string,
    provider: VaultProvider,
  ): Promise<RevealedVaultSecret | null>;
}

export class VaultDecryptionError extends Error {
  constructor() {
    super("Stored vault secret could not be decrypted.");
    this.name = "VaultDecryptionError";
  }
}

export function createVaultService(deps: {
  store: AuthStore;
  masterKey: string;
  now?: () => Date;
}): VaultService {
  const crypto = createSecretVault(deps.masterKey);
  const now = deps.now ?? (() => new Date());

  function emptyStatus(): VaultStatus {
    return { telegram: false, gmail: false };
  }

  return {
    async status(operatorId) {
      const rows = await deps.store.listVaultSecretProviders(operatorId);
      const status = emptyStatus();
      for (const row of rows) status[row.provider] = true;
      return status;
    },

    statusRows(operatorId) {
      return deps.store.listVaultSecretProviders(operatorId);
    },

    async connect(operatorId, provider, plaintext) {
      const sealed = crypto.encrypt(plaintext, vaultAad(operatorId, provider));
      const updatedAt = await deps.store.upsertVaultSecret({
        operatorId,
        provider,
        cipherText: sealed.cipherText,
        iv: sealed.iv,
        authTag: sealed.authTag,
        at: now(),
      });
      return { provider, connected: true, updatedAt };
    },

    disconnect(operatorId, provider) {
      return deps.store.deleteVaultSecret(operatorId, provider);
    },

    async reveal(operatorId, provider) {
      const stored: VaultSecretRecord | null = await deps.store.findVaultSecret(
        operatorId,
        provider,
      );
      if (!stored) return null;

      let secret: string;
      try {
        secret = crypto.decrypt(
          {
            cipherText: stored.cipherText,
            iv: stored.iv,
            authTag: stored.authTag,
          },
          vaultAad(operatorId, provider),
        );
      } catch {
        // Wrong/rotated key, or a tampered/relocated row. The caller gets a
        // generic failure with no cryptographic detail and no partial value.
        throw new VaultDecryptionError();
      }

      return {
        operatorId,
        provider,
        secret,
        updatedAt: stored.updatedAt,
      };
    },
  };
}
