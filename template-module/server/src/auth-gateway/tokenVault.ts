import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Symmetric sealing for the Google tokens delegated to the gateway.
 *
 * AES-256-GCM is authenticated encryption: a modified ciphertext, IV or tag
 * fails to open instead of decrypting into garbage that we would then hand to
 * Google. Each seal uses a fresh 96-bit IV, which is the size GCM is specified
 * for and is safe without extra care about counter collisions.
 *
 * Envelope format (single TEXT column, dot-separated, base64url parts):
 *     v1.<iv>.<tag>.<ciphertext>
 * The version prefix lets a future key rotation or algorithm change read old
 * rows instead of rendering them undecryptable.
 */

const PREFIX = "v1";
const IV_BYTES = 12;
const ALGORITHM = "aes-256-gcm";
const MIN_MATERIAL_LENGTH = 16;

export interface TokenVault {
  seal(plaintext: string): string;
  /** Throws when the envelope is malformed, tampered with, or sealed with another key. */
  open(sealed: string): string;
}

/**
 * Derive the 32-byte key with HKDF so any sufficiently long secret can be used
 * as key material. `AUTH_TOKEN_ENCRYPTION_KEY` is preferred; the gateway falls
 * back to the JWT secret in development, where a separate key is often noise.
 * The salt/info pair is stable, so restarts derive the same key.
 */
function deriveKey(material: string): Buffer {
  const trimmed = material.trim();
  if (trimmed.length < MIN_MATERIAL_LENGTH) {
    throw new Error(
      `[auth-gateway] token vault key material must be at least ${MIN_MATERIAL_LENGTH} characters (set AUTH_TOKEN_ENCRYPTION_KEY).`,
    );
  }
  const derived = hkdfSync(
    "sha256",
    Buffer.from(trimmed, "utf8"),
    Buffer.from("case-auth-gateway", "utf8"),
    Buffer.from("google-token-vault:v1", "utf8"),
    32,
  );
  return Buffer.from(derived);
}

export function createTokenVault(material: string): TokenVault {
  const key = deriveKey(material);

  return {
    seal(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        PREFIX,
        iv.toString("base64url"),
        tag.toString("base64url"),
        ciphertext.toString("base64url"),
      ].join(".");
    },

    open(sealed) {
      const parts = sealed.split(".");
      if (parts.length !== 4 || parts[0] !== PREFIX) {
        throw new Error("[auth-gateway] unrecognised token envelope.");
      }
      const [, ivPart, tagPart, ciphertextPart] = parts as [
        string,
        string,
        string,
        string,
      ];
      const iv = Buffer.from(ivPart, "base64url");
      const tag = Buffer.from(tagPart, "base64url");
      if (iv.length !== IV_BYTES || tag.length !== 16) {
        throw new Error("[auth-gateway] malformed token envelope.");
      }
      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(tag);
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, "base64url")),
        decipher.final(),
      ]);
      return plaintext.toString("utf8");
    },
  };
}
