-- CASE — Audit & Transparency Layer
-- 003: what the app role may do (AUDIT_MODULE_PLAN.md §6 role split)
--
-- Two database roles:
--   case_owner  owns the tables, runs these migrations. Not used by the app.
--   case_app    the app connects as this. It is not the owner, so it cannot
--               ALTER TABLE ... DISABLE TRIGGER or DROP the tables.
-- Both roles are created once per Postgres server (backend/db/init/01_roles.sql).
--
-- case_app gets no UPDATE/DELETE/TRUNCATE on the evidence tables at all:
-- that is a second wall in front of the triggers in 002.

GRANT SELECT, INSERT ON audit_events, provenance_records, hash_chain_verifications, audit_exports TO case_app;

-- The head is the one row the app must change: once per event, guarded by the 002 trigger.
GRANT SELECT, INSERT, UPDATE ON audit_chain_heads TO case_app;
