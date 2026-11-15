# CASE — Unification Plan: Workflow Engine + AI Intent Classification

**Owner:** Samantha (Workflow Engine + AI Intent Classification)
**Status:** decisions settled. Reply only if one of them doesn't work for your module.

> **For the AI coding assistant:** read this whole file, `docs/audit/README.md` (sections 3–7), `backend/src/audit/port.py`, `catalogue.py`, `errors.py`, `docs/audit/AUDIT_MODULE_PLAN.md` Appendix A and `backend/server.py` before writing code. Use the code in `template-module/server/src/` as the reference for behaviour, but write everything in Python inside `backend/`. Follow the order in §9. After each step, run its check and the tests, then stop and report what changed before starting the next step. Don't change anything in §4 (Decisions) or in `src/audit/` without asking.

---

## 1. Goal

When this plan is done, the CASE repository contains **one system**:

- **One backend framework:** FastAPI (`backend/server.py`). No Node/Express server.
- **One database:** one PostgreSQL database, reached through `DATABASE_URL` and the shared pool in `backend/src/storage/database.py`. No `template_module` database.
- **One audit trail:** every module records through `src/audit` (the `AuditLogger` port). No second `audit_events` table.
- **One UI:** `dashboard/` (it stays, and keeps working without a rewrite).
- `template-module/` is **deleted** as the last step. Until then it stays untouched, as the working fallback.

### Why

Right now the repo has two backends (Node in `template-module/`, Python in `backend/`), both on port 8000, two databases and two audit chains. All 22 dashboard endpoints go to `template-module`, and the Python backend isn't used by the UI. The team decided (AUDIT_MODULE_PLAN §12.2 #1): **one FastAPI app, one PostgreSQL database.** The panel would also ask why two backend frameworks are used.

---

## 2. Target layout

```
backend/
├── server.py                    FastAPI app: include every router, build shared objects at startup
├── migrations/                  numbered SQL, applied in order (001–003 = audit; workflow adds 004+)
└── src/
    ├── storage/database.py      shared Postgres pool (exists)
    ├── audit/                   Audit (Ain, exists)
    ├── standardization/         incoming message normalisation (Ain, exists)
    ├── document_generators/     PDF / Word / Excel builders (exists)
    ├── security/                current user, roles, permissions (Amirul)
    ├── workflow/                ← Samantha: template store + engine + routes
    │   ├── schemas.py           Pydantic models (port of domain/schemas.ts)
    │   ├── rules.py             business rules (port of domain/businessRules.ts)
    │   ├── template_repo.py     SQL for workflow_templates, template_reviews
    │   ├── template_service.py  lifecycle: create, generate, update, approve, reject, activate, deactivate
    │   ├── instance_repo.py     SQL for workflow_instances, step_runs
    │   ├── engine.py            LangGraph graph with fixed Gate 1 / Gate 2
    │   ├── instance_service.py  start, respond, cancel, intake, documents
    │   └── routes.py            /api/templates, /api/instances
    └── ai_intent/               ← Samantha
        ├── matcher.py           StandardMessage → template or NO_MATCH  (new feature)
        ├── drafter.py           prompt → template draft  (port of ai/generator.ts)
        ├── content.py           document body text  (port of ai/documentContent.ts)
        └── file_reader.py       PDF text / OCR  (port of ai/fileReader.ts)
```

---

## 3. Ground rules

1. **Python + FastAPI only.** LangGraph and LangChain are the same libraries in Python (`langgraph`, `langchain_ollama`, `langgraph-checkpoint-postgres`). `server.py` already uses `ChatOllama` with `with_structured_output`.
2. **One database, one pool.** Use `Database` from `src/storage/database.py`. Never open your own connection or read your own DB URL.
3. **Tables come from migrations.** Add `backend/migrations/004_workflow_tables.sql` onwards. Never edit an applied migration. Migrations run as `case_owner`; the app runs as `case_app`, so add `GRANT`s for your tables in the same migration.
4. **Keep the dashboard's API contract.** Same paths, same JSON field names (camelCase, e.g. `templateId`, `reviewStatus`), same response wrappers (`{ "template": … }`, `{ "templates": [...] }`, `InstanceDetail`). Errors use `{ "error": { "code", "message", "details" } }` because `dashboard/src/api/client.ts` reads `payload.error`. The shapes are in `dashboard/src/api/types.ts`. In Pydantic, use `alias_generator=to_camel` + `populate_by_name=True`.
5. **Don't port what other modules own:** audit, users/roles, document rendering. See §8.
6. **Log through Audit, never around it.** See §6.
7. **Don't touch `template-module/`** until the last step in §9.
8. **Before opening a PR:** run the tests (`python -m pytest -m "not integration"` from `backend/`), then check that no file in `src/audit/` or `src/standardization/` changed:
   ```
   git diff --stat develop -- backend/src/audit backend/src/standardization docs/audit
   ```
   If this shows anything, undo those changes or ask Ain first. Work on your own branch, never directly on `develop`.

---

## 4. Decisions (settled)

| # | Decision | Why |
|---|---|---|
| D1 | **Operators and admins can approve templates, including their own.** Every new template (manual or AI-drafted) starts `PENDING` + inactive. Approval makes it `APPROVED` + active. `TEMPLATE_APPROVED` records `self_approved: true` when approver = creator. | No waiting for a second person. Gate 1 and Gate 2 are the security controls; template approval marks a template as ready. The audit trail still shows self-approvals. |
| D2 | **A template drafted during a request runs once under Gate 1.** After `NO_MATCH`, an operator can request a new template. It runs for that request once Gate 1 approves it, and it's saved as `PENDING`. The AI only suggests it for future requests after it's approved (D1). | Gate 1 already approves that exact content for that run, so the request doesn't wait. |
| D3 | **Any operator or admin can approve Gate 1 and Gate 2**, including the person who requested the template. | No extra rules. Audit records the actor of every step, so same-person approvals are visible in provenance. |
| D4 | **Gate 1 rejection closes the request** (`REJECTED_GATE1`). No re-edit. | Matches template-module today. Re-edit is future work. |
| D5 | **Cancel is its own status, `CANCELLED`**, never `FAILED`. Allowed any time before `JOB_DELIVERED`. Logged as `EXECUTION_CANCELLED` (who + `reason_code`), then `EXECUTION_CLOSED`. | `FAILED` = the system broke. `CANCELLED` = a person decided. Mixing them makes the audit misleading. |
| D6 | **Approved templates are never edited in place.** Changing one creates version + 1 (`TEMPLATE_CREATED` with `based_on_version`), and the old version stays for old runs. Drafts (`PENDING`/`REJECTED`) can be edited in place and are logged as `TEMPLATE_UPDATED` (`previous_hash`, `template_hash`). | Provenance stores template version + hash, so approved content has to stay fixed. |
| D7 | **Gate 1 and Gate 2 are fixed engine steps, not template steps.** Remove the `approval` step type from templates (schema, business rules, AI prompt and the dashboard node palette). | Plan Appendix A: "A template cannot define, skip or remove a gate." Two kinds of approval would also make the audit trail ambiguous. |

> D1 is a deliberate trade-off. One person can complete a whole request alone (draft → approve template → Gate 1 → Gate 2). CASE detects this through the audit trail rather than preventing it. Write it as a limitation in the report, with separation of duties as future work.

---

## 5. What to build

### S1 — Template store (`src/workflow/`)

**Tables** (migration `004_workflow_tables.sql`), ported from `template-module/server/src/db/migrations/`:

- `workflow_templates`: `template_id UUID PK`, `name`, `version INT`, `steps JSONB`, `origin ('MANUAL','AI_DRAFTED')`, `is_active BOOL`, `created_by TEXT`, `created_at`, `updated_at`. **New:** `template_hash TEXT` and `based_on_version INT NULL` (D6).

**How to compute `template_hash`** (used in every template and Gate 1 event, so it must be computed the same way everywhere): put it in one function and call it everywhere.

```python
from src.standardization.utils import sha256_hex   # canonical JSON (sorted keys) → SHA-256 hex

def template_hash(name: str, steps: list[dict]) -> str:
    # Drop `position`: it is only where the step sits in the editor canvas.
    # Moving a box must not change the hash.
    content_steps = [{k: v for k, v in step.items() if k != "position"} for step in steps]
    return sha256_hex({"name": name, "steps": content_steps})
```

Use the same function for the working copy hash (`content_hash`, `approved_template_hash`, `executed_template_hash`).
- `template_reviews`: `review_id`, `template_id`, `status ('PENDING','APPROVED','REJECTED')`, `reviewed_by`, `comments`, `created_at`.
- **Do not port** `operators` (goes to `src/security`, §8) or `audit_events`. That name is already used by Audit's table.
- `created_by` / `reviewed_by` store the user id from `src/security` (no foreign key until that table exists).

**Don't copy the old migration files.** The 7 files in `template-module/server/src/db/migrations/` become **two new files** that hold the final table shapes (no stacked `ALTER`s):

| Old file | Goes to |
|---|---|
| `001_init.sql` | `workflow_templates`, `template_reviews` → `004_workflow_tables.sql`. `operators` → not here (`src/security`) |
| `002_workflow_instances.sql` | `005_workflow_instances.sql` |
| `003_document_execution.sql` | merged into `005` (`input` column, `document` step type) |
| `003_role_model.sql`, `004_operator_invites.sql` | not here (`operators` belongs to `src/security`) |
| `005_audit_events.sql` | **dropped.** Audit's own table replaces it. Copying it would silently skip (`IF NOT EXISTS`) because Audit's `audit_events` already exists |
| `006_intake_steps.sql` | merged into `005` (`intake` step type) |

Why: `backend/src/storage/migrate.py` applies files in filename order, so copied files would interleave with Audit's `001`–`003`. The old files also have no `GRANT` for `case_app`, and two of them share the number `003`. Each new migration ends with `GRANT SELECT, INSERT, UPDATE ON <table> TO case_app;` (no `DELETE` unless a route really needs it).

**Routes** (`/api/templates`, exactly as `dashboard/src/api/client.ts` calls them):

| Method + path | Does | Permission |
|---|---|---|
| `GET /api/templates` | list (filters: `origin`, `status`, `is_active`) | `template:read` |
| `GET /api/templates/{id}` | one template with reviews | `template:read` |
| `POST /api/templates` | manual create → PENDING | `template:create` |
| `POST /api/templates/generate` | AI draft from prompt → PENDING (or a clarifying question) | `template:generate` |
| `PUT /api/templates/{id}` | edit draft only (D6); approved → 409 "create a new version" | `template:edit` |
| `POST /api/templates/{id}/approve` | PENDING → APPROVED + active (D1) | `template:approve` |
| `POST /api/templates/{id}/reject` | PENDING → REJECTED (reason required) | `template:approve` |
| `POST /api/templates/{id}/activate` | re-activate a deactivated APPROVED template | `template:deactivate` |
| `DELETE /api/templates/{id}` | deactivate (keep the row) | `template:deactivate` |

**New, for D6:** `POST /api/templates/{id}/versions` creates version + 1 from an approved template (PENDING). The dashboard has no button for it yet, so tell Amirul when the endpoint exists.

**Rules** (port `businessRules.ts`): max steps, unique step ids, first step is `review`, roles and channels from config. **Remove** the `approval` step type and the `approval-requires-validation` rule (D7). Deactivated templates are never offered to the matcher or the operator.

### S2 — Engine (`src/workflow/engine.py`)

Port `execution/graph.ts`, but with the gates fixed around the template's steps:

```
START
  → instantiate     working copy of the template for this request (TEMPLATE_INSTANTIATED)
  → gate_1          interrupt(): operator reviews the working copy        (GATE1_SUBMITTED, then GATE1_APPROVED / GATE1_REJECTED)
  → run_steps       the template's steps in order: review, validation, intake, document, notification
                    (EXECUTION_STARTED first; ATTACHMENT_EXTRACTED, AI_CONTENT_GENERATED, DOCUMENT_GENERATED as they happen)
  → gate_2          interrupt(): operator reviews the generated document   (GATE2_APPROVED / GATE2_REJECTED)
  → deliver         (JOB_DELIVERED)
  → close           (EXECUTION_CLOSED, then sealer.seal_provenance)
END
```

- **Checkpointer:** `AsyncPostgresSaver` from `langgraph-checkpoint-postgres`, on the same database. `thread_id` = `instance_id` = the audit `execution_id`. Its `setup()` creates tables, so run it once with `case_owner` (add a step to `src/storage/migrate.py` or a script), not from the app as `case_app`. Remove `MemorySaver` and the demo graph from `server.py`.
- **Locking:** at `GATE1_APPROVED`, store `approved_template_hash`. Before `EXECUTION_STARTED`, recompute the working copy hash and stop with `EXECUTION_FAILED` if it differs. Any edit after Gate 1 → `EXECUTION_TEMPLATE_MODIFY_REJECTED`.
- **Intake step:** if the request came with attachments (Gmail/Telegram), read those. If it was started from the dashboard, pause for an upload as today (`POST /api/instances/{id}/intake`). This pause is not a gate. Intake runs only after Gate 1.
- **Notification steps** stay simulated (log only, never send). The real send to the requester is `deliver`, after Gate 2.
- **Document step:** use `src/document_generators/` (reportlab / python-docx / openpyxl). Don't port `exporters.ts` (S4).
- **Instance statuses** (dashboard): `RUNNING`, `PAUSED`, `COMPLETED`, `REJECTED`, `CANCELLED`. Map to audit `final_status`: COMPLETED → `DELIVERED`, rejected at Gate 1 → `REJECTED_GATE1`, at Gate 2 → `REJECTED_GATE2`, error → `FAILED`, cancel → `CANCELLED` (D5).

**Tables** (migration `005_workflow_instances.sql`): `workflow_instances` (+ `input JSONB`, + `source TEXT`, + `approved_template_hash TEXT`), `step_runs`. Update the `step_type` check (no `approval`) and add `gate_1`/`gate_2` rows or a separate gate column. Your choice, but the dashboard's run timeline must still show them.

**Routes** (`/api/instances`):

| Method + path | Does | Permission |
|---|---|---|
| `GET /api/instances` | list (filters: `status`, `template_id`) | `workflow:read` |
| `GET /api/instances/{id}` | `InstanceDetail` (instance, stepRuns, pendingApproval) | `workflow:read` |
| `POST /api/instances` | start from the dashboard: operator picks an APPROVED + active template, runs to Gate 1 | `workflow:start` |
| `POST /api/instances/{id}/respond` | answer the gate it is paused at (`approved`, `comments`) | `workflow:respond` |
| `POST /api/instances/{id}/intake` | upload a file for a paused intake step | `workflow:respond` |
| `GET /api/instances/{id}/documents/{stepId}` | download a generated document | `workflow:read` |
| `POST /api/instances/{id}/cancel` | cancel before delivery (D5) | `workflow:cancel` |

`pendingApproval.kind` stays `"approval"` for gate pauses and `"intake"` for upload pauses. Add `gate: 1 | 2` so the dashboard can label them.

### S3 — AI intent classification (`src/ai_intent/`)

**Matching (new — doesn't exist anywhere yet):**

```python
async def match_template(message: StandardMessage, templates: list[ActiveTemplate]) -> MatchResult
# MatchResult: template_id + template_version + confidence (string "0.87") + intent_label
#              or no_match + reason_code + candidates_checked
```

- Input is the `StandardMessage` from `src/standardization` (`standardize_message(...)`). Only `APPROVED` + active templates are candidates (D2).
- Use `ChatOllama(...).with_structured_output(MatchResult)`. Confidence is **a string**, because Audit rejects floats.
- The operator then accepts, switches (`TEMPLATE_MANUALLY_SELECTED`), requests a new one (`TEMPLATE_REQUESTED` → `AI_TEMPLATE_DRAFTED` → `TEMPLATE_CREATED`), or rejects (`REQUEST_UNSUPPORTED`).

**Entry point for incoming requests** (Ingress calls it; Amirul owns Ingress):

```python
async def start_request(message: StandardMessage, *, source: str, execution_id: str) -> InstanceDetail
# JOB_RECEIVED has already been logged by Ingress with this execution_id
# → match_template → AI_TEMPLATE_SELECTED / AI_TEMPLATE_NO_MATCH → waits for the operator
```

**Drafting:** port `ai/generator.ts` (prompt, clarifying question, validation against the schema + rules). Used by `POST /api/templates/generate` and by "request a new template" after `NO_MATCH`. Remove `approval` from the step types in the prompt (D7).

**Document content + file reading:** port `ai/documentContent.ts` and `ai/fileReader.ts` (PDF text, OCR). For OCR in Python, use `pytesseract` + Pillow and `pypdf` for PDF text. Add them to `backend/requirements.txt` (Tesseract has to be installed on the machine).

### S4 — Documents (together with S2)

Use the builders in `backend/src/document_generators/` (`pdf_builder.py`, `word_builder.py`, `excel_builder.py`). Keep their path-safety rule (README "Path Safety Guard Pattern"). The SHA-256 of the generated file is the `document_hash` for `DOCUMENT_GENERATED` and `GATE2_*`.

### S5 — Audit wiring (in every step, not at the end)

See §6.

---

## 6. Audit: how to record

**To connect with Audit you only need three files:**

| File | What it gives you |
|---|---|
| `backend/src/audit/port.py` | `AuditLogger` (`log_event`) and `ProvenanceSealer` (`seal_provenance`): the interface. `MemoryAuditLogger` / `NullAuditLogger` for tests |
| `backend/src/audit/catalogue.py` | every action name, its required `details`, the forbidden keys, `FINAL_STATUSES`, gate order (`REQUIRED_PRIOR_GATE`) |
| `backend/src/audit/errors.py` | `AuditValidationError` (your input is wrong; `.code` says why) and `ProvenanceError` (`NOT_CLOSED`, `CHAIN_BROKEN`) |

Plus `docs/audit/README.md` sections 3–7 (how to call it, `details` rules, errors, patterns A/B/C, which events in which order). **Don't import anything else from `src/audit/`.** The rest is Audit's internals.

Short version:

- Take an `AuditLogger` and a `ProvenanceSealer` (`from src.audit.port import AuditLogger, ProvenanceSealer`) as parameters. `server.py` builds the real `AuditService` once and passes the same object for both. In tests, pass one `MemoryAuditLogger` for both: `.events` holds what was logged and `.sealed` holds what was sealed.
- Call `await audit.log_event(workspace_id=…, actor=…, role=…, action=…, target=…, source=…, outcome=…, details=…, execution_id=…, session=…)`.
  - `workspace_id`: the workspace UUID (one per organisation; for the demo, one fixed value from config).
  - `role`: `ADMIN | OPERATOR | AUDITOR | SYSTEM | AI` (uppercase). The AI itself logs with `actor="qwen3.5:9b"`, `role="AI"`.
  - `target`: `"template:<id>"` or `"execution:<id>"`.
  - `source`: `WEB_APP` for dashboard actions; the request's channel (`GMAIL`, `TELEGRAM`) for request events.
  - `execution_id`: the instance id for everything inside a request; `None` for template changes outside a request.
- **`details` rules:** ids, counts, codes and hashes only. Never prompts, message bodies, file names, file content or emails. `prompt` and `content` are rejected keys, so use `prompt_hash`. Numbers are `int` or strings, never floats.
- **Pattern A** (template changes, which are in our DB): one transaction, with `log_event(..., session=tx)` as the **last** statement before commit. If audit fails, the change rolls back.
- **Pattern B** (gates, `EXECUTION_STARTED`, AI decisions): log first, and resume the graph only if logging succeeded.
- **End of every request:** `EXECUTION_CLOSED` (exactly once), then `await sealer.seal_provenance(workspace_id, execution_id)`.

### Event mapping (template-module → unified)

| template-module today | Log this instead | Required `details` | Status |
|---|---|---|---|
| `TEMPLATE_CREATED` | `TEMPLATE_CREATED` | `template_id`, `template_version`, `template_hash`, `origin` (+ `based_on_version` for new versions) | same |
| `TEMPLATE_DEACTIVATED` | `TEMPLATE_DEACTIVATED` | `template_id`, `template_version`, `reason_code` | same |
| `TEMPLATE_GENERATED` | `AI_TEMPLATE_DRAFTED` | `template_id`, `template_version`, `template_hash`, `prompt_hash` | rename, **no prompt text** |
| `TEMPLATE_APPROVED` | `TEMPLATE_APPROVED` | `template_id`, `template_version`, `template_hash`, `self_approved` | Ain adds |
| `TEMPLATE_REJECTED` | `TEMPLATE_REJECTED` | `template_id`, `template_version`, `reason_code` | Ain adds |
| `TEMPLATE_UPDATED` | `TEMPLATE_UPDATED` (drafts only) | `template_id`, `template_version`, `previous_hash`, `template_hash`, `changed_fields` | Ain adds |
| `TEMPLATE_ACTIVATED` | `TEMPLATE_ACTIVATED` (re-activation only; approval already activates) | `template_id`, `template_version` | Ain adds |
| `WORKFLOW_STARTED` | `TEMPLATE_INSTANTIATED`, then `EXECUTION_STARTED` after Gate 1 | see README §7 | split |
| `APPROVAL_GRANTED` / `_REJECTED` | `GATE1_APPROVED` / `GATE1_REJECTED`, `GATE2_APPROVED` / `GATE2_REJECTED` | Gate 1: `revision`, `approved_template_hash` · Gate 2: `document_hash` | rename |
| `WORKFLOW_INPUT_READ` | `ATTACHMENT_EXTRACTED` | `attachment_count`, `file_hashes`, `extracted_chars` | rename, **no file name** |
| `WORKFLOW_CANCELLED` | `EXECUTION_CANCELLED`, then `EXECUTION_CLOSED` (`CANCELLED`) | `reason_code` · `final_status` | Ain adds |
| `MEMBER_*` (4 events) | owned by `src/security` (Amirul) | — | not yours |
| — | `AI_TEMPLATE_SELECTED` / `AI_TEMPLATE_NO_MATCH` | `template_id`, `template_version`, `source_template_hash`, `confidence` / `candidates_checked`, `reason_code` (+ optional `intent_label`) | new |
| — | `TEMPLATE_MANUALLY_SELECTED`, `TEMPLATE_REQUESTED`, `REQUEST_UNSUPPORTED`, `GATE1_SUBMITTED`, `AI_CONTENT_GENERATED`, `DOCUMENT_GENERATED`, `JOB_DELIVERED`, `EXECUTION_FAILED`, `EXECUTION_CLOSED` | README §7 | new |

**Order is verified.** `EXECUTION_STARTED`, `ATTACHMENT_EXTRACTED`, `AI_CONTENT_GENERATED` and `DOCUMENT_GENERATED` must come after `GATE1_APPROVED`, and `JOB_DELIVERED` after `GATE2_APPROVED`. Otherwise `verify_lineage` fails for that request.

**A dashboard-started run** (`POST /api/instances`) is also a request. Log `JOB_RECEIVED` (`source=WEB_APP`) and `TEMPLATE_MANUALLY_SELECTED` (`ai_template_id: null`), then follow the normal flow from `TEMPLATE_INSTANTIATED`.

---

## 7. Users and permissions (interim)

`src/security/` (Amirul) provides `get_current_user` (user id, role, workspace id) and `require_permission(...)`. Until it exists:

- The dashboard sends the header `x-operator-id` (an id or an email, see `client.ts`). Write your routes against a `get_current_user` dependency, so switching to the real one later only changes the import.
- Roles: `admin`, `operator`, `auditor`. The permission matrix is in `template-module/server/src/auth/operators.ts`: operators have all `template:*` and `workflow:*` permissions, admins have everything plus member management, auditors are read-only.
- Map to audit roles in uppercase (`ADMIN`, `OPERATOR`, `AUDITOR`).

---

## 8. Not yours

| Part of template-module | Goes to | Owner |
|---|---|---|
| `auditLog.ts`, `/api/audit`, `audit_events` table | `src/audit` (`/api/v1/audit/...`). The dashboard audit page gets repointed and adapted to its response shape | Ain |
| `operators` table, `/api/operators`, `auth/` | `src/security` | Amirul |
| Gmail / Telegram ingress → `JOB_RECEIVED` | Ingress → `src/standardization` → your `start_request` | Amirul + Ain |
| `exporters.ts` | not ported; `src/document_generators` is used | — |
| Dashboard changes (remove the `approval` node, add the Gate 1/2 label, a "new version" button) | `dashboard/` | Amirul, with you |

---

## 9. Order of work and checks

Do these in order. Each step has a check; don't start the next step until it passes.

1. **Setup.** Add migrations `004`/`005`. In `server.py`, build `Database` and `AuditService` once at startup and include the workflow router. Remove the demo graph and `MemorySaver`.
   *Check:* migrations apply on a fresh database; `server.py` starts; the existing tests still pass (`python -m pytest`).
2. **Template store (S1).**
   *Check:* every `/api/templates` route works from the dashboard against FastAPI; each template change writes its audit event in the same transaction (pattern A); tests cover the lifecycle (create → approve/reject → edit draft → new version → deactivate/activate) and the business rules.
3. **Engine + documents (S2, S4).**
   *Check:* a run started from the dashboard goes Gate 1 → steps → document → Gate 2 → delivered → closed → sealed, and `verify_lineage` passes for it. Cancel, Gate 1 rejection and Gate 2 rejection each have a test with the right `final_status`.
4. **AI intent classification (S3).**
   *Check:* `match_template` returns a match or NO_MATCH from a `StandardMessage` (Ollama mocked in tests); NO_MATCH → request new template → it runs once under Gate 1 and stays PENDING (D2).
5. **End-to-end.**
   *Check:* one Telegram or Gmail request goes all the way and its provenance verifies; changing one audit row makes verification fail.
6. **Remove the old server.** Delete `template-module/` and update the root README.
   *Check:* the dashboard still works with only FastAPI running on `127.0.0.1:8000`.

### Tests

Put them in `backend/tests/workflow/` and `backend/tests/ai_intent/`. Mark tests that need Postgres with `@pytest.mark.integration` (see `backend/pytest.ini`). Use `MemoryAuditLogger` to assert which events were logged and in what order. Mock Ollama in unit tests.

---

## 10. Audit side (Ain, in parallel)

- Add to `catalogue.py`: `TEMPLATE_APPROVED` (`self_approved`), `TEMPLATE_REJECTED`, `TEMPLATE_UPDATED`, `TEMPLATE_ACTIVATED`, `EXECUTION_CANCELLED`, final status `CANCELLED`, `based_on_version` on `TEMPLATE_CREATED`.
- Verify check: the run's template was approved before `EXECUTION_STARTED`.
- Update `AUDIT_MODULE_PLAN.md`: decision 9 (template approval), §12.2 #1 (one app + one DB, confirmed) and #3 (Gate 1 rejection closes), Appendix A.
- Connect `AuditService` to Standardization, Ingress and the Workflow Engine, and switch the audit routes to `src/security`.

---

## 11. Report notes

- **Architecture:** "CASE is one FastAPI application with one PostgreSQL database. Modules communicate through Python interfaces, and every module records its actions in one tamper-evident audit trail."
- **Limitation (D1, D3):** "A single user can complete a whole request. CASE relies on the audit trail to detect this rather than preventing it. Separation of duties is future work."
- **Future work:** re-editing after Gate 1 rejection (D4), mandatory second-person template review.
