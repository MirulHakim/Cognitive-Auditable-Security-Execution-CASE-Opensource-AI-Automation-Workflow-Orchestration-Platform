-- 001_auth_identity.sql — auth gateway tables (Google identity + invitations).
--
-- NON-DESTRUCTIVE BY DESIGN:
--   * only CREATE ... IF NOT EXISTS / CREATE INDEX IF NOT EXISTS;
--   * `operators` is referenced, never altered (the existing workflow API owns it);
--   * `email` is intentionally NOT unique: 004_operator_invites.sql already owns
--     that constraint on `operators`, and duplicate pending invites are revoked
--     by the application inside a transaction.
--
-- Apply with: npm run auth:migrate
-- (or let the gateway run it on boot with AUTH_AUTO_MIGRATE=true).
--
-- Prerequisite: the workflow API's 001/004 migrations must have created the
-- `operators` table. The guard below turns that into a readable error.

DO $$
BEGIN
  IF to_regclass('public.operators') IS NULL THEN
    RAISE EXCEPTION
      'operators table is missing: run the workflow API migrations (npm run migrate) before the auth gateway migration';
  END IF;
END $$;

-- One row per Google identity. operator_id stays the platform-wide identity used
-- by templates, runs and both audit chains.
CREATE TABLE IF NOT EXISTS auth_accounts (
  account_id    UUID PRIMARY KEY,
  operator_id   TEXT NOT NULL UNIQUE
                  REFERENCES operators(operator_id) ON DELETE CASCADE,
  google_sub    TEXT NOT NULL UNIQUE CHECK (btrim(google_sub) <> ''),
  email         TEXT NOT NULL CHECK (btrim(email) <> ''),
  email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_accounts_operator ON auth_accounts (operator_id);
CREATE INDEX IF NOT EXISTS idx_auth_accounts_email ON auth_accounts (lower(email));

-- Invitation sidecar. Only a SHA-256 digest of the token is stored: a database
-- leak cannot be replayed as a magic link. Expiry is capped at two hours in the
-- schema as well as in the service.
CREATE TABLE IF NOT EXISTS auth_invitations (
  invitation_id        UUID PRIMARY KEY,
  email                TEXT NOT NULL CHECK (btrim(email) <> ''),
  role                 TEXT NOT NULL CHECK (role IN ('operator', 'auditor')),
  invited_by           TEXT NOT NULL
                         REFERENCES operators(operator_id) ON DELETE RESTRICT,
  workspace_id         UUID NOT NULL,
  token_hash           TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  consumed_at          TIMESTAMPTZ,
  accepted_operator_id TEXT
                         REFERENCES operators(operator_id) ON DELETE SET NULL,
  revoked_at           TIMESTAMPTZ,
  CONSTRAINT auth_invitation_expiry_order CHECK (expires_at > created_at),
  CONSTRAINT auth_invitation_expiry_max CHECK (expires_at <= created_at + INTERVAL '2 hours'),
  CONSTRAINT auth_invitation_consumed_pair CHECK (
    (consumed_at IS NULL AND accepted_operator_id IS NULL)
    OR (consumed_at IS NOT NULL AND accepted_operator_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_auth_invitations_email
  ON auth_invitations (lower(email))
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_auth_invitations_expiry
  ON auth_invitations (expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_invitations_invited_by
  ON auth_invitations (invited_by);

-- Refresh tokens are opaque, rotated on every use and stored only as digests.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  token_id    UUID PRIMARY KEY,
  operator_id TEXT NOT NULL
                REFERENCES operators(operator_id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  CONSTRAINT auth_refresh_expiry_order CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_operator
  ON auth_refresh_tokens (operator_id)
  WHERE revoked_at IS NULL;

-- Optional least-privilege grant when the deployment uses the case_app role.
-- Safe to ignore elsewhere: the guard means no error when the role is absent.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'case_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON auth_accounts, auth_invitations, auth_refresh_tokens TO case_app';
  END IF;
END $$;

COMMENT ON TABLE auth_accounts IS 'Google subject ↔ platform operator link (auth gateway).';
COMMENT ON TABLE auth_invitations IS 'Two-hour, single-use invitation tokens (digest only).';
COMMENT ON TABLE auth_refresh_tokens IS 'Rotating refresh-token digests; reuse revokes the family.';
