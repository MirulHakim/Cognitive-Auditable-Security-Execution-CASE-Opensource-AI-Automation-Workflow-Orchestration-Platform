-- CASE — Audit module
-- 003: what the app is allowed to do with the audit tables
--
-- There are 2 database users:
--   case_owner = the OWNER of the tables. Only used to create the tables (migrations).
--   case_app   = the user our app logs in as.
--
-- Why not let the app use case_owner?
-- Because the owner can switch off the triggers in 002 or delete the tables.
-- If someone hacks the app, they would get that power too.
-- case_app is not the owner, so it can't do that.
--
-- Below we give case_app only what it needs: read (SELECT) and add (INSERT).
-- It gets NO permission to change (UPDATE) or delete (DELETE / TRUNCATE) records.
-- So even before the triggers in 002 run, the database already says "permission denied".

GRANT SELECT, INSERT ON audit_events, provenance_records, hash_chain_verifications, audit_exports TO case_app;

-- The head is the one row the app must change: once per event, guarded by the 002 trigger.
GRANT SELECT, INSERT, UPDATE ON audit_chain_heads TO case_app;
