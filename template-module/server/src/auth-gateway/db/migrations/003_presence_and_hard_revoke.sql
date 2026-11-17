-- 003_presence_and_hard_revoke.sql — live presence + hard revocation support.
--
-- TWO INDEPENDENT CHANGES, both confined to gateway-owned tables.
--
-- 1. PRESENCE
--    `last_seen_at` is updated (throttled) by the JWT middleware and by
--    POST /api/auth/heartbeat. `is_online` is the last explicitly written state
--    (true while active, false on logout); readers must still derive "online"
--    from last_seen_at so a crashed process cannot look alive forever.
--    Neither column exists on the base `operators` table: the workflow API's
--    schema is untouched.
--
-- 2. HARD REVOKE
--    A hard delete of `operators` must not be blocked by the invitation that
--    admin once sent. `auth_invitations.invited_by` was NOT NULL + ON DELETE
--    RESTRICT, which made any operator who had ever invited someone
--    undeletable. It becomes nullable with ON DELETE SET NULL: the invitation
--    row (and its audit value) survives, the actor reference is cleared.
--    The other operator references already behave: workflow_templates.created_by,
--    template_reviews.reviewed_by, workflow_instances.created_by and
--    step_runs.performed_by are SET NULL; auth_accounts and
--    auth_refresh_tokens are CASCADE; accepted_operator_id is SET NULL.
--
-- Idempotent: IF NOT EXISTS everywhere, and the FK is dropped before it is
-- re-added, so re-running the file is harmless.

ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_auth_accounts_presence
  ON auth_accounts (last_seen_at DESC)
  WHERE last_seen_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Hard delete: relax the inviter reference.
-- ---------------------------------------------------------------------------

ALTER TABLE auth_invitations ALTER COLUMN invited_by DROP NOT NULL;

-- Drop whatever the FK is called (name depends on how the table was created).
DO $$
DECLARE con record;
BEGIN
  FOR con IN
    SELECT c.conname
      FROM pg_constraint c
      JOIN pg_attribute a
        ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'auth_invitations'::regclass
       AND c.contype = 'f'
       AND a.attname = 'invited_by'
  LOOP
    EXECUTE format('ALTER TABLE auth_invitations DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE auth_invitations
  ADD CONSTRAINT auth_invitations_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES operators(operator_id) ON DELETE SET NULL;

COMMENT ON COLUMN auth_accounts.last_seen_at IS
  'Last authenticated request or heartbeat. Online = within 2 minutes.';
COMMENT ON COLUMN auth_accounts.is_online IS
  'Last explicit state (true on activity, false on logout). Readers derive liveness from last_seen_at.';
COMMENT ON COLUMN auth_invitations.invited_by IS
  'Admin who issued the invitation; cleared if that operator is hard-deleted.';
