import { OAuth2Client, type TokenPayload } from "google-auth-library";
import type { AuthGatewayConfig } from "./config.js";

/**
 * Thin port around google-auth-library so routes never touch Google directly
 * and tests can substitute a deterministic identity.
 */

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  hostedDomain: string | null;
}

/**
 * Tokens Google returned alongside the ID token.
 *
 * Invitations no longer use these: the platform sends from its own SMTP mailbox.
 * They are still stored (sealed) for the existing Google account links and the
 * revocation purge, and to keep the exchange shape stable for older databases.
 */
export interface GoogleTokenSet {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

export interface GoogleExchangeResult {
  profile: GoogleProfile;
  tokens: GoogleTokenSet;
}

export interface GoogleOAuth {
  authorizationUrl(input: { state: string; nonce: string }): string;
  exchangeCode(code: string, expectedNonce: string): Promise<GoogleExchangeResult>;
}

// Identity-only consent. Invitations are sent by the CASE system SMTP mailbox,
// so the gateway must never ask an admin for permission to send mail as them.
const SCOPES = ["openid", "email", "profile"];

/** Google returns the granted scopes as one space-separated string. */
export function parseScopes(scope: string | null | undefined): string[] {
  return (scope ?? "")
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toTokenSet(tokens: {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
  scope?: string | null;
}): GoogleTokenSet {
  return {
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt:
      typeof tokens.expiry_date === "number" && Number.isFinite(tokens.expiry_date)
        ? new Date(tokens.expiry_date)
        : null,
    scopes: parseScopes(tokens.scope),
  };
}

export function createGoogleOAuth(config: AuthGatewayConfig): GoogleOAuth {
  const client = new OAuth2Client({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });

  return {
    authorizationUrl({ state, nonce }) {
      return client.generateAuthUrl({
        // Identity only. Invitations leave from the CASE SMTP account, so there
        // is no gmail.send scope and no forced consent/offline grant.
        scope: SCOPES,
        state,
        nonce,
        prompt: "select_account",
        ...(config.google.hostedDomain ? { hd: config.google.hostedDomain } : {}),
      });
    },

    async exchangeCode(code, expectedNonce) {
      const { tokens } = await client.getToken(code);
      if (!tokens.id_token) throw new Error("Google did not return an ID token.");

      const ticket = await client.verifyIdToken({
        idToken: tokens.id_token,
        audience: config.google.clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) throw new Error("Google ID token has no payload.");
      return {
        profile: profileFromPayload(payload, expectedNonce, config.google.hostedDomain),
        tokens: toTokenSet(tokens),
      };
    },
  };
}

export function profileFromPayload(
  payload: TokenPayload,
  expectedNonce: string,
  hostedDomain: string | null,
): GoogleProfile {
  if (!payload.sub) throw new Error("Google identity has no subject.");
  if (!payload.email) throw new Error("Google identity has no email.");
  if (payload.email_verified !== true) throw new Error("Google email is not verified.");
  if (!payload.nonce || payload.nonce !== expectedNonce) {
    throw new Error("Google ID token nonce mismatch.");
  }
  if (hostedDomain && payload.hd !== hostedDomain) {
    throw new Error("Google account is outside the allowed hosted domain.");
  }

  const email = payload.email.trim().toLowerCase();
  const name =
    (payload.name ?? "").trim() || email.split("@")[0]?.trim() || "CASE member";

  return {
    sub: payload.sub,
    email,
    emailVerified: true,
    name,
    hostedDomain: payload.hd ?? null,
  };
}
