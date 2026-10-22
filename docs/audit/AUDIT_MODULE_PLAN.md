# CASE — Audit & Transparency Layer
**Module plan for implementation (owner: Ain)**
Version 1.3 · 22 Oct 2026

> **For Claude in VS Code:** read this whole file, `docs/standardization/STANDARDIZATION_MODULE_SPEC.md` and `backend/server.py` before writing code. Follow §3. Work one phase at a time (§11) and stop for review after each. Do not change anything listed in §12.2 (open team decisions) without asking. Appendix A describes how other modules are expected to behave; Audit only records it.

### Changes from v1.2 (Phase 1)
- **`source` is a fixed list (§5.1).** GMAIL, TELEGRAM, WEB_FORM, WEB_APP, SYSTEM, plus reserved REST_API, JSON_FILE, EMAIL_SERVICE. Anything else is rejected; callers record an unknown channel as `SYSTEM` with its name in `details.channel`.
- **Forbidden-key suffixes (§7).** Besides the whole-key list, keys ending in `_token`, `_secret`, `_password`, `_api_key` or `_credentials` are rejected (e.g. `bot_token`, `access_token`). No `body_` prefix rule (`body_truncated` is valid).
- **Two Standardization rows in the required-details table (§7):** `MESSAGE_STANDARDIZED` and `STANDARDIZATION_FAILED`.
- **`error_fields` replaces `reason` in `STANDARDIZATION_FAILED`.** Field names only; error messages could echo input such as an email address (rule 5).
- **Target fallback.** Standardization uses `execution:<id>` when known, otherwise `workspace:<id>` (messages) or `resource:<id>` (reserved resource path); never the source message id. Its actor is `system`.
- **Character rules for ids.** `actor_id`, `target_id` and `execution_id` are references, not free text: no control characters and no `@`, so an email address cannot be stored where rule 5 requires a hash. Model names such as `qwen3.5:9b` remain valid.

### Changes from v1.1
- **Template flow updated (§7, §5.4, Appendix A).** AI suggests a template; the OPERATOR can accept it, switch to another template, or request a new one through a prompt (AI drafts it). New templates are saved for reuse **without ADMIN approval**; ADMIN can deactivate a template. Gate 1 remains the control point. New events: `TEMPLATE_REQUESTED`, `AI_TEMPLATE_DRAFTED`, `TEMPLATE_CREATED` (replaces `TEMPLATE_REGISTERED`), `TEMPLATE_DEACTIVATED`. `TEMPLATE_MANUALLY_SELECTED` now also covers the OPERATOR switching away from the AI's choice.
- **Gate order check (§3 rule 12, §8.5).** Templates (including AI-drafted ones) cannot remove Gate 1 or Gate 2. `verify_lineage` checks that processing and delivery events appear only after the required gate approval.
- **Data fetch removed (team decision).** CASE processes only what is sent to it (Gmail, Telegram, web form). Removed events: `DATA_FETCHED`, `DATA_FETCH_FAILED`, `FETCH_RETRIED`, all `RESOURCE_*`, `SOURCE_PAUSED/RESUMED`, `CONNECTION_TESTED`. `DATA_STANDARDIZED` kept as reserved for future resources.
- **Three new events:**
  - `ATTACHMENT_EXTRACTED`: logged when the Workflow Engine reads the content of a request's attachments. This only happens after Gate 1 approval.
  - `INTEGRATION_CONNECTED` / `INTEGRATION_DISCONNECTED`: logged when a user connects or disconnects their Telegram bot or Gmail inbox on the Integrations page. The token itself is never recorded.
- **Permissions (§3 rule 9).** `audit:verify` is now open to all three roles (verification is read-only and its result cannot be faked). `audit:export` stays AUDITOR only. Permissions are a list per role, **not** a role hierarchy.
- **Chain head shown to users (§5.5, §8.3, §8.6, §9).** Verification results return `head_seq`, `head_hash`, `last_found_seq`, `last_found_hash`. The PDF export shows the chain head on page 1.
- **Operator prompts are never stored (§3 rule 5).** Only `prompt_hash`. `prompt` added to forbidden keys.
- **Dependencies on the Secure API removed.** Shared DB pool moves to `src/storage/database.py`; auth dependencies come from the central auth/RBAC owner (Amirul). Schedule re-based from 19 Oct (§11).
- **Slide and prototype alignment list added (§16).**

---

## 1. Context

CASE is an AI automation platform with mandatory human approval (Plan review = Gate 1, Final review = Gate 2). Stack (from the repo): Python 3.11+, FastAPI, Pydantic v2, PostgreSQL via async `psycopg` 3 (one shared pool, `src/storage/database.py`), LangGraph for the Workflow Engine, Ollama (`qwen3.5:9b`) for AI. Code: `backend/src/audit/` (package exists, empty).

Requests enter through **Gmail, Telegram or the web form** only. CASE does not fetch data from organisational systems; it processes the request content and its attachments.

This module delivers the **3 objectives on the official slide**:

| Objective | What it means | Delivered by |
|---|---|---|
| **O1** | Capture execution metadata and expose it through a readable, traceable audit timeline | `log_event()` + timeline API grouped by request |
| **O2** | Apply SHA-256 hash chaining to verify whether a record was altered, and identify exactly where the chain broke | hash chain + chain head + `verify_chain()` reporting the exact record |
| **O3** | Capture the full lineage of each operation (objective, decision, approval, result) as a single retrievable record | provenance record per request + lineage hash + record hash |

Supporting references (verified): EU AI Act Article 12 (record-keeping), NIST SP 800-53 AU-9 (protection of audit information), Zhao et al. 2025 (tamper-evident logging), Ojewale et al. 2026 (provenance/accountability), Solozobov 2026 (Fragmented Trace Problem), Ahmad et al. 2019 BlockAudit (supervisor-approved exception).

---

## 2. What this module does

**Principle:** Audit & Transparency is an independent evidence service. Other modules decide what happens and enforce their own rules. Audit records what happened, protects the evidence, verifies integrity and builds provenance.

1. **Records** every important action from every module as an append-only event (deterministic code, never AI).
2. **Chains** each event to the previous one with SHA-256 so any edit, re-hash or deletion is detectable.
3. **Verifies** the chain on demand and reports the first broken record and the reason.
4. **Seals provenance**: when a request reaches a terminal state, writes one provenance record that links all its events.
5. **Serves** the timeline (flat and grouped by request), single-event detail, lineage, verification results and exports (JSON, PDF).

### Not in scope

| Not this module | Owner |
|---|---|
| Enforcing approvals, keeping Gate 1/Gate 2 in every run, locking approved templates, checking approved vs executed hash before running | Samantha (Workflow Engine) |
| Template storage, saving AI-drafted templates, `is_active` flag, blocking deactivated templates | Samantha (Workflow Engine / template store) |
| AI template matching, NO_MATCH routing, drafting new templates from a prompt | AI Classification |
| Attachment content extraction (after Gate 1) | Samantha (Workflow Engine) |
| Login, issuing tokens, RBAC table, Integrations page and token vault, ingress whitelist and DKIM/SPF checks | Amirul |
| Deciding what is suspicious (alerting, anomaly detection) | Future work |

Audit must not import the internals of the AI classifier, the Workflow Engine or the auth module. Modules communicate only through §8.1 and the catalogue in §7.

### Ownership matrix

| Responsibility | Owner |
|---|---|
| Ingress (whitelist, DKIM/SPF) | Amirul |
| Standardization of incoming messages | Ain (Standardization) |
| AI template matching, NO_MATCH, drafting templates | AI Classification |
| Template storage, saving, deactivation enforcement | Workflow Engine / template store |
| Gate 1 / Gate 2 enforcement, approved-template locking | Workflow Engine |
| Approved-vs-executed hash enforcement (block execution) | Workflow Engine |
| Approved-vs-executed hash and gate order **recording and verification** | Audit |
| Event persistence, hashing, chain verification | Audit |
| Timeline, exports, provenance sealing and verification | Audit |

---

## 3. Locked rules

1. **Append-only.** No UPDATE/DELETE/TRUNCATE on `audit_events` or `provenance_records` (DB triggers + no such code paths). Corrections are new events. This applies to every role, including ADMIN.
2. **One record per step.** Never merge steps into one row; grouping by request is a query/display concern. (Required for O2.)
3. **Writes are serialized per workspace chain** so two events never link to the same previous hash (no fork).
4. **Hashes are computed in Python** with one canonical serializer (§5.2). The DB only stores and protects them.
5. **No secrets or payloads in events or provenance.** Details hold ids, codes, counts, labels and hashes. Never message bodies, attachment content, document content, full templates, **operator prompt text** (store `prompt_hash`), credentials, tokens or email addresses (store a hash instead).
6. **Audit writing is internal.** No public HTTP endpoint inserts audit records. Modules call `log_event()` in-process.
7. **Logging must not silently fail.** Every caller uses one of the three patterns in §8.2. State-changing and approval actions are fail-closed; read-only actions and access denials are best-effort.
8. **Timestamps are UTC**, set by the audit service (not the caller), serialized as `YYYY-MM-DDTHH:MM:SS.ffffffZ`.
9. **Roles and permissions.** Roles: ADMIN, OPERATOR, AUDITOR. Permissions are assigned as a **list per role, not by role ranking** (`user.role >= required_role` must not be used for audit permissions).

   | Permission | ADMIN | OPERATOR | AUDITOR |
   |---|---|---|---|
   | `audit:read` | ✅ | ✅ | ✅ |
   | `audit:verify` | ✅ | ✅ | ✅ |
   | `audit:export` | ❌ | ❌ | ✅ |

   Verify is open to all roles because it is read-only and its result is computed, not entered. Export stays with the AUDITOR (official slide; separation of duties).
10. **Domain-agnostic schema.** No dormitory-office (or any domain) columns in audit tables. Domain specifics live in `details` or in other modules.
11. Do not describe this module using the word "workflow" in docs/comments (supervisor's instruction). Naming Samantha's "Workflow Engine" is fine.
12. **Gates are fixed, templates are not.** Any template, including one drafted by the AI, runs between Gate 1 and Gate 2; a template cannot remove or skip a gate. The Workflow Engine enforces this. Audit records it and checks the order in `verify_lineage` (§8.5 check 7).

---

## 4. Current state (from the repo)

| Item | State | Action |
|---|---|---|
| `src/audit/__init__.py` | empty package | build the module here |
| `src/secure_api/schemas.py` sections 3–6 | audit/hash/export/provenance schemas in the wrong module | move to `src/audit/schemas.py`, then revise (§5) |
| `src/standardization/audit_port.py` | sync `AuditLogger` protocol, `NullAuditLogger`, `MemoryAuditLogger` | make async + add `session` (Phase 0); `AuditService` must satisfy it |
| `src/storage/` | folder exists | add `database.py`: async psycopg pool + transaction helper, shared by all modules (Phase 3 if nobody else has built it) |
| `server.py` | LangGraph graph: planner → gate_1 → doc_builder → gate_2; gates are `interrupt()`; checkpointer `MemorySaver`; `thread_id` created per job | use `thread_id` as `execution_id`; gates use pattern B (§8.2) |
| `requirements.txt` | no DB driver yet; `reportlab` present | add `psycopg[binary,pool]>=3.1` in Phase 3 |
| Sprint 1 DDL | only `users` and `workspaces` written out | write audit migrations (§6) |
| Prototype (CASE Console artifact, Audit Trail page) | chaining, tamper tests, grouped timeline, provenance | behavioural reference; see §16 for fixes |

---

## 5. Data model

### 5.1 Audit event

| Field | Type | Notes |
|---|---|---|
| `event_id` | UUID | not hashed |
| `workspace_id` | UUID | chain scope |
| `seq` | bigint | 1, 2, 3… per workspace, no gaps |
| `event_timestamp` | timestamptz | UTC, set by service |
| `execution_id` | text, nullable | the request id (`thread_id` from `server.py`), assigned at `JOB_RECEIVED`; null for standalone events (integration, whitelist, template changes made outside a request, security events) |
| `event_type` | enum | derived from the catalogue (§7): `USER_ACTION`, `AI_DECISION`, `SYSTEM_ACTION`, `APPROVAL_GATE`, `STATE_CHANGE`, `SECURITY_EVENT`, `INTEGRITY_EVENT` |
| `action` | text | catalogue (§7) |
| `actor_type` | `USER` \| `SYSTEM` \| `AI` | derived from role (§8.1) |
| `actor_id` | text | user id, `system`, or model name (e.g. `qwen3.5:9b`) |
| `actor_role` | text | ADMIN / OPERATOR / AUDITOR / SYSTEM / AI |
| `target_type`, `target_id` | text | split from `target` (`"execution:<id>"`, `"template:<id>"`, `"integration:<id>"`, `"workspace:<uuid>"`) |
| `source` | text | GMAIL, TELEGRAM, WEB_FORM, WEB_APP, SYSTEM; plus REST_API, JSON_FILE, EMAIL_SERVICE (reserved for future resources). Fixed list; anything else is rejected. Callers record an unknown channel as `SYSTEM` and put its name in `details.channel` |
| `outcome` | `SUCCESS` \| `FAILURE` | |
| `details` | jsonb | ids, codes, counts, labels, hashes; ≤ 8 KB canonical JSON |
| `previous_hash` | char(64) | genesis = 64 zeros |
| `current_hash` | char(64) | §5.2 |

### 5.2 Hash computation

```
current_hash = SHA-256( canonical_json([
    HASH_VERSION, seq, workspace_id, event_timestamp, execution_id, event_type, action,
    actor_type, actor_id, actor_role, target_type, target_id, source,
    outcome, details, previous_hash ]) )
```

`canonical_json` rules:
- `json.dumps(..., sort_keys=True, separators=(",", ":"), ensure_ascii=False)`, encoded UTF-8.
- UUIDs as lowercase strings.
- Datetimes: convert to UTC first, then `strftime("%Y-%m-%dT%H:%M:%S.%fZ")`. A value read back from Postgres must produce byte-identical output (test this).
- `Decimal` as string. **Floats are rejected** anywhere in `details` (non-deterministic). AI confidence is passed as a string, e.g. `"0.87"`.
- Strings containing `\u0000` are rejected (Postgres jsonb cannot store them).
- `event_id` is **not** hashed (random); `seq` is (detects reordering and gaps).
- `HASH_VERSION = 1` and the field list live in one constant in `canonical.py`.
- Any UI that shows the formula (e.g. the event detail page's "Recompute this hash") must list **exactly** these fields, taken from the same constant.

### 5.3 Chain head (detects tail truncation)

`audit_chain_heads(workspace_id PK, last_seq, last_hash, updated_at)` is updated in the same transaction as each insert. Verification compares the last event with the head. Verification results and exports include the head so it can be kept outside the system (anchoring, future work).

### 5.4 Provenance record (O3)

Written **once**, when the request is closed (`EXECUTION_CLOSED`, §7).

| Field | Content |
|---|---|
| `provenance_id`, `workspace_id`, `execution_id` | |
| `objective` | `source`, `request_ref`, intent label from classification (readable objective), `std_message_output_hash` |
| `decision` | `classification_outcome` (SELECTED / NO_MATCH), `ai_suggested_template_id` (null on NO_MATCH), `template_choice` (AI_SUGGESTED / OPERATOR_SWITCHED / OPERATOR_REQUESTED_NEW), `template_id`, `template_version`, `source_template_hash`, `template_created_in_request` (bool), `ai_confidence` (string; recorded, **not** treated as calibrated), `working_copy_revision`, `final_working_copy_hash` |
| `approvals` | list of `{gate, decision, by, role, at, approved_hash, comment_hash}`; Gate 1 `approved_hash` = approved template/plan hash, Gate 2 = document hash |
| `execution` | `approved_template_hash`, `executed_template_hash`, `hashes_match` (null if execution never started) |
| `result` | `final_status` (DELIVERED / REJECTED_GATE1 / REJECTED_GATE2 / UNSUPPORTED / FAILED), `recipient_hash`, `document_hash` |
| `event_ids`, `event_hashes` | ordered by `seq`; all events of this `execution_id` up to and including `EXECUTION_CLOSED` |
| `lineage_hash` | `SHA-256(canonical_json(event_hashes))` |
| `record_hash` | `SHA-256(canonical_json(all fields above except record_hash))` |
| `sealed_at` | UTC |

`template_choice` is derived from the request's events: no `TEMPLATE_MANUALLY_SELECTED` or `TEMPLATE_REQUESTED` → AI_SUGGESTED; `TEMPLATE_MANUALLY_SELECTED` → OPERATOR_SWITCHED; `TEMPLATE_REQUESTED` → OPERATOR_REQUESTED_NEW. This lets an auditor see when a human changed the AI's decision.

Requests that never start execution (NO_MATCH then rejected by the OPERATOR) are not a special case: they still have an `execution_id` from `JOB_RECEIVED` and are sealed with `final_status = UNSUPPORTED`.

### 5.5 Verification result

Stored in `hash_chain_verifications`:

| Field | Notes |
|---|---|
| `verification_id`, `workspace_id`, `verified_by`, `verified_role`, `verified_at` | |
| `from_seq`, `to_seq`, `events_checked` | |
| `status` | `VERIFIED` \| `BROKEN` |
| `broken_at_seq`, `reason`, `unverifiable_after` | null when VERIFIED |
| `head_seq`, `head_hash` | chain head used for the comparison |
| `last_found_seq`, `last_found_hash` | last event actually found |
| `duration_ms` | |

Logged as `AUDIT_INTEGRITY_VERIFIED` / `AUDIT_INTEGRITY_FAILED`. The four head fields are what the Audit Trail page shows side by side, so a deleted last record is visible (head says seq 250, last found is seq 249).

---

## 6. Database migrations

Plain numbered SQL files in `backend/migrations/` unless the team picks a tool.

Tables:
- `audit_events` (§5.1): `UNIQUE (workspace_id, seq)`; indexes `(workspace_id, event_timestamp DESC)`, `(workspace_id, execution_id, seq)`, `(workspace_id, action)`.
- `audit_chain_heads` (§5.3).
- `provenance_records` (§5.4): `UNIQUE (workspace_id, execution_id)`.
- `hash_chain_verifications` (§5.5).
- `audit_exports` (who, when, format, filters, record count, head seq, head hash, file hash).

Protection:
- **Immutability triggers** on `audit_events` and `provenance_records`: row-level `BEFORE UPDATE OR DELETE → RAISE EXCEPTION`, plus statement-level `BEFORE TRUNCATE → RAISE EXCEPTION` (row triggers do not fire on TRUNCATE).
- **Head trigger** on `audit_chain_heads`: `BEFORE UPDATE` requires `NEW.last_seq = OLD.last_seq + 1` and that an `audit_events` row exists with `(workspace_id, NEW.last_seq, NEW.last_hash)`; `BEFORE DELETE OR TRUNCATE → RAISE EXCEPTION`. (The event is inserted before the head is updated.)
- **Role split:** migrations run as the owner role (e.g. `case_owner`). The app connects as `case_app`, which is not the owner, so it cannot `ALTER TABLE ... DISABLE TRIGGER`.
- Grants to `case_app`: `INSERT, SELECT` on `audit_events`, `provenance_records`, `hash_chain_verifications`, `audit_exports`; `INSERT, SELECT, UPDATE` on `audit_chain_heads`.
- No partitioning and no automatic deletion for the FYP (deleting or dropping old partitions would break verification). Note as future work.

---

## 7. Event catalogue

One `AuditAction` enum in `catalogue.py`, each mapped to its `event_type`. Unknown actions are rejected. New actions can be added without changing the hashing algorithm.

| Area | Action | event_type | Emitted by |
|---|---|---|---|
| Ingress | `JOB_RECEIVED` | SYSTEM_ACTION | Ingress |
| | `INGRESS_REJECTED_NOT_WHITELISTED`, `INGRESS_REJECTED_DKIM_FAIL` | SECURITY_EVENT | Ingress |
| Standardization | `MESSAGE_STANDARDIZED`, `STANDARDIZATION_FAILED` | SYSTEM_ACTION | Standardization |
| | `DATA_STANDARDIZED` *(reserved for future resources; not emitted in the MVP)* | SYSTEM_ACTION | Standardization |
| AI | `AI_TEMPLATE_SELECTED`, `AI_TEMPLATE_NO_MATCH`, `AI_TEMPLATE_DRAFTED`, `AI_CONTENT_GENERATED` | AI_DECISION | AI Classification / Workflow Engine |
| Template | `TEMPLATE_MANUALLY_SELECTED`, `TEMPLATE_REQUESTED`, `TEMPLATE_CREATED`, `TEMPLATE_DEACTIVATED`, `EXECUTION_TEMPLATE_MODIFIED`, `REQUEST_UNSUPPORTED` | USER_ACTION | Workflow Engine / template store |
| | `TEMPLATE_INSTANTIATED` | SYSTEM_ACTION | Workflow Engine |
| | `EXECUTION_TEMPLATE_MODIFY_REJECTED` | SECURITY_EVENT | Workflow Engine |
| Gates | `GATE1_SUBMITTED` | STATE_CHANGE | Workflow Engine |
| | `GATE1_APPROVED`, `GATE1_REJECTED`, `GATE2_APPROVED`, `GATE2_REJECTED` | APPROVAL_GATE | Workflow Engine |
| Execution | `EXECUTION_STARTED`, `EXECUTION_FAILED`, `EXECUTION_CLOSED` | STATE_CHANGE | Workflow Engine |
| | `ATTACHMENT_EXTRACTED` | SYSTEM_ACTION | Workflow Engine |
| Output | `DOCUMENT_GENERATED`, `JOB_DELIVERED` | SYSTEM_ACTION | Workflow Engine |
| Integrations | `INTEGRATION_CONNECTED`, `INTEGRATION_DISCONNECTED` | USER_ACTION | Integrations (Amirul) |
| Security | `ACCESS_FORBIDDEN`, `AUTH_FAILED` | SECURITY_EVENT | Any module's routes / auth |
| | `WHITELIST_ADDED`, `WHITELIST_REMOVED` | SECURITY_EVENT | Ingress (Amirul) |
| Audit | `AUDIT_INTEGRITY_VERIFIED`, `AUDIT_INTEGRITY_FAILED`, `LINEAGE_VERIFIED`, `LINEAGE_VERIFICATION_FAILED`, `AUDIT_EXPORTED`, `PROVENANCE_RECORDED` | INTEGRITY_EVENT | Audit |

### Required details (validated with a Pydantic model per action)

| Action | Required keys |
|---|---|
| `MESSAGE_STANDARDIZED` | `adapter`, `schema`, `input_hash`, `output_hash`, `body_truncated`, `attachment_count` |
| `STANDARDIZATION_FAILED` | `stage` (`message` \| `resource`), `source`, `code`, `error_fields` (field names only; `channel` only when the channel is unknown) |
| `AI_TEMPLATE_SELECTED` | `template_id`, `template_version`, `source_template_hash`, `confidence` (string) |
| `AI_TEMPLATE_NO_MATCH` | `candidates_checked` (count), `reason_code` |
| `TEMPLATE_MANUALLY_SELECTED` | `ai_template_id` (null after NO_MATCH), `template_id`, `template_version`, `source_template_hash` |
| `TEMPLATE_REQUESTED` | `prompt_hash` |
| `AI_TEMPLATE_DRAFTED` | `template_id`, `template_version`, `template_hash`, `prompt_hash` |
| `TEMPLATE_CREATED` | `template_id`, `template_version`, `template_hash`, `origin` (`MANUAL` \| `AI_DRAFTED`) |
| `TEMPLATE_DEACTIVATED` | `template_id`, `template_version`, `reason_code` |
| `TEMPLATE_INSTANTIATED` | `template_id`, `template_version`, `working_copy_id`, `revision`, `content_hash` |
| `EXECUTION_TEMPLATE_MODIFIED` | `working_copy_id`, `revision`, `previous_hash`, `content_hash`, `changed_fields` (names only) |
| `GATE1_APPROVED` / `GATE1_REJECTED` | `revision`, `approved_template_hash` (approved only), `comment_hash` (optional) |
| `GATE2_APPROVED` / `GATE2_REJECTED` | `document_hash`, `comment_hash` (optional) |
| `EXECUTION_STARTED` | `approved_template_hash`, `executed_template_hash` |
| `ATTACHMENT_EXTRACTED` | `attachment_count`, `file_hashes` (list), `extracted_chars` (count) |
| `EXECUTION_CLOSED` | `final_status` |
| `INTEGRATION_CONNECTED` / `INTEGRATION_DISCONNECTED` | `integration_id`, `channel` (`GMAIL` \| `TELEGRAM`), `scope_label` |
| `AUDIT_INTEGRITY_VERIFIED` / `AUDIT_INTEGRITY_FAILED` | `verification_id`, `events_checked`, `head_seq`, `head_hash`, `broken_at_seq` (failed only) |
| `PROVENANCE_RECORDED` | `provenance_id`, `event_count`, `lineage_hash`, `record_hash` |

`TEMPLATE_CREATED` carries the request's `execution_id` when the template was created during a request (so it appears in that request's lineage), and null when created outside a request (e.g. by the dev team for the demo).

Other actions: free-form details, still checked for forbidden keys and size.

**Forbidden keys** (checked recursively, case-insensitive): `body`, `body_text`, `content`, `raw`, `prompt`, `prompt_text`, `password`, `token`, `secret`, `api_key`, `credentials` (whole-key match, so `content_hash` and `prompt_hash` stay valid), plus any key ending in `_token`, `_secret`, `_password`, `_api_key` or `_credentials` (e.g. `bot_token`, `access_token`). There is no `body_` prefix rule (`body_truncated` is valid).

---

## 8. Components

```
src/audit/
├── schemas.py         # moved + revised models (event, timeline entry, provenance, verification, export)
├── catalogue.py       # AuditAction enum, event_type mapping, required-details models, terminal statuses, gate-order rules
├── canonical.py       # HASH_VERSION, HASH_FIELDS, canonical_json(), compute_event_hash(), compute_lineage_hash(), compute_record_hash()
├── repository.py      # AuditRepository (async psycopg) + InMemoryAuditRepository (tests)
├── service.py         # AuditService: log_event(), seal_provenance()  ← implements AuditLogger
├── verifier.py        # verify_chain(), verify_lineage()
├── queries.py         # query_timeline() flat + grouped, event detail with neighbours, lineage view
├── export.py          # export_audit(): JSON; PDF via reportlab
└── routes.py          # read-only API (§9)
```

### 8.1 Interface: `log_event`

Phase 0 changes `standardization/audit_port.py` to:

```python
class AuditLogger(Protocol):
    async def log_event(self, *, workspace_id: str, actor: str, role: str, action: str,
                        target: str, source: str, outcome: str, details: dict[str, Any],
                        execution_id: str | None = None,
                        session: AsyncConnection | None = None) -> None: ...
```

`NullAuditLogger` and `MemoryAuditLogger` become async too, and `standardize_message` / `standardize_resource` become async (Standardization is also owned by Ain).

`AuditService.log_event` satisfies this protocol and returns `None`. Internally it calls `append_event(...) -> AuditEvent`, which tests can use directly.

Mapping from protocol keywords to stored fields:

| Keyword | Stored as |
|---|---|
| `actor` | `actor_id` |
| `role` | `actor_role`; `actor_type` = `SYSTEM` if role is SYSTEM, `AI` if role is AI, otherwise `USER` |
| `target` | split on the first `:` into `target_type`, `target_id`; anything else is rejected |
| `action` | `action`; `event_type` looked up from the catalogue |

Steps:
1. Validate `action`, `outcome`, `target` format, required details, forbidden keys, size, no floats.
2. Use `session` if given, otherwise open a transaction from the shared pool.
3. `SELECT pg_advisory_xact_lock(hashtextextended(%s::text, 0))` with `workspace_id`.
4. Read the `audit_chain_heads` row `FOR UPDATE`; genesis if none.
5. Build the event: `seq = last_seq + 1`, `previous_hash = last_hash`, server UTC timestamp.
6. Compute `current_hash`; insert event; insert or update head.
7. Commit **only if Audit opened the transaction**. With a caller `session`, never commit; the caller commits.

### 8.2 Three logging patterns (fail-closed rules)

| Pattern | When | How | If audit write fails |
|---|---|---|---|
| **A. Shared transaction** | State change stored in our Postgres: whitelist changes, integration connect/disconnect, template created/deactivated | Caller opens a transaction, applies the change, calls `log_event(..., session=tx)` as the **last** step, then commits | Whole transaction rolls back; the change does not happen |
| **B. Log before act** | Actions whose state is not in our Postgres transaction: Gate 1/Gate 2 decisions (LangGraph `interrupt()` + `MemorySaver`), `EXECUTION_STARTED` | Approval endpoint calls `log_event` (Audit commits), and resumes the graph **only after** that succeeds | Graph is not resumed; the API returns an error; nothing executes |
| **C. Best-effort** | Read-only actions, `ACCESS_FORBIDDEN`, `AUTH_FAILED` | Call `log_event`; on failure write a warning to the app logger (no secrets) | Normal response / 403 / 401 is still returned |

Notes:
- Pattern A keeps the advisory lock short because the audit insert is the last statement before commit.
- Pattern A applies to template events only if the template store is in the same Postgres database (§12.2 #1). Otherwise the template store uses pattern B.
- Pattern B's only failure mode is "approval logged but graph not resumed", which is safe and visible in the timeline (an approval with no `EXECUTION_STARTED`).
- External side effects (sending email/Telegram) cannot be rolled back. `GATE2_APPROVED` is logged before sending; `JOB_DELIVERED` is logged after the send succeeds, with one retry. If that log still fails, the timeline shows `GATE2_APPROVED` without `JOB_DELIVERED` (stated as a limitation in §15).

### 8.3 `verify_chain(workspace_id, from_seq=None, to_seq=None)`

Walk events by `seq` in batches of 1,000. For each event:
- `seq` not the expected next value → **gap** (deleted record)
- `previous_hash` ≠ prior `current_hash` → **link broken** (prior record changed and re-hashed)
- recomputed hash ≠ stored → **record modified**

Then compare with `audit_chain_heads`:
- head `last_seq` > last event `seq` → **tail truncated**
- events exist beyond head `last_seq` → **inserted outside log_event**
- same seq but hash differs → **head mismatch**

Stop at the first break. Return the §5.5 result, always including `head_seq`, `head_hash`, `last_found_seq`, `last_found_hash` (also when VERIFIED). Report `broken_at_seq`, reason, and the count of later records that are unverifiable. Target: 10,000 events < 2 s.

### 8.4 `seal_provenance(workspace_id, execution_id)`

Called explicitly by the Workflow Engine right after it logs `EXECUTION_CLOSED`.

1. Load all events of `execution_id`, ordered by `seq`.
2. Require exactly one `EXECUTION_CLOSED`; its `final_status` becomes `result.final_status`. Otherwise reject (`NOT_CLOSED`).
3. Verify the workspace chain up to that event's `seq`. If broken, reject (`CHAIN_BROKEN`) and log `AUDIT_INTEGRITY_FAILED`.
4. Build the record (§5.4) from event details, including `template_choice`. `PROVENANCE_RECORDED` is never in the event set (it does not exist yet), so there is no circular hash.
5. Compute `lineage_hash`, then `record_hash`.
6. In **one** Audit-owned transaction: insert the provenance record, then `log_event(PROVENANCE_RECORDED, session=tx)`; commit.
7. Idempotent: if a record already exists for `(workspace_id, execution_id)`, return it unchanged (unique constraint + `ON CONFLICT DO NOTHING` then select).

### 8.5 `verify_lineage(workspace_id, execution_id)`

Checks, reporting every failure (not only the first):
1. `record_hash` recomputes from the stored record.
2. Every listed event exists and its stored `current_hash` equals the listed hash (else **event modified** / **event missing**).
3. `lineage_hash` recomputes from `event_hashes`.
4. The chain verifies up to the `PROVENANCE_RECORDED` event.
5. `PROVENANCE_RECORDED` exists and its details match `provenance_id`, `lineage_hash`, `record_hash`.
6. If execution started: `approved_template_hash == executed_template_hash`.
7. **Gate order** (rules in `catalogue.py`), by `seq`:
   - `EXECUTION_STARTED`, `ATTACHMENT_EXTRACTED`, `AI_CONTENT_GENERATED` and `DOCUMENT_GENERATED` appear only after a `GATE1_APPROVED` for this request.
   - `JOB_DELIVERED` appears only after a `GATE2_APPROVED` for this request.
   - Violation → **order violation** with the offending event's `seq`.

Result `VALID` or `INVALID` with reasons; logged as `LINEAGE_VERIFIED` / `LINEAGE_VERIFICATION_FAILED`.

A passing result proves the record and events are unchanged and that the recorded order respected both gates. It does not prove the AI classification or the human decision was correct.

### 8.6 Exports

- **JSON:** events, provenance records, latest verification result, chain head (`head_seq`, `head_hash`, timestamp). Must re-verify offline with `canonical.py` alone.
- **PDF (reportlab):** page 1 has a box: *"Chain head at export: seq N · <hash> · <UTC time>. Keep this value. If a later export shows a different hash for seq N, the records were altered."* Then integrity status, request summaries (Objective → Decision → Approval → Result), and the event table.
- Each export writes an `audit_exports` row and logs `AUDIT_EXPORTED` (format, record count, head seq, file hash).

---

## 9. API (read-only, `/api/v1/audit`)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/events` | `audit:read` | Flat timeline; filters: date range, action, actor, role, outcome, execution_id; paginated |
| GET | `/executions` | `audit:read` | One row per request: lineage summary (Objective → Decision → Approval → Result), record count, integrity status |
| GET | `/executions/{execution_id}` | `audit:read` | All events of one request + provenance record |
| GET | `/events/{event_id}` | `audit:read` | One event + previous/next hashes (chain view) |
| POST | `/verify` | `audit:verify` | Run `verify_chain` (optional seq range); response includes the four head fields (§5.5) for the Verify result card |
| GET | `/verifications` | `audit:read` | Past verification results |
| POST | `/executions/{execution_id}/verify-lineage` | `audit:verify` | Run `verify_lineage` |
| POST | `/export` | `audit:export` | JSON or PDF (§8.6); logs `AUDIT_EXPORTED` |

All endpoints use the central auth dependencies `get_current_user` and `require_permission` from the auth/RBAC owner (Amirul; location to confirm, §12.2 #6). Until those exist, use a mock provider behind `AUTH_MODE=mock`. Endpoints filter by the caller's `workspace_id` and use the shared response envelope. The permissions `audit:read`, `audit:verify`, `audit:export` must exist in the central role → permission table with the mapping in §3 rule 9.

The backend check is the real control. Hiding the Export button for non-auditors in the frontend is only for display.

---

## 10. Tests (target ≥ 85% coverage for `src/audit`)

**Canonical hashing**
- Same event → same hash; key order irrelevant.
- Float in details rejected; Decimal/UUID/datetime serialized consistently.
- Datetime round trip through Postgres gives the same hash (integration).

**Chain building and interface**
- Genesis, sequential seq, head updated.
- Protocol mapping: `actor`/`role`/`target` split correctly; bad `target` format rejected; unknown action rejected; missing required details rejected.
- Forbidden keys (nested too, including `prompt`), oversized details, `\u0000` rejected.
- `AuditService` passes the same tests Standardization runs against `MemoryAuditLogger`.

**Concurrency and isolation**
- 50 parallel `log_event` calls in one workspace → seq 1..50, no duplicates, chain verifies (Postgres integration; in-memory repo uses an `asyncio.Lock`).
- Workspace chains are independent; workspace A cannot read B's events (404/empty).

**Tamper detection (O2)** — edit stored rows directly in tests:
- Edit without re-hash → `record modified` at that seq.
- Edit + re-hash → `link broken` at the next seq.
- Delete middle → `gap`. Delete last → `tail truncated`, and the result has `last_found_seq < head_seq` with both values returned. Reorder → detected.
- Row inserted bypassing `log_event` → `inserted outside log_event`.
- A VERIFIED result also returns the head fields, with `last_found_seq == head_seq`.

**DB protection (integration)**
- UPDATE, DELETE and TRUNCATE on `audit_events` and `provenance_records` raise.
- Head can only advance by one to an existing event.
- `case_app` cannot disable triggers.

**Transactions (§8.2)**
- Pattern A: failing audit write rolls back the whitelist / integration change.
- Pattern B: failing audit write means the graph is not resumed.
- Pattern C: failing audit write still returns 403.

**Provenance (O3)**
- Sealed once (idempotent); refuses without `EXECUTION_CLOSED`; refuses on a broken chain.
- Lineage verifies. Changed provenance field → `record_hash` mismatch. Changed included event → mismatch. Missing event → reported.
- Approved ≠ executed hash → reported.
- `PROVENANCE_RECORDED` is not in its own lineage.
- `template_choice` derived correctly for AI_SUGGESTED, OPERATOR_SWITCHED and OPERATOR_REQUESTED_NEW.
- Gate order: `DOCUMENT_GENERATED` before `GATE1_APPROVED` → order violation; `JOB_DELIVERED` without `GATE2_APPROVED` → order violation.

**Exports**
- JSON contains the head and passes re-verification offline. PDF generated with the chain head box on page 1. `AUDIT_EXPORTED` logged.

**API RBAC**
- All three roles can read and verify. Only AUDITOR can export; ADMIN and OPERATOR get 403 on export, logged as `ACCESS_FORBIDDEN`.

**Performance**
- Verify 10,000 in-memory events < 2 s.

**Mock scenarios** (synthetic events; reused later as end-to-end tests and as the demo script)
- **A. Normal:** AI selects a template → OPERATOR accepts → Gate 1 approved → executed (attachment extracted, content generated) → Gate 2 approved → delivered → closed → sealed → lineage valid, `template_choice = AI_SUGGESTED`.
- **B. No match:** `AI_TEMPLATE_NO_MATCH` → OPERATOR rejects (`REQUEST_UNSUPPORTED`) → closed `UNSUPPORTED` → sealed, no execution.
- **C. Operator switches:** AI selects template X → OPERATOR picks template Y (`TEMPLATE_MANUALLY_SELECTED`) → normal path; provenance shows X and Y, `template_choice = OPERATOR_SWITCHED`.
- **D. Operator requests new template:** `TEMPLATE_REQUESTED` → `AI_TEMPLATE_DRAFTED` → `TEMPLATE_CREATED` (`origin = AI_DRAFTED`) → normal path through both gates; `template_choice = OPERATOR_REQUESTED_NEW`.
- **E. Post-approval edit:** edit after Gate 1 → `EXECUTION_TEMPLATE_MODIFY_REJECTED` recorded; lineage still valid; approved = executed.
- **F. Audit failure at approval:** audit write fails → graph not resumed, no `EXECUTION_STARTED`.
- **G. Gate skipped (negative test):** synthetic request with `DOCUMENT_GENERATED` and no `GATE1_APPROVED` → `verify_lineage` reports order violation.

---

## 11. Implementation phases

| Phase | Work | Done when |
|---|---|---|
| **0. Move + interface** | Move audit schemas from `secure_api/schemas.py` to `src/audit/schemas.py`; make `audit_port` async with `session`; update Standardization to async; fix imports | All existing tests pass |
| **1. Core** | `catalogue.py`, `canonical.py`, `InMemoryAuditRepository`, `AuditService.log_event` | Hashing, mapping, chain, forbidden-details tests pass |
| **2. Verify** | `verifier.verify_chain` with chain head, head fields in the result, all tamper cases | Tamper + performance tests pass |
| **3. Postgres** | `src/storage/database.py` (if not built yet), migrations (§6), `AuditRepository`, advisory lock, triggers, role split | Concurrency, protection and pattern-A tests pass |
| **4. Provenance** | `seal_provenance`, `verify_lineage` incl. gate order | Provenance tests + scenarios A–E and G (in-memory) pass |
| **5. Read API + export** | `queries.py`, `routes.py` (mock auth until Amirul's is ready), `export.py` | API, RBAC and export tests pass |
| **6. Plug in** | Replace `NullAuditLogger` in Standardization; give `AuditService` to Ingress, Integrations and the Workflow Engine; with Samantha: gate endpoints use pattern B, engine logs template/attachment/`EXECUTION_CLOSED` events and calls `seal_provenance`; switch to real auth | End-to-end demo shows one request's full lineage, scenario F, and a tamper test failing verification with the head values on screen |

### Schedule (deadline late Nov / early Dec 2026)

Re-based from 19 Oct. If Phase 0 or 1 is already done, move everything up by that amount.

| Week | Audit |
|---|---|
| 1 (19–25 Oct) | Phase 0, Phase 1 |
| 2 (26 Oct–1 Nov) | Phase 2 |
| 3 (2–8 Nov) | Phase 3 (incl. shared DB foundation) |
| 4 (9–15 Nov) | Phase 4 |
| 5 (16–22 Nov) | Phase 5 |
| 6 (23–29 Nov) | Phase 6 with Samantha and Amirul, scenarios A–G end-to-end, demo prep |

Phases 1, 2 and 4 need no database (in-memory repository). Phase 5 can start with mock auth.

---

## 12. Decisions

### 12.1 Resolved (inform the team)

1. Read-only actions and access denials: best-effort (pattern C). State changes and approvals: fail-closed (patterns A/B).
2. `audit:read` and `audit:verify`: all roles. `audit:export`: AUDITOR only. Permission list per role, not role ranking. *(changed in v1.2)*
3. No partitioning and no automatic deletion for the FYP.
4. `seal_provenance` is called explicitly by the Workflow Engine after `EXECUTION_CLOSED`.
5. Template editing events (`EXECUTION_TEMPLATE_MODIFIED`) are in the catalogue; they are emitted only if the engine implements editing.
6. Requests without execution use the same `execution_id` from `JOB_RECEIVED` and are sealed as `UNSUPPORTED`.
7. Terminal state is signalled by `EXECUTION_CLOSED`, so Audit does not depend on the engine's internal state machine.
8. AI suggests a template; the OPERATOR can accept, switch, or request a new one by prompt. *(v1.2)*
9. Operator-requested templates are saved for reuse without ADMIN approval; ADMIN can deactivate. Gate 1 is the control point. ADMIN approval of templates is future work. *(v1.2)*
10. No data fetch after Gate 1. CASE processes only what is sent to it. *(v1.2)*
11. Gates cannot be removed by any template; Audit checks gate order in `verify_lineage`. *(v1.2)*

### 12.2 Still to confirm with the team

| # | Question | With |
|---|---|---|
| 1 | All modules run in one FastAPI app and one Postgres database (assumed yes, per `server.py`); template store in the same DB | Team |
| 2 | Engine emits the §7 events from its nodes (including template, `ATTACHMENT_EXTRACTED`, `EXECUTION_CLOSED`), uses pattern B for gates, and calls `seal_provenance` | Samantha |
| 3 | Working copies and editing before Gate 1 (Appendix A); whether Gate 1 rejection allows re-edit or closes the request | Samantha |
| 4 | Template store: saving AI-drafted templates, `is_active` flag, deactivated templates not offered to the AI | Samantha |
| 5 | AI side emits `AI_TEMPLATE_SELECTED` / `AI_TEMPLATE_NO_MATCH` / `AI_TEMPLATE_DRAFTED` with the required details | AI Classification owner |
| 6 | Where the central `rbac.py`, `get_current_user` and `require_permission` live (`src/security/` proposed), permission-list approach, and JWT format (`user_id`, `workspace_id`, `role`; Bearer header) | Amirul |
| 7 | Integrations page emits `INTEGRATION_CONNECTED` / `INTEGRATION_DISCONNECTED`; ingress emits `JOB_RECEIVED`, `INGRESS_REJECTED_*` and `WHITELIST_*` | Amirul |
| 8 | Secure API Layer: with data fetch removed, its remaining parts (JWT/RBAC, whitelist, token vault) move to auth and ingress, and the module is dropped | Team (and inform supervisor) |
| 9 | Who builds `src/storage/database.py` (shared pool); Audit builds it in Phase 3 if nobody else has | Team |

---

## 13. Acceptance criteria

- [ ] `AuditService` implements the async `AuditLogger` protocol and is used by Standardization and the other modules
- [ ] Append-only enforced by code and DB triggers (UPDATE, DELETE, TRUNCATE); app role is not the table owner
- [ ] Per-workspace chain with no forks under concurrency
- [ ] `verify_chain` detects modify / re-hash / delete-middle / delete-tail / reorder / out-of-band insert, names the exact record, and returns the chain head values (O2)
- [ ] Timeline flat and grouped by request (O1)
- [ ] Provenance record per closed request with verifiable `lineage_hash` and `record_hash`, approved-vs-executed hashes, `template_choice` and gate order check (O3)
- [ ] Logging patterns A/B/C implemented and tested; scenario F passes
- [ ] JSON + PDF export with chain head (PDF shows it on page 1)
- [ ] Permissions per §3 rule 9, enforced in the backend
- [ ] No payloads, prompts or secrets in any event or provenance record
- [ ] ≥ 85% coverage; all tests pass

---

## 14. Prompts for Claude in VS Code (one at a time)

1. *"Read docs/audit/AUDIT_MODULE_PLAN.md (v1.2), the standardization spec, server.py, src/audit, src/standardization/audit_port.py and src/secure_api/schemas.py. List what Phase 0 changes, which Standardization tests are affected by going async, and any questions. Don't edit yet."*
2. *"Do Phase 0. Commit. Report test results."*
3. *"Do Phase 1 (§5.1–5.2, §7, §8.1) with the in-memory repository. Write the §10 tests that apply. Commit."*
4. *"Do Phase 2 (§5.3, §5.5, §8.3) including every tamper case, the head fields and the performance test. Commit."*
5. *"Do Phase 3 (§6, §8.2 pattern A), src/storage/database.py if missing, and the Postgres repository with the advisory lock. Integration tests marked `integration`. Commit."*
6. *"Do Phase 4 (§5.4, §8.4, §8.5 incl. gate order) and mock scenarios A–E and G in-memory. Commit."*
7. *"Do Phase 5 (§8.6, §9) with mock auth. Reach ≥85% coverage and check §13. Report."*

---

## 15. For the FYP report

**Objective mapping:** O1 → timeline (§9), O2 → hash chain + chain head + verifier (§5.2, §5.3, §8.3), O3 → provenance record + lineage and record hashes (§5.4, §8.4–8.5). The objectives themselves are unchanged from the slide.

**Why per-event records plus a provenance record:** per-event granularity is needed to locate the exact broken record (O2); the provenance record makes the whole lineage retrievable in one query (O3).

**Example of what lineage shows (O3):** the chain proves attachments were read and the output was generated only after Gate 1 approval, and delivered only after Gate 2 (`GATE1_APPROVED` → `ATTACHMENT_EXTRACTED` → `AI_CONTENT_GENERATED` → `GATE2_APPROVED` → `JOB_DELIVERED`, in `seq` order). It also shows whether a human changed the AI's template choice.

### Design changes since Sprint 1 / proposal

| Earlier design | v1.2 | Reason |
|---|---|---|
| Node.js / Express (proposal) | Python / FastAPI | `server.py` (LangGraph + Ollama) and Pydantic schemas already in Python |
| Data fetched from enterprise resources after Gate 1 (REST API, JSON file, email service) | No data fetch; CASE processes only the request and its attachments | Minimises access to organisational systems and reduces complexity; adapters for REST/JSON remain as an extension point |
| AI selects only among predefined templates | AI suggests; OPERATOR can switch or request a new AI-drafted template; Gate 1 approves the final plan | Flexibility for requests no template fits, while keeping human approval before anything runs |
| Hash computed by DB functions | Python canonical serializer | One tested implementation; same code verifies exports offline |
| Denormalized `audit_timeline` table synced by trigger | Indexed queries on `audit_events` | Avoids a second copy that could disagree with the chain |
| `decision_records` + `execution_results` tables | One `provenance_records` row + event details | Full lineage retrievable as one record (O3) |
| Per-event `hash_chain_verification` rows | One result per verification run | Reports the first break and its reason (O2) |
| Roles Admin / Developer / Auditor | ADMIN / OPERATOR / AUDITOR | Official slide |
| Time partitioning + 90-day archive | None for the FYP | Deleting old records breaks verification; FYP volume is small |
| Row-level security | Workspace filter enforced in every repository query | Simpler for the FYP; RLS listed as future work |

### Limitations (state honestly)
- A hash chain proves **integrity** (changes are detectable), not **non-repudiation**. An administrator with full DB owner access could rebuild the whole chain; the chain head in every verification result and export allows external comparison. Future work: periodic external anchoring or digital signatures.
- A valid chain does not prove every action was logged; patterns A/B reduce this for state changes and approvals.
- The gate order check proves the **recorded** order; enforcement before execution is the Workflow Engine's job.
- With pattern B, an approval can be logged without the execution starting (safe, and visible in the timeline).
- External side effects (sent messages) cannot be rolled back; delivery logging is after the send.
- Saved templates are not reviewed before reuse; Gate 1 remains the control point. ADMIN approval of templates is future work.
- CASE cannot complete tasks that need data outside the request unless the user attaches it. Connecting further resources is future work.
- Matching hashes prove content consistency, not that the AI choice or the human decision was correct.
- AI confidence is recorded as reported by the model and is not calibrated.

### Future work
- External anchoring or signing of the chain head.
- ADMIN approval of templates before reuse.
- Further resources (REST API, JSON file, databases) through new adapters after Gate 1; the AI, gates and audit layer stay unchanged.
- Row-level security, archiving by moving (not deleting) partitions.

---

## 16. Slide and prototype alignment (not code)

| Where | Current | Change to |
|---|---|---|
| Audit Trail prototype, event detail | Hash formula lists 10 fields | The exact §5.2 field list |
| Audit Trail prototype, header | Export report (JSON) only | JSON and PDF |
| Audit Trail prototype, verify banner | Status and event count | Add chain head and last record found (§5.5) |
| Architecture slide, Audit box | Shown as layer 7 after the Workflow Engine; "Workflow Metadata", "Workflow Provenance" | Shown alongside all layers (records each step); "Execution Metadata", "Request Provenance" |
| Ingress whitelisting slide | `INGRESS_REJECTED` | `INGRESS_REJECTED_NOT_WHITELISTED` / `INGRESS_REJECTED_DKIM_FAIL` |
| System flow slide, Template Picked | AI selects "autonomously" | AI suggests a template; Operator can change it or request a new one |
| RBAC slide | `user.role >= required_role`; ADMIN full CRUD | Permission list per role; audit records cannot be updated or deleted by any role |

---

## Appendix A — Expected behaviour of other modules (to confirm with Samantha)

Audit is built to record this lifecycle. Enforcement belongs to the Workflow Engine, template store and AI owners, not to Audit.

**Request lifecycle**
1. Templates exist in the Workspace Library (built by the dev team for the demo, or saved by an OPERATOR, step 4).
2. A request arrives through Gmail, Telegram or the web form, is whitelisted and standardized.
3. AI classification suggests a template (`AI_TEMPLATE_SELECTED`) or returns NO_MATCH.
4. The OPERATOR either:
   - accepts the suggestion,
   - switches to another library template (`TEMPLATE_MANUALLY_SELECTED`), or
   - requests a new template through a prompt (`TEMPLATE_REQUESTED`); the AI drafts it (`AI_TEMPLATE_DRAFTED`); the OPERATOR reviews and saves it (`TEMPLATE_CREATED`, `origin = AI_DRAFTED`). It is immediately reusable, no ADMIN approval.
   On NO_MATCH the OPERATOR can also reject the request (`REQUEST_UNSUPPORTED`).
5. The engine creates an execution-specific working copy (`TEMPLATE_INSTANTIATED`). Editing it never changes the library template.
6. The working copy is submitted for Gate 1. The exact approved revision is the one executed.
7. After Gate 1: attachments are extracted (`ATTACHMENT_EXTRACTED`), the AI generates the output, the document is built.
8. Gate 2 review, delivery, then the request is closed and provenance is sealed.

ADMIN can deactivate a template at any time (`TEMPLATE_DEACTIVATED`). Deactivated templates are not offered to the AI or the OPERATOR; past requests that used them keep their provenance.

Every template, including AI-drafted ones, runs between Gate 1 and Gate 2. A template cannot define, skip or remove a gate.

**Working-copy states (assumed)**

| State | Editing |
|---|---|
| Draft | Editable |
| Pending Gate 1 | Read-only |
| Gate 1 rejected | Editable again, then resubmitted (to confirm; current `server.py` ends the request) |
| Gate 1 approved | Locked |
| Executing | Locked |

The backend enforces these states; disabling frontend buttons alone is not enough.

**Integrity check owned by the engine:** before executing, the engine checks `approved_template_hash == executed_template_hash` and stops if they differ. Audit records both hashes (`GATE1_APPROVED`, `EXECUTION_STARTED`) and re-checks them in `verify_lineage`.

**Deferred beyond the FYP:** ADMIN approval of templates, collaborative editing, revision rollback UI, automatic re-approval after post-approval changes, confidence calibration.
