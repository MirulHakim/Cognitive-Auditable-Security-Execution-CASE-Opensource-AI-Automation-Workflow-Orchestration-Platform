# Audit & Transparency Layer

Owner: Ain · Code: [`backend/src/audit/`](../../backend/src/audit/) · Full design: [AUDIT_MODULE_PLAN.md](AUDIT_MODULE_PLAN.md)

The Audit module is CASE's independent evidence service. Other modules decide what happens; Audit **records** what happened, **protects** the records and **proves** they were not changed.

| Objective | Delivered by | Status |
|---|---|---|
| **O1** Readable, traceable audit timeline | `log_event()` records every step; timeline API | recording ✅, API in Phase 5 |
| **O2** SHA-256 hash chain that shows *where* it was altered | hash chain + chain head + `verify_chain()` | ✅ |
| **O3** Full lineage of each request as one record | provenance record + lineage hash | Phase 4 |

---

## Status

| Phase | What it delivered | Status |
|---|---|---|
| 0. Move + interface | Audit schemas moved out of `secure_api`; async `AuditLogger` interface in `port.py` (with `session`); Standardization made async | ✅ |
| 1. Core | Event catalogue, canonical hashing, `AuditService.log_event`, in-memory repository | ✅ |
| 2. Verify | `verify_chain` with chain head: detects edits, re-hashing, deletions, reordering and rows inserted outside `log_event` | ✅ |
| 3. Postgres | Shared DB pool, migrations, `PostgresAuditRepository`, advisory lock, append-only triggers, role split, pattern A | ✅ |
| 4. Provenance | `seal_provenance`, `verify_lineage` (incl. gate order) | to do |
| 5. Read API + export | Timeline/verify endpoints, JSON + PDF export | to do |
| 6. Plug in | Connect Standardization, Ingress, Integrations, Workflow Engine | to do, with Samantha and Amirul |

---

## Using Audit from your module

### 1. Take an `AuditLogger`, don't create one

Import the interface from `src.audit.port` (it has no other dependencies) and accept the logger as a parameter. Tests can pass `MemoryAuditLogger` or `NullAuditLogger`; the app passes the real `AuditService`.

```python
from src.audit.port import AuditLogger

async def add_to_whitelist(..., audit: AuditLogger) -> None:
    ...
```

### 2. How the app builds the real one

```python
from src.storage.database import Database
from src.audit import AuditService, PostgresAuditRepository

db = Database()                    # reads DATABASE_URL (connects as case_app)
await db.open()
audit = AuditService(PostgresAuditRepository(db))
```

### 3. Recording an event

```python
await audit.log_event(
    workspace_id="6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b",  # UUID: one chain per workspace
    actor="u-123",               # user id, "system", or a model name such as "qwen3.5:9b"
    role="ADMIN",                # ADMIN | OPERATOR | AUDITOR | SYSTEM | AI
    action="WHITELIST_ADDED",    # must be in the catalogue (catalogue.py / plan §7)
    target="whitelist:wl-42",    # "<type>:<id>", e.g. execution:<id>, template:<id>
    source="WEB_APP",            # GMAIL | TELEGRAM | WEB_FORM | WEB_APP | SYSTEM
    outcome="SUCCESS",           # SUCCESS | FAILURE
    details={"sender_hash": "…"},
    execution_id=None,           # the request id (thread_id) when the event belongs to a request
    session=None,                # your transaction, for pattern A (below)
)
```

Audit sets the timestamp (UTC), `seq`, `previous_hash` and `current_hash` itself. Callers never pass them.

### 4. Rules for `details`

- **Never** put message bodies, attachment or document content, prompts, passwords, tokens, API keys or email addresses in `details`. Store **ids, counts, labels and hashes** instead (e.g. `prompt_hash`, `sender_hash`).
- These keys are rejected anywhere in `details`: `body`, `body_text`, `content`, `raw`, `prompt`, `prompt_text`, `password`, `token`, `secret`, `api_key`, `credentials`, and any key ending in `_token`, `_secret`, `_password`, `_api_key` or `_credentials`.
- **No floats.** Pass numbers as `int`, or as a string such as `"0.87"` (AI confidence). Floats do not hash the same way everywhere.
- Max 8 KB. Some actions require specific keys (e.g. `GATE1_APPROVED` needs `revision`); see the table in plan §7.
- `actor`, `target` and `execution_id` cannot contain `@`, so an email address cannot be stored by mistake.

### 5. Errors

| Error | Meaning | What to do |
|---|---|---|
| `AuditValidationError` (has `.code`, e.g. `FORBIDDEN_DETAILS`, `UNKNOWN_ACTION`) | Your input is wrong; nothing was recorded | Fix the call. This is a bug in the caller |
| Anything else (e.g. `psycopg.OperationalError`) | Audit could not store the event (database down, ...) | Follow the pattern below for your action |

### 6. Which logging pattern to use (plan §8.2)

| Pattern | Use for | How | If the audit write fails |
|---|---|---|---|
| **A. Shared transaction** | Changes stored in our Postgres: whitelist, integrations, templates | Open a transaction, make your change, call `log_event(..., session=tx)` **last**, then commit | Everything rolls back; your change does not happen |
| **B. Log before act** | Actions whose state is not in our Postgres: Gate 1 / Gate 2 decisions, `EXECUTION_STARTED` | Call `log_event` first; resume the LangGraph graph **only if it succeeded** | Do not resume; return an error |
| **C. Best-effort** | Read-only actions, `ACCESS_FORBIDDEN`, `AUTH_FAILED` | Call `log_event`; on failure, log a warning (no secrets) | Return the normal response anyway |

Pattern A example:

```python
async with db.transaction() as tx:                       # BEGIN
    await tx.execute("INSERT INTO whitelist_entries ...", (...))
    await audit.log_event(..., action="WHITELIST_ADDED", session=tx)   # last step
# COMMIT here. If anything above raised: ROLLBACK, nothing saved.
```

Audit never commits a transaction it did not open. Keep `log_event` as the last step: other writers to the same workspace chain wait until you commit.

---

## Verifying the chain

```python
result = await audit.verify_chain(workspace_id, actor="u-7", role="AUDITOR")
result.status          # VERIFIED or BROKEN
result.broken_at_seq   # the exact record, when BROKEN
result.reason          # why (below)
result.head_seq, result.head_hash              # what the chain head says
result.last_found_seq, result.last_found_hash  # the last record actually found
```

Each run is stored in `hash_chain_verifications` and logged as `AUDIT_INTEGRITY_VERIFIED` / `AUDIT_INTEGRITY_FAILED`, both in one transaction.

| `reason` | What happened |
|---|---|
| `RECORD_MODIFIED` | A record was edited (its stored hash no longer matches) |
| `LINK_BROKEN` | A record was edited and re-hashed, so the next record no longer links to it |
| `GAP` | A record in the middle was deleted |
| `DUPLICATE_SEQ` | A seq number repeats or goes backwards |
| `TAIL_TRUNCATED` | The last record(s) were deleted (head says seq 250, last found is 249) |
| `INSERTED_OUTSIDE_LOG_EVENT` | A record exists after the head, i.e. it was not written by `log_event` |
| `HEAD_MISMATCH` | Same seq as the head, different hash |

---

## Database (Phase 3)

Migrations live in [`backend/migrations/`](../../backend/migrations/) and are applied with `python -m src.storage.migrate` (see the root README).

| Table | Content |
|---|---|
| `audit_events` | One row per step, append-only. `UNIQUE (workspace_id, seq)` |
| `audit_chain_heads` | Last `seq` and hash of each workspace chain; detects a deleted tail |
| `hash_chain_verifications` | One row per `verify_chain` run |
| `provenance_records` | One sealed record per closed request (filled in Phase 4) |
| `audit_exports` | Who exported what, with the chain head at that time (Phase 5) |

How the records are protected:

1. **Two database roles.** `case_owner` owns the tables and runs migrations. The app connects as `case_app`, which may only `INSERT` and `SELECT` the evidence tables (plus `UPDATE` the chain head). It cannot `UPDATE`, `DELETE` or `TRUNCATE` them, and as it is not the owner, it cannot disable triggers or drop tables.
2. **Triggers** (`002_audit_protection.sql`) refuse `UPDATE`, `DELETE` and `TRUNCATE` on `audit_events` and `provenance_records`, **even for the owner**.
3. **Head trigger.** The chain head can only move forward by exactly one, to an event that exists.
4. **Hash chain.** Someone with superuser access can still get past 1–3. `verify_chain` then reports the exact record that was changed. Keep a copy of the chain head (shown in every verification result and export) outside the system to compare later.

**No fork under concurrency.** Each write takes a per-workspace lock in Postgres (`pg_advisory_xact_lock`) and reads the head with `SELECT ... FOR UPDATE`. Two writers, even in two separate app processes, can never get the same `seq` or link to the same previous hash.

---

## Files

| File | Purpose |
|---|---|
| `port.py` | Public interface: `AuditLogger`, `NullAuditLogger`, `MemoryAuditLogger`. The only file other modules need to import |
| `catalogue.py` | Every allowed `action`, its `event_type`, required `details`, forbidden keys, gate-order rules |
| `canonical.py` | Canonical JSON and SHA-256 hashing (`HASH_FIELDS`, `compute_event_hash`) |
| `service.py` | `AuditService`: validates and records events (`log_event`), runs and stores verification |
| `repository.py` | Storage: `PostgresAuditRepository` (real) and `InMemoryAuditRepository` (unit tests) |
| `verifier.py` | `verify_chain`: walks the chain and finds the first broken record |
| `schemas.py` | Pydantic models: `AuditEvent`, `ChainVerificationResult`, ... |
| `errors.py` | `AuditValidationError` |
| `../storage/database.py` | Shared connection pool + `transaction()` helper, used by every module |
| `../storage/migrate.py` | Applies `backend/migrations/*.sql` in order |

---

## Tests

Run from `backend/` (see the root README for setup):

| Command | What runs |
|---|---|
| `.venv\Scripts\python -m pytest tests\audit` | All Audit tests |
| `.venv\Scripts\python -m pytest tests\audit -m "not integration"` | Unit tests only (in memory, no database) |
| `.venv\Scripts\python -m pytest tests\audit\integration -v` | Postgres tests only (needs `docker compose up -d`) |

The integration tests create their own `case_test` database on each run (your `case_dev` data is not touched). If Postgres is not running they are **skipped** with a message, not failed.

| Area | Where |
|---|---|
| Hashing, catalogue, `log_event` rules | `test_canonical.py`, `test_catalogue.py`, `test_service.py` |
| Chain building, 50 parallel writes | `test_repository.py`, `integration/test_postgres_repository.py` |
| Tamper detection, 10,000 events < 2 s | `test_verifier.py`, `integration/test_postgres_repository.py` |
| Triggers and roles | `integration/test_db_protection.py` |
| Pattern A (all or nothing) | `integration/test_pattern_a.py` |
| Standardization works with `AuditService` | `test_standardization_contract.py` |

---

## Known limitations

- A hash chain proves **integrity** (changes are detectable), not who made them. A database superuser could rebuild the whole chain; comparing the chain head with a copy kept outside the system detects that. External anchoring / signing is future work.
- A valid chain does not prove every action was logged. Patterns A and B make sure state changes and approvals cannot happen without a record.
- Full list: plan §15.
