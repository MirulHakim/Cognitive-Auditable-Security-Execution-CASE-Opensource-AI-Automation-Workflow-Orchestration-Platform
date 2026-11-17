-- 006_auth_vault_secrets.sql — user-scoped integration credential vault.
--
-- ZERO-MODIFICATION: this table belongs to the auth-gateway sidecar. No
-- existing Express or FastAPI table or column is altered. The only reference is
-- the existing operators(operator_id) identity key, which is shared by design.
--
-- WHAT IS STORED
--   One row per (operator_id, provider). The primary key is the uniqueness
--   constraint: an operator can have at most ONE Telegram secret and at most
--   ONE Gmail secret. Re-connecting uses ON CONFLICT ... DO UPDATE, so it is a
--   rotation, never a second active credential.
--
-- WHAT IS NEVER STORED
--   No plaintext, no masked value, no fingerprint of the token. Three columns
--   together form one AES-256-GCM envelope produced by vault.ts:
--     cipher_text  base64 ciphertext
--     iv           base64 12-byte initialization vector, unique per write
--     auth_tag     base64 16-byte GCM authentication tag
--   The envelope is additionally bound with AAD `auth-vault:v1:<operator>:<provider>`,
--   so a ciphertext cannot be moved to another operator's row and still open.
--
-- SCOPE
--   operator_id is a real foreign key to operators, ON DELETE CASCADE. A hard
--   revocation removes the rows automatically; a soft revocation is completed by
--   the gateway's credential purge. There is deliberately no workspace_id column:
--   this data is scoped to a person, not to the workspace.

DO $$
BEGIN
  IF to_regclass('public.operators') IS NULL THEN
    RAISE EXCEPTION
      'operators table is missing: run the workflow API migrations before the auth gateway migration';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_vault_secrets (
  operator_id TEXT NOT NULL
                REFERENCES operators(operator_id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  cipher_text TEXT NOT NULL,
  iv          TEXT NOT NULL,
  auth_tag    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One active secret per operator per provider, enforced by the database
  -- rather than by an application read-then-write race.
  CONSTRAINT auth_vault_secrets_pkey PRIMARY KEY (operator_id, provider),

  CONSTRAINT auth_vault_secrets_provider_check
    CHECK (provider IN ('telegram', 'gmail')),

  CONSTRAINT auth_vault_secrets_cipher_text_present
    CHECK (btrim(cipher_text) <> ''),

  -- Base64 of exactly 12 bytes is 16 characters (with '=' padding).
  CONSTRAINT auth_vault_secrets_iv_shape
    CHECK (iv ~ '^[A-Za-z0-9+/]{16}$'),

  -- Base64 of exactly 16 bytes is 24 characters (with '=' padding).
  CONSTRAINT auth_vault_secrets_auth_tag_shape
    CHECK (auth_tag ~ '^[A-Za-z0-9+/]{22}==$'),

  CONSTRAINT auth_vault_secrets_updated_order
    CHECK (updated_at >= created_at)
);

-- Covering lookup for the status query: operator -> provider -> updated_at.
CREATE INDEX IF NOT EXISTS idx_auth_vault_secrets_operator
  ON auth_vault_secrets (operator_id, provider, updated_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'case_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON auth_vault_secrets TO case_app';
  END IF;
END $$;

COMMENT ON TABLE auth_vault_secrets IS
  'AES-256-GCM sealed per-operator integration credentials (auth gateway).';
COMMENT ON COLUMN auth_vault_secrets.operator_id IS
  'Owner of the secret. Never a workspace id; deleted with the operator.';
COMMENT ON COLUMN auth_vault_secrets.provider IS
  'telegram | gmail. Combined with operator_id, the active-secret uniqueness key.';
COMMENT ON COLUMN auth_vault_secrets.cipher_text IS
  'Base64 AES-256-GCM ciphertext. Useless without iv + auth_tag + VAULT_MASTER_KEY.';
COMMENT ON COLUMN auth_vault_secrets.iv IS
  'Base64 12-byte GCM IV. Never reused for another write with the same key.';
COMMENT ON COLUMN auth_vault_secrets.auth_tag IS
  'Base64 16-byte GCM tag. Altering any part of the envelope makes decryption fail.';
