-- 004_profile_and_theme.sql — editable profile + cross-device theme.
--
-- ZERO-MODIFICATION: no Express/FastAPI code is changed. The gateway owns these
-- two nullable columns and writes them directly.
--
-- 1. operators.contact_number
--    The profile page edits a display name and a contact number. Display names
--    already live on `operators`, so the contact number belongs beside it: it
--    is available for every member, including the seeded/dev identities that
--    have not linked Google yet. The column is nullable and unused by the
--    workflow API, which selects explicit columns.
--
-- 2. auth_accounts.theme_preference
--    Theme follows the Google account, not the browser. NULL means "never
--    chosen": the dashboard keeps its device-local preference instead of
--    overwriting it with a server default. Only an explicit choice is stored.
--
-- Idempotent: IF NOT EXISTS / constraint probe, safe to re-run.

ALTER TABLE operators
  ADD COLUMN IF NOT EXISTS contact_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'operators_contact_number_shape'
  ) THEN
    ALTER TABLE operators
      ADD CONSTRAINT operators_contact_number_shape
      CHECK (
        contact_number IS NULL
        OR (
          btrim(contact_number) <> ''
          AND length(contact_number) <= 40
          AND contact_number ~ '^[+()0-9 .-]+$'
        )
      );
  END IF;
END $$;

ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS theme_preference TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'auth_accounts_theme_preference_check'
  ) THEN
    ALTER TABLE auth_accounts
      ADD CONSTRAINT auth_accounts_theme_preference_check
      CHECK (
        theme_preference IS NULL
        OR theme_preference IN ('light', 'dark', 'system')
      );
  END IF;
END $$;

COMMENT ON COLUMN operators.contact_number IS
  'Optional contact number shown on the profile page; gateway-owned overlay column.';
COMMENT ON COLUMN auth_accounts.theme_preference IS
  'Explicit light/dark/system choice; NULL means the account never chose one.';
