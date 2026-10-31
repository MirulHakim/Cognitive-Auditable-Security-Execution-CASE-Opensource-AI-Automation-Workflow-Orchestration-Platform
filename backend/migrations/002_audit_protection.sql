-- CASE — Audit & Transparency Layer
-- 002: protection triggers (AUDIT_MODULE_PLAN.md §3 rule 1, §6)
--
-- A trigger is a rule the database runs by itself on every matching
-- statement, whoever sends it. These ones refuse any change to stored
-- evidence, also for the table owner. (Only the owner or a superuser could
-- disable them, and the app does not connect as either; see 003.)

-- ---------------------------------------------------------------------------
-- Append-only: audit_events and provenance_records accept INSERT only.
-- Corrections are new events, never edits (§3 rule 1).
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% on % is not allowed: audit records are append-only', TG_OP, TG_TABLE_NAME;
END;
$$;

-- Row triggers do not fire on TRUNCATE, so each table gets a statement trigger for it too.
CREATE TRIGGER audit_events_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION audit_reject_change();
CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();

CREATE TRIGGER provenance_records_no_update_delete
    BEFORE UPDATE OR DELETE ON provenance_records
    FOR EACH ROW EXECUTE FUNCTION audit_reject_change();
CREATE TRIGGER provenance_records_no_truncate
    BEFORE TRUNCATE ON provenance_records
    FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();

-- ---------------------------------------------------------------------------
-- Chain head: may only move forward by one, to an event that exists (§6).
-- The event is inserted before the head is written, in the same transaction.
-- ---------------------------------------------------------------------------
CREATE FUNCTION audit_check_head_advance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.last_seq <> 1 THEN
            RAISE EXCEPTION 'a new chain head must start at seq 1 (got %)', NEW.last_seq;
        END IF;
    ELSE
        IF NEW.workspace_id <> OLD.workspace_id OR NEW.last_seq <> OLD.last_seq + 1 THEN
            RAISE EXCEPTION 'chain head may only advance by one (from % to %)', OLD.last_seq, NEW.last_seq;
        END IF;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM audit_events
                   WHERE workspace_id = NEW.workspace_id
                     AND seq = NEW.last_seq
                     AND current_hash = NEW.last_hash) THEN
        RAISE EXCEPTION 'chain head must point to an existing event (seq %)', NEW.last_seq;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_chain_heads_advance
    BEFORE INSERT OR UPDATE ON audit_chain_heads
    FOR EACH ROW EXECUTE FUNCTION audit_check_head_advance();
CREATE TRIGGER audit_chain_heads_no_delete
    BEFORE DELETE ON audit_chain_heads
    FOR EACH ROW EXECUTE FUNCTION audit_reject_change();
CREATE TRIGGER audit_chain_heads_no_truncate
    BEFORE TRUNCATE ON audit_chain_heads
    FOR EACH STATEMENT EXECUTE FUNCTION audit_reject_change();
