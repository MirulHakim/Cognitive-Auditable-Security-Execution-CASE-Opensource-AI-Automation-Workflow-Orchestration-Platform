-- 005_invitation_consumed_pair.sql — allow hard revocation of invited members.
--
-- 001 enforced:
--   (consumed_at IS NULL AND accepted_operator_id IS NULL)
--   OR (consumed_at IS NOT NULL AND accepted_operator_id IS NOT NULL)
--
-- `accepted_operator_id` is ON DELETE SET NULL. Deleting an operator who was
-- created by accepting an invitation therefore nulls that column while
-- `consumed_at` stays set, and the old CHECK rejected the delete with 23514.
-- That made every invited member unrevokable through the hard-revoke route.
--
-- The invariant that matters is one-directional: an acceptance reference
-- implies the invitation was consumed. A consumed invitation with no operator
-- reference is exactly "the account was hard-deleted", so it must be allowed
-- and must remain CONSUMED (the magic link stays dead).
--
-- Idempotent: drop-if-exists, then add.

ALTER TABLE auth_invitations
  DROP CONSTRAINT IF EXISTS auth_invitation_consumed_pair;

ALTER TABLE auth_invitations
  ADD CONSTRAINT auth_invitation_consumed_pair
  CHECK (accepted_operator_id IS NULL OR consumed_at IS NOT NULL);

COMMENT ON CONSTRAINT auth_invitation_consumed_pair ON auth_invitations IS
  'An acceptance reference requires consumed_at; accepted_operator_id becomes NULL when that operator is hard-deleted.';
