-- CASE — Audit & Transparency Layer
-- 001: audit tables (AUDIT_MODULE_PLAN.md §5, §6)
--
-- Run as the owner role (case_owner) by src/storage/migrate.py.
-- Hashes are computed in Python (§3 rule 4); the database only stores them.
-- The CHECKs repeat the Python enums so a row written outside AuditService
-- still has to look like a valid event.

-- ---------------------------------------------------------------------------
-- audit_events (§5.1): one row per step, append-only (triggers in 002)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_events (
    event_id        uuid        PRIMARY KEY,
    workspace_id    uuid        NOT NULL,
    seq             bigint      NOT NULL CHECK (seq >= 1),
    event_timestamp timestamptz NOT NULL,
    execution_id    text,
    event_type      text        NOT NULL CHECK (event_type IN ('USER_ACTION', 'AI_DECISION', 'SYSTEM_ACTION',
                                    'APPROVAL_GATE', 'STATE_CHANGE', 'SECURITY_EVENT', 'INTEGRITY_EVENT')),
    action          text        NOT NULL,
    actor_type      text        NOT NULL CHECK (actor_type IN ('USER', 'SYSTEM', 'AI')),
    actor_id        text        NOT NULL,
    actor_role      text        NOT NULL CHECK (actor_role IN ('ADMIN', 'OPERATOR', 'AUDITOR', 'SYSTEM', 'AI')),
    target_type     text        NOT NULL,
    target_id       text        NOT NULL,
    source          text        NOT NULL CHECK (source IN ('GMAIL', 'TELEGRAM', 'WEB_FORM', 'WEB_APP', 'SYSTEM',
                                    'REST_API', 'JSON_FILE', 'EMAIL_SERVICE')),
    outcome         text        NOT NULL CHECK (outcome IN ('SUCCESS', 'FAILURE')),
    details         jsonb       NOT NULL,
    previous_hash   char(64)    NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
    current_hash    char(64)    NOT NULL CHECK (current_hash ~ '^[0-9a-f]{64}$'),
    -- One seq per workspace: two events can never take the same place in a chain.
    -- Also the index used to read a chain in seq order.
    CONSTRAINT audit_events_workspace_seq_key UNIQUE (workspace_id, seq)
);

CREATE INDEX audit_events_timeline_idx  ON audit_events (workspace_id, event_timestamp DESC);
CREATE INDEX audit_events_execution_idx ON audit_events (workspace_id, execution_id, seq);
CREATE INDEX audit_events_action_idx    ON audit_events (workspace_id, action);

-- ---------------------------------------------------------------------------
-- audit_chain_heads (§5.3): last event of each workspace chain.
-- Updated in the same transaction as each insert; detects a deleted tail.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_chain_heads (
    workspace_id uuid        PRIMARY KEY,
    last_seq     bigint      NOT NULL CHECK (last_seq >= 1),
    last_hash    char(64)    NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$'),
    updated_at   timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- provenance_records (§5.4): one sealed record per closed request (Phase 4).
-- The sections are jsonb so their fields follow the Python model.
-- ---------------------------------------------------------------------------
CREATE TABLE provenance_records (
    provenance_id uuid        PRIMARY KEY,
    workspace_id  uuid        NOT NULL,
    execution_id  text        NOT NULL,
    objective     jsonb       NOT NULL,
    decision      jsonb       NOT NULL,
    approvals     jsonb       NOT NULL,
    execution     jsonb       NOT NULL,
    result        jsonb       NOT NULL,
    event_ids     jsonb       NOT NULL,
    event_hashes  jsonb       NOT NULL,
    lineage_hash  char(64)    NOT NULL CHECK (lineage_hash ~ '^[0-9a-f]{64}$'),
    record_hash   char(64)    NOT NULL CHECK (record_hash ~ '^[0-9a-f]{64}$'),
    sealed_at     timestamptz NOT NULL,
    -- Sealed once per request (§8.4 step 7).
    CONSTRAINT provenance_records_workspace_execution_key UNIQUE (workspace_id, execution_id)
);

-- ---------------------------------------------------------------------------
-- hash_chain_verifications (§5.5): one row per verify_chain run.
-- ---------------------------------------------------------------------------
CREATE TABLE hash_chain_verifications (
    verification_id    uuid        PRIMARY KEY,
    workspace_id       uuid        NOT NULL,
    verified_by        text        NOT NULL,
    verified_role      text        NOT NULL,
    verified_at        timestamptz NOT NULL,
    from_seq           bigint      NOT NULL,
    to_seq             bigint,
    events_checked     bigint      NOT NULL,
    status             text        NOT NULL CHECK (status IN ('VERIFIED', 'BROKEN')),
    broken_at_seq      bigint,
    reason             text,
    unverifiable_after bigint,
    head_seq           bigint      NOT NULL,
    head_hash          char(64)    NOT NULL,
    last_found_seq     bigint      NOT NULL,
    last_found_hash    char(64)    NOT NULL,
    duration_ms        integer     NOT NULL,
    -- A BROKEN result always says where and why; a VERIFIED one never does.
    CHECK ((status = 'VERIFIED') = (broken_at_seq IS NULL AND reason IS NULL))
);

CREATE INDEX hash_chain_verifications_workspace_idx ON hash_chain_verifications (workspace_id, verified_at DESC);

-- ---------------------------------------------------------------------------
-- audit_exports (§6, §8.6): who exported what, with the chain head at that time (Phase 5).
-- ---------------------------------------------------------------------------
CREATE TABLE audit_exports (
    export_id     uuid        PRIMARY KEY,
    workspace_id  uuid        NOT NULL,
    exported_by   text        NOT NULL,
    exported_role text        NOT NULL,
    exported_at   timestamptz NOT NULL,
    format        text        NOT NULL CHECK (format IN ('JSON', 'PDF')),
    filters       jsonb       NOT NULL,
    record_count  integer     NOT NULL,
    head_seq      bigint      NOT NULL,
    head_hash     char(64)    NOT NULL,
    file_hash     char(64)    NOT NULL CHECK (file_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX audit_exports_workspace_idx ON audit_exports (workspace_id, exported_at DESC);
