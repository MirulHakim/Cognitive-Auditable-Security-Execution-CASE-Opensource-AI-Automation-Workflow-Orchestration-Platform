import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * User-scoped secret vault: AES-256-GCM with the native `crypto` module.
 *
 * This is deliberately separate from tokenVault.ts. That one seals delegated
 * Google OAuth tokens behind a key derived from AUTH_TOKEN_ENCRYPTION_KEY;
 * this one protects credentials an operator pastes in (Telegram bot token,
 * Gmail app password) behind a dedicated 32-byte VAULT_MASTER_KEY.
 *
 * Properties that matter:
 *  - AES-256-GCM is authenticated encryption. A single flipped bit in the
 *    ciphertext, IV or auth tag makes decryption fail loudly instead of
 *    returning attacker-controlled plaintext.
 *  - Every encryption uses a fresh 96-bit IV. Reusing an IV with the same key
 *    would be catastrophic for GCM, so the caller never supplies one.
 *  - AAD binds a row to its owner and provider. Copying a valid ciphertext to
 *    another operator's row (a database-level attack) fails to decrypt,
 *    because the recipient derives different additional data.
 *  - Plaintext exists only in memory, for the duration of one request.
 *
 * Stored representation is three separate columns (cipher_text, iv, auth_tag),
 * all base64. They must be stored and read together; the auth tag is part of
 * the secret, not optional metadata.
 */

const ALGORITHM = "aes-256-gcm";
export const VAULT_KEY_BYTES = 32;
export const VAULT_IV_BYTES = 12;
export const VAULT_TAG_BYTES = 16;
/** Hard cap for one pasted credential (Telegram tokens are ~46 chars). */
export const VAULT_MAX_PLAINTEXT_BYTES = 4096;

export interface EncryptedSecret {
  /** Base64 AES-256-GCM ciphertext (no tag; it lives in authTag). */
  cipherText: string;
  /** Base64 12-byte initialization vector, unique per encryption. */
  iv: string;
  /** Base64 16-byte GCM authentication tag. */
  authTag: string;
}

export interface SecretVault {
  encrypt(plaintext: string, aad?: string): EncryptedSecret;
  /** Throws when the payload was tampered with or sealed for something else. */
  decrypt(secret: EncryptedSecret, aad?: string): string;
}

/**
 * Accept the common ways a 32-byte key is put in .env:
 *   - 64 hex characters                     (openssl rand -hex 32)
 *   - base64 / base64url encoding of 32 bytes (openssl rand -base64 32)
 *   - exactly 32 raw UTF-8 bytes
 *
 * Everything else is rejected at startup. Silently hashing a short password
 * would make the vault look protected while the key space is tiny.
 */
export function decodeVaultMasterKey(material: string): Buffer {
  const trimmed = material.trim();
  if (!trimmed) {
    throw new Error(
      "[auth-gateway] VAULT_MASTER_KEY is required (32 bytes; generate with `openssl rand -base64 32`).",
    );
  }

  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  for (const encoding of ["base64", "base64url"] as const) {
    const decoded = Buffer.from(trimmed, encoding);
    if (decoded.length === VAULT_KEY_BYTES) return decoded;
  }

  const raw = Buffer.from(trimmed, "utf8");
  if (raw.length === VAULT_KEY_BYTES) return raw;

  throw new Error(
    "[auth-gateway] VAULT_MASTER_KEY must decode to exactly 32 bytes " +
      "(64 hex chars, base64 of 32 bytes, or 32 raw characters).",
  );
}

function aadBuffer(aad: string | undefined): Buffer | null {
  return aad && aad.length > 0 ? Buffer.from(aad, "utf8") : null;
}

export function createSecretVault(masterKey: string): SecretVault {
  const key = decodeVaultMasterKey(masterKey);

  return {
    encrypt(plaintext, aad) {
      const bytes = Buffer.byteLength(plaintext, "utf8");
      if (bytes === 0) {
        throw new Error("[auth-gateway] refusing to seal an empty vault secret.");
      }
      if (bytes > VAULT_MAX_PLAINTEXT_BYTES) {
        throw new Error(
          `[auth-gateway] vault secret exceeds ${VAULT_MAX_PLAINTEXT_BYTES} bytes.`,
        );
      }

      const iv = randomBytes(VAULT_IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv, {
        authTagLength: VAULT_TAG_BYTES,
      });
      const additional = aadBuffer(aad);
      if (additional) cipher.setAAD(additional);

      const cipherText = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      return {
        cipherText: cipherText.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
      };
    },

    decrypt(secret, aad) {
      const iv = Buffer.from(secret.iv, "base64");
      const authTag = Buffer.from(secret.authTag, "base64");
      if (iv.length !== VAULT_IV_BYTES) {
        throw new Error("[auth-gateway] malformed vault IV.");
      }
      if (authTag.length !== VAULT_TAG_BYTES) {
        throw new Error("[auth-gateway] malformed vault authentication tag.");
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv, {
        authTagLength: VAULT_TAG_BYTES,
      });
      const additional = aadBuffer(aad);
      if (additional) decipher.setAAD(additional);
      decipher.setAuthTag(authTag);

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(secret.cipherText, "base64")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}

/** Stable AAD for one operator/provider pair; never persisted separately. */
export function vaultAad(operatorId: string, provider: string): string {
  return `auth-vault:v1:${operatorId}:${provider}`;
}

export const VAULT_PROVIDERS = ["telegram", "gmail"] as const;
export type VaultProvider = (typeof VAULT_PROVIDERS)[number];

export function isVaultProvider(value: string): value is VaultProvider {
  return (VAULT_PROVIDERS as readonly string[]).includes(value);
}
