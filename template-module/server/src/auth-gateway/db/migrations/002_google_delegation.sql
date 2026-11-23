-- 002_google_delegation.sql — Gmail delegation for invitation delivery.
--
-- The auth gateway can send invitations from the signed-in admin's own mailbox
-- (Gmail API, scope https://www.googleapis.com/auth/gmail.send) instead of a
-- central SMTP relay. Doing that requires keeping that admin's Google tokens.
--
-- SECURITY: neither column ever holds a plaintext token. Both store AES-256-GCM
-- envelopes produced by src/auth-gateway/tokenVault.ts, shaped
--     v1.<base64url iv>.<base64url auth tag>.<base64url ciphertext>
-- and sealed with a key derived from AUTH_TOKEN_ENCRYPTION_KEY (falling back to
-- AUTH_JWT_SECRET in development). A database dump alone does not reveal a
-- usable credential, and any ciphertext that has been tampered with fails to
-- open (GCM authenticates the envelope).
--
-- NON-DESTRUCTIVE BY DESIGN:
--   * ADD COLUMN IF NOT EXISTS only; existing rows keep working with NULLs;
--   * no constraint references, so `operators` and the workflow API are untouched.
--
-- Apply with: npm run auth:migrate
-- (or let the gateway run it on boot with AUTH_AUTO_MIGRATE=true).

ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS oauth_access_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token TEXT,
  ADD COLUMN IF NOT EXISTS oauth_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS oauth_scopes TEXT[] NOT NULL DEFAULT '{}';

-- Cheap lookup for "which admins can delegate Gmail?" without scanning blobs.
CREATE INDEX IF NOT EXISTS idx_auth_accounts_gmail_delegation
  ON auth_accounts (operator_id)
  WHERE oauth_refresh_token IS NOT NULL;

COMMENT ON COLUMN auth_accounts.oauth_access_token IS
  'Sealed (AES-256-GCM) Google access token. Short-lived; refreshed on demand.';
COMMENT ON COLUMN auth_accounts.oauth_refresh_token IS
  'Sealed Google refresh token. Only present when gmail.send was consented.';
COMMENT ON COLUMN auth_accounts.oauth_token_expires_at IS
  'Expiry of oauth_access_token in UTC; NULL means unknown and forces a refresh.';
COMMENT ON COLUMN auth_accounts.oauth_scopes IS
  'Scopes Google actually granted at last consent (space-separated list, split).';
