# CASE authentication gateway

Google OAuth2 + JWT sessions + invitation onboarding, built as a **sidecar** in
front of the existing platform. The workflow Express API and the FastAPI audit
API are not modified: the gateway reverse-proxies to them and re-creates the
legacy identity headers their routes already trust.

```
                         ┌──────────────────────────────────────────┐
 Browser (dashboard)     │  Auth gateway  :8080   (new process)     │
  HttpOnly JWT cookie ──▶│  /api/auth/*        Google OAuth + JWT   │
                         │  /api/invitations/* invitations          │
                         │  everything /api/*  validate → inject    │
                         └───────────────┬──────────────┬───────────┘
                                         │              │
                     x-operator-id       │              │  x-operator-id
                     X-Mock-User         ▼              ▼  X-Mock-User
                     X-Mock-Role   Express :8001    FastAPI :8000
                     X-Mock-Workspace (unchanged)   (unchanged, AUTH_MODE=mock)
```

## Zero-modification boundary

**Added** (all new files):

- `template-module/server/src/auth-gateway/**` — gateway app, routes, services,
  store, proxy, migrations.
- `template-module/server/tests/auth-gateway/**` — 22 tests.
- `docs/auth/README.md`.

**Touched** (integration surface only, no business logic):

- `template-module/server/package.json` — new dependencies and
  `dev:auth` / `auth:migrate` / `start:auth` scripts.
- `template-module/server/.env.example` — `AUTH_*`, Google and SMTP keys.
- `dashboard/src/api/client.ts` — cookie-aware fetch, automatic refresh,
  Google sign-in navigation. No workflow API calls changed.
- `dashboard/src/context/SessionContext.tsx` — restores an OAuth session from
  `/api/auth/me`; legacy identity remains behind a flag.
- `dashboard/src/features/auth/Login.tsx` — "Continue with Google" is primary;
  the demo identity form is hidden unless `VITE_DEV_IDENTITIES=true`.
- `dashboard/vite.config.ts` — dev proxy defaults to the gateway (`:8080`).

No existing route handler, service, `auditLog.ts`, FastAPI file or SQL migration
was edited. The gateway reads `operators`; it never alters its semantics.

## Request lifecycle

1. `GET /api/auth/google/start` creates 32-byte random `state` + OIDC `nonce`,
   stores them in a 10-minute signed HttpOnly cookie, and redirects to Google.
2. Google returns to `GET /api/auth/google/callback?code&state`.
   The gateway verifies the signed cookie, compares `state` in constant time,
   exchanges the code, verifies the ID token, and checks `nonce`, `email_verified`
   and the optional hosted domain.
3. The operator is resolved, a JWT is issued, and an opaque rotating refresh
   token is stored as a SHA-256 digest.
4. Cookies: `case_session` (JWT, path `/`, 15 min) and `case_refresh` (path
   `/api/auth`, 7 days). Both are `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS.
5. Every other `/api` request is validated by the global middleware. It deletes
   any client-supplied `x-operator-id`, `x-mock-*` first, then injects:

   | Header | Value |
   |---|---|
   | `x-operator-id` | operator UUID (`operators.operator_id`) |
   | `X-Mock-User` | same UUID (≤128 chars, as FastAPI requires) |
   | `X-Mock-Role` | `ADMIN` / `OPERATOR` / `AUDITOR` |
   | `X-Mock-Workspace` | `AUTH_WORKSPACE_ID` (UUID) |

6. `/api/*` goes to Express, `/api/v1/*` goes to FastAPI. Path and query are
   preserved; request bodies are streamed, never parsed by the gateway.

The existing Node `authenticate(directory)` still resolves `x-operator-id`.
The FastAPI audit API still runs its `AUTH_MODE=mock` dependency. From their
point of view nothing changed.

## First-run bootstrap

`PostgresAuthStore.bootstrapRootAdmin()` runs inside a transaction with
`pg_advisory_xact_lock`, then:

- if `operators` is empty → inserts the first Google user as `admin` **and** the
  `auth_accounts` link, then emits `ROOT_ADMIN_INITIALIZED`;
- otherwise → returns without creating anything.

**Important:** the existing `001_init.sql` / `003_role_model.sql` seed demo
operators (`ops-admin`, `ops-operator`, `ops-auditor`). On a database created by
those migrations, the table is *not* empty, so bootstrap deliberately does not
run. A truly fresh deployment must start with an empty `operators` table. The
seed rows are development data; do not delete them in a live environment to
"force" bootstrap — create the root admin through a controlled admin path
instead.

## Invitations

- `POST /api/invitations` (admin JWT only) accepts `{ "email": "...",
  "role": "operator" | "auditor" }`.
- A 32-byte base64url token is generated. Only `sha256(token)` is stored in
  `auth_invitations`; the raw token exists only in the email link.
- TTL is fixed at 120 minutes (configurable down to 1, never above 120) and is
  also enforced by a database `CHECK`.
- Re-inviting the same email revokes the previous pending row in the same
  transaction.
- The email is sent by Nodemailer over SMTP from the dedicated CASE system
  account and contains
  `${AUTH_PUBLIC_URL}/api/invitations/accept?token=...`.
- `GET /api/invitations/accept` atomically locks the row, validates
  revoked/consumed/expiry/workspace, rejects an existing operator email, creates
  the operator, and marks the invitation consumed. It then redirects to Google
  sign-in.
- The operator is linked to a Google subject by email on the first successful
  callback; `auth_accounts.google_sub` is unique.
- The API never returns the raw token or magic link. If delivery fails the
  invitation is revoked and the request returns a `4xx`/`502` error (see below).

### Sending from the CASE system account (SMTP)

Every invitation is sent by the platform itself from one dedicated system
mailbox (for example `noreply.case@agency.gov.my`) over standard SMTP. The
signed-in admin is only the actor recorded in the audit trail; their personal
Gmail is never used, and delivery does not depend on their Google grant.

The flow is:

1. Generate a 32-byte base64url token.
2. Store **only** `sha256(token)` in `auth_invitations`, with a 120-minute expiry.
3. Render the invitation and hand it to Nodemailer/SMTP.
4. Emit `OPERATOR_INVITED` **after** the message leaves the server.

The HTML email contains a styled **Accept invitation** button pointing at
`${AUTH_PUBLIC_URL}/api/invitations/accept?token=...` (locally,
`http://localhost:5174/api/invitations/accept?token=...`), the same link as
plain text, and an explicit callout: **this invitation expires in 2 hours**,
with the exact UTC timestamp and a single-use warning. The message is branded
with `AUTH_APP_NAME` and states that it was sent automatically by the platform.

#### Environment variables

Set these in `template-module/server/.env` (the gateway loads it via
`dotenv`). `.env` is ignored by Git; never commit `SMTP_PASS`.

| Variable | Required | Purpose |
|---|---|---|
| `SMTP_HOST` | yes (unless using dev links) | e.g. `smtp.gmail.com` |
| `SMTP_PORT` | no (default `587`) | `587` STARTTLS, `465` implicit TLS |
| `SMTP_SECURE` | no | `true` for 465; defaults from the port |
| `SMTP_USER` | for authenticated relays | the CASE system mailbox |
| `SMTP_PASS` | with `SMTP_USER` | SMTP password / Gmail **App Password** |
| `AUTH_EMAIL_FROM` | no | From header; defaults to `"<AUTH_APP_NAME> <SMTP_USER>"` |
| `AUTH_EMAIL_REPLY_TO` | no | optional monitored Reply-To address |
| `SMTP_DEBUG` | no | full SMTP transcript; defaults to on outside production |
| `AUTH_DEV_LOG_MAGIC_LINKS` | no | local only: print the link when SMTP is unset |

Minimal Gmail setup:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply.case@agency.gov.my
SMTP_PASS=abcdefghijklmnop        # 16-character App Password
AUTH_EMAIL_FROM=CASE <noreply.case@agency.gov.my>
AUTH_DEV_LOG_MAGIC_LINKS=false
```

For Gmail, `AUTH_EMAIL_FROM` must be the same address as `SMTP_USER`; Gmail
rewrites a mismatched From. `AUTH_INVITE_DELIVERY` is no longer used — SMTP is
the only invitation transport.

#### Gmail App Password (regular passwords do not work)

Google no longer accepts an account password for SMTP; an `EAUTH` /
`535-5.7.8` response means the credential is not an App Password.

1. Enable **2-Step Verification** on the CASE system account:
   <https://myaccount.google.com/signinoptions/two-step-verification>.
   App Passwords are unavailable while 2-Step Verification is off.
2. Open <https://myaccount.google.com/apppasswords>.
3. Create an app password named `CASE Auth Gateway` (choose *Mail* / *Other*).
4. Copy the 16-character value into `SMTP_PASS` (the displayed spaces may be
   omitted) and restart the gateway.

If the App Passwords page is missing, a Google Workspace administrator has
disabled it. Use the Workspace SMTP relay (`smtp-relay.gmail.com`), a Google
service account with domain-wide delegation, or another provider — the gateway
only needs standard SMTP.

#### Failure behaviour

Mail failures are handled per request and never crash the process:

| Condition | Response |
|---|---|
| `SMTP_HOST` unset (production) | `503 INVITATION_EMAIL_NOT_CONFIGURED` |
| `EAUTH` / `ENOAUTH` | `502 INVITATION_EMAIL_AUTH_FAILED` (mentions App Password) |
| DNS/timeout/refused connection | `502 INVITATION_EMAIL_UNREACHABLE` |
| Any other SMTP rejection | `502 INVITATION_EMAIL_FAILED` |

In every failure case the newly created invitation is **revoked** (a link nobody
received must not stay redeemable), `OPERATOR_INVITED` is written with
`outcome: FAILURE`, `delivery: FAILED`, and the admin gets an actionable error
instead of a success. The raw SMTP error (`code`, `responseCode`, `response`,
`command`, stack and hints) is logged server-side only; it is never returned to
the browser. `sendMail()` resolving with a non-empty `rejected` list is also
treated as a failure, so a `550` policy rejection cannot be reported as success.

At boot the gateway logs the resolved `.env` path, `SMTP_USER`, the
`SMTP_PASS` length (never the value) and any obvious misconfiguration, then runs
`mailer.verify()`. A failed check prints a large banner with Google's reason and
what to fix, but the process keeps serving, so a temporarily unreachable mail
server cannot take authentication down.

#### Debugging "success but no email"

With `SMTP_DEBUG=true` (the default outside production) every send prints the
SMTP handshake, `250`/`535`/`550` replies and the accepted/rejected envelope.
Credentials are redacted by the gateway's logger. Set `SMTP_DEBUG=false` once
delivery works.

| Terminal output | Meaning |
|---|---|
| `verify() passed` | DNS, TCP, TLS and authentication are working |
| `535-5.7.8 ... BadCredentials` | not an App Password, or a wrong/expired one |
| `ETIMEDOUT` / `ECONNECTION` | port, firewall, VPN or outbound SMTP blocked |
| `ENOTFOUND` | `SMTP_HOST` is wrong or DNS is unavailable |
| `server reply: 250 2.0.0 OK` + `accepted=["..."]` | Gmail accepted the message; a missing email is a spam/filter/deliverability issue, not an SMTP failure |
| `rejected=["..."]` | recipient refused; the gateway returns `502` and revokes the invite |

If Gmail returns `250` and the message is in the system account's **Sent**
mailbox but not in the invitee's inbox, check the invitee's spam/quarantine,
the exact recipient address, and whether `AUTH_EMAIL_FROM` matches `SMTP_USER`.

#### Audit contract

`OPERATOR_INVITED` is emitted **after** a successful SMTP send, with
`outcome: SUCCESS`, `delivery: "SENT"`, `channel: "SMTP"` (or `"DEV_LOG"` in
local development), `email_hash`, role, expiry and workspace id. It is still
recorded through the existing legacy `AuditRecorder`/`PostgresAuditLog`
adapter — the gateway only calls `record()` and never edits the writer, the
canonicaliser or the hash chain. Raw email, tokens and SMTP credentials never
enter the audit details.

Caveat: acceptance creates the operator before Google sign-in, per the
invitation contract. The invitee must use the exact invited Google address. If
they use another address, sign-in fails with `INVITATION_REQUIRED`; an admin
must correct the member's email or revoke/recreate access.

## Revocation removes credentials, not history

Revoking a member (`DELETE /api/operators/:id`, the dashboard's *Remove access*)
is a soft delete in the legacy API: `operators.revoked_at` is set so templates,
runs, steps and reviews keep resolving to a real identity. Without the gateway,
that would leave the person's Google link, sealed Google tokens and refresh
tokens behind. The gateway completes revocation without modifying that route:

- it destroys the member's `auth_accounts` row — the Google subject link plus
  any sealed Google tokens — and every `auth_refresh_tokens` row, in one
  transaction (`purgeCredentials`);
- immediately, when the proxied `DELETE` answers 2xx (a rejected revoke — own
  account, another admin, already revoked — purges nothing);
- and by a sweep at boot plus every 10 minutes, which catches revocations made
  outside the proxy path (direct SQL, another admin tool, a restored dump);
- access is blocked independently of the purge: every authenticated request
  re-reads the operator and returns `403 ACCESS_REVOKED`, and a purged member
  can no longer sign in — their `google_sub` no longer resolves, the fallback
  lookup by email finds the revoked operator, and the callback is refused with
  `ACCESS_REVOKED`. Nothing is re-linked on that attempt;
- the `operators` row is deliberately kept (revoked), because deleting it would
  orphan the audit trail and every historical foreign key. Re-adding the same
  email restores that row; the next Google sign-in links a fresh identity.

That soft revoke is what the dashboard's *Remove access* does. A **hard delete**
is a separate, admin-only endpoint below.

## Hard revocation (gateway-only)

`DELETE /api/auth/operators/:id` — admin JWT, same-origin, self-revocation
refused with `409 SELF_REVOKE_FORBIDDEN`.

In one transaction it removes the member completely:

1. `auth_invitations.invited_by` is set to `NULL` for rows that admin issued
   (migration 003 dropped the old `NOT NULL` + `RESTRICT`, which otherwise made
   any inviter undeletable); the invitation rows themselves are kept;
2. `auth_accounts` (Google subject link + sealed tokens) is deleted;
3. `auth_refresh_tokens` are deleted;
4. the `operators` row is deleted. The base schema's `ON DELETE SET NULL` on
   `workflow_templates.created_by`, `template_reviews.reviewed_by`,
   `workflow_instances.created_by` and `step_runs.performed_by` means templates
   and runs survive, unnamed.

Active access tokens die on the next request: the middleware re-reads the
operator every time and answers `401 SESSION_INVALID` when the row is gone —
there is no server-side JWT list to walk. The refresh cookie stops working
immediately because its row no longer exists. The person can return only through
a brand-new invitation, which creates a new operator id and a new Google link.

Response: `{ revoked: true, operatorId, deleted: { accounts, refreshTokens, invitationsUnlinked } }`.

Scope note: `operators` has no persisted "root admin" marker. Root admin here
means role `admin`, which is singular by construction (invitations create
operators/auditors only, and the legacy role switch refuses admins). Self-deletion
is refused so the last admin cannot lock the workspace out. Note that the legacy
whitelist (`POST /api/operators`, used by the dashboard's invite dialog) can also
recreate a deleted email; that path is outside the gateway's control under the
zero-modification policy.

`OPERATOR_REVOKED` is emitted after the delete with `operator_id`, `role`,
`email_hash`, `reason_code: "ADMIN_HARD_DELETE"`, integer counts and
`workspace_id` — no raw email, no free text.

## Live presence (no WebSockets)

Migration 003 adds `auth_accounts.last_seen_at` and `auth_accounts.is_online`;
the base `operators` table is untouched.

- The JWT middleware refreshes `last_seen_at` on authenticated requests, at most
  once per operator per 30 s, fire-and-forget (a slow write never delays or fails
  a request).
- `POST /api/auth/heartbeat` (auth required) records activity and returns
  `{ online, lastSeenAt, heartbeatEverySeconds: 60, offlineAfterSeconds: 120 }`.
- `GET /api/auth/presence` (auth required) returns every non-revoked member with
  `operatorId`, `displayName`, `role`, `online`, `lastSeenAt`,
  `lastSeenSecondsAgo`, `isOnline`. `online` needs **both** signals: seen within
  120 s *and* `is_online` true. A crashed process or closed laptop turns gray by
  itself through the timestamp; an explicit logout turns gray at once through
  the flag.
- Logout marks the member offline immediately without moving `last_seen_at`, so
  they disappear as soon as the next presence read (≤ 15 s in the dashboard)
  instead of lingering for the two-minute window.
- Presence transitions and heartbeats are deliberately **not** audited: they run
  on a timer and would flood the hash chain. Only explicit
  `AUTHENTICATION_LOGOUT` and `OPERATOR_REVOKED` events are recorded.

## User-scoped integration vault

Migration 006 adds `auth_vault_secrets`, a gateway-owned table for the Telegram
bot token and Gmail app password an operator connects to their own profile. It
is keyed by `operator_id` (not workspace) and uses
`PRIMARY KEY (operator_id, provider)`, so one operator has at most one active
secret per provider. Values are sealed with AES-256-GCM using a dedicated
`VAULT_MASTER_KEY`; the browser can read connection status only, never the
secret or its ciphertext.

- `GET /api/auth/vault` → `{ telegram: boolean, gmail: boolean }`
- `POST /api/auth/vault/:provider` with `{ "token": "..." }` → seals/upserts
- `DELETE /api/auth/vault/:provider` → removes the member's secret
- `GET /api/internal/vault/:operator_id/:provider` with
  `x-internal-api-key` → just-in-time decryption for the workflow engine

`VAULT_MASTER_KEY` is required at startup (exactly 32 bytes);
`VAULT_INTERNAL_API_KEY` is a pre-shared key that disables the internal route
when unset. Full threat model, key rotation notes, curl examples and workflow
engine guidance: [vault.md](./vault.md).

## Audit integration — consumer only

The gateway imports the existing `AuditRecorder`/`PostgresAuditLog` and calls
`record()`. It does not edit `auditLog.ts`, the canonicalizer, the chain lock, or
the verification code. The existing writer owns serialisation and hashing.

Events emitted:

| Action | Actor | Target | Outcome | Details |
|---|---|---|---|---|
| `ROOT_ADMIN_INITIALIZED` | `system` | `operator:<id>` | SUCCESS | `operator_id`, `role`, `workspace_id`, `bootstrap` |
| `OPERATOR_INVITED` | admin | `invitation:<id>` | SUCCESS/FAILURE | `invitation_id`, `email_hash`, `role`, `expires_at`, `delivery`, `channel`, `workspace_id` |
| `INVITATION_ACCEPTED` | `system` | `operator:<id>` | SUCCESS | `invitation_id`, `operator_id`, `role`, `workspace_id` |
| `AUTHENTICATION_SUCCESS` | operator | `session:<id>` | SUCCESS | `provider`, `email_hash`, `workspace_id` |
| `AUTHENTICATION_FAILED` | operator or `system` | `auth:google` | FAILURE | `provider`, `reason_code`, optional `email_hash`, `workspace_id` |
| `AUTHENTICATION_LOGOUT` | operator | `session:<id>` | SUCCESS | `operator_id`, `session_revoked`, `workspace_id` |
| `OPERATOR_REVOKED` | admin | `operator:<id>` | SUCCESS | `operator_id`, `role`, `email_hash`, `reason_code`, `accounts_deleted`, `refresh_tokens_deleted`, `invitations_unlinked`, `workspace_id` |

Payload compliance:

- plain JSON only: strings, booleans, integers; timestamps are ISO strings;
- no `Date`, `undefined`, float, `Buffer` or class instance;
- no raw email or name — `email_hash` is `sha256(lowercase(email))`;
- no key named or suffixed `token`, `secret`, `password`, `api_key`,
  `credentials`, so the payload also satisfies FastAPI's forbidden-key rule;
- no free-text error messages — stable `reason_code` values.

`PostgresAuditLog.canonicalize()` sorts keys recursively and hashes the exact
tuple `[seq, recordedAt, actorId, …]` with `prev_hash`. Because every detail is
already a plain primitive, re-canonicalisation during verification is
byte-identical. The gateway never computes or supplies a hash itself.

Why the Node chain, not FastAPI's? The Python `AuditAction` catalogue rejects
unknown actions and has no corresponding values; adding them would violate the
zero-modification rule. The auth gateway therefore appends to the hash chain
that admits free-form action names. This repository also keeps the two chains
in separate databases in the default setup: Node writes `audit_events` in
`case_workflow_db`, FastAPI writes its own tables in `case_dev`. Auth events
appear in the Node chain only; they do not appear in FastAPI's chain. If the
platform later consolidates on the Python chain, an audit owner must add these
five actions to `catalogue.py` and map `AUTHENTICATION_FAILED` to the existing
`AUTH_FAILED` semantics — a deliberate, reviewed change outside this module.

Audit writes are best-effort at call sites, matching the existing convention:
authentication succeeds even if the audit write temporarily fails, and the error
is logged. Verify the chain from the Audit screen (`POST /api/audit/verify`) or
via FastAPI's `POST /api/v1/audit/verify` for the Python chain.

## FastAPI from React (no Python changes)

React must call FastAPI through the **same origin** as the gateway:

```ts
// Good: proxied by Vite in dev, by the gateway/reverse proxy in production.
await fetch("/api/v1/audit/events", { credentials: "include" });

// Bad: bypasses the gateway, so no verified identity headers are injected.
await fetch("http://127.0.0.1:8000/api/v1/audit/events");
```

The gateway matches `/api/v1` (configurable via `AUTH_FASTAPI_PREFIXES`) and
proxies to `FASTAPI_BASE_URL`. Python's `AUTH_MODE=mock` then reads the injected
`X-Mock-*` headers. The browser never sends those headers itself; the gateway
strips anything the client attempts.

FastAPI must not be exposed publicly. Bind it to loopback or a private network;
the gateway is the only ingress. Python's mock mode is a bridge, not real
authentication: anyone who can reach FastAPI directly can forge headers. If
FastAPI is ever exposed, replace `AUTH_MODE=mock` with a JWT verifier **there**,
which is a separate, explicit change.

## Setup

### 1. Google Cloud

Create an OAuth 2.0 Web client. Authorized redirect URI, exactly:

```
http://localhost:5174/api/auth/google/callback      # dev (Vite proxy)
https://app.example.com/api/auth/google/callback    # production
```

Copy the client ID and secret into server `.env` (never commit them).

### 2. Environment

Append the auth block from `template-module/server/.env.example`. Minimum:

```dotenv
AUTH_JWT_SECRET=$(openssl rand -base64 48)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
AUTH_PUBLIC_URL=http://localhost:5174
AUTH_GOOGLE_REDIRECT_URI=http://localhost:5174/api/auth/google/callback
AUTH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/case_workflow_db
VAULT_MASTER_KEY=$(openssl rand -base64 32)   # required; exactly 32 bytes
LEGACY_NODE_API_URL=http://127.0.0.1:8001
FASTAPI_BASE_URL=http://127.0.0.1:8000
AUTH_WORKSPACE_ID=6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b
AUTH_TRUST_PROXY=false   # true behind nginx/ALB so rate limiting sees client IPs
AUTH_COOKIE_SECURE=true  # when served over HTTPS
```

For invitation email, configure the dedicated CASE system mailbox (`SMTP_*`,
including a Gmail App Password — see *Sending from the CASE system account*
below). For local development without SMTP, set
`AUTH_DEV_LOG_MAGIC_LINKS=true` and the magic link is printed to the gateway log;
never enable that in production. For FastAPI's audit endpoints set
`AUTH_MODE=mock` in its environment.

### 3. Migrations

The gateway has its own ledger (`auth_gateway_migrations`) and applies only its
own file:

```bash
cd template-module/server
npm run migrate       # existing workflow tables + audit_events (once)
npm run auth:migrate  # auth_accounts, auth_invitations, auth_refresh_tokens
```

`auth:migrate` refuses to run until `operators` exists, and the gateway refuses
to start until `audit_events` exists. Both errors are explicit.

### 4. Run three processes

```bash
# 1) existing FastAPI (unchanged)
cd backend && AUTH_MODE=mock uvicorn server:app --port 8000

# 2) existing Express (unchanged code; different port)
cd template-module/server && PORT=8001 npm run dev

# 3) gateway
cd template-module/server && npm run dev:auth     # :8080

# 4) dashboard
cd dashboard && npm run dev                       # :5174, proxies /api → :8080
```

Production build:

```bash
cd template-module/server && npm run build && npm run start:auth
```

`tsc` does not copy `.sql` files; the runner falls back to
`src/auth-gateway/db/migrations`. Deploy the source tree or copy that folder to
`dist/auth-gateway/db/migrations` alongside the built JS.

### 5. First login

1. Ensure `operators` is empty in a fresh database.
2. Open the dashboard → **Continue with Google**.
3. The first account becomes `admin`; `ROOT_ADMIN_INITIALIZED` and
   `AUTHENTICATION_SUCCESS` appear in the audit trail.
4. Invite the next person:

```bash
curl -X POST http://localhost:8080/api/invitations \
  -H "Authorization: Bearer <admin access JWT>" \
  -H "content-type: application/json" \
  -d '{"email":"person@agency.gov.my","role":"operator"}'
```

In the browser the admin session is an HttpOnly cookie, so the UI can call the
same endpoint with `credentials: "include"` and no Authorization header.

## API summary

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/auth/google/start` | public | Begin OAuth; 302 to Google |
| GET | `/api/auth/google/callback` | public | Exchange code, bootstrap/link, set cookies |
| POST | `/api/auth/refresh` | refresh cookie | Rotate refresh, issue new access JWT |
| POST | `/api/auth/logout` | refresh cookie | Revoke refresh, clear cookies |
| GET | `/api/auth/me` | JWT | Operator + permissions |
| GET | `/api/auth/vault` | JWT | Integration connection booleans (no secrets) |
| POST | `/api/auth/vault/:provider` | JWT | Encrypt + upsert one provider secret |
| DELETE | `/api/auth/vault/:provider` | JWT | Remove one provider secret |
| GET | `/api/internal/vault/:operator_id/:provider` | internal key | Just-in-time decryption for workflow execution |
| POST | `/api/invitations` | admin JWT | Create 2-hour invitation, send email |
| GET | `/api/invitations` | admin JWT | List invitations (digests never exposed) |
| GET | `/api/invitations/accept?token=` | token | Consume invite, create operator, start Google |
| GET | `/api/health` | public | Gateway liveness |

JWT claims: `sub` (operator id), `email`, `role`, `workspaceId`, plus `iss`,
`aud`, `jti`, `iat`, `exp`. HS256 with `AUTH_JWT_SECRET` (≥32 chars).

## Security properties and limits

- Client-supplied identity headers are always stripped, even on public routes.
- State + nonce prevent OAuth CSRF/replay; ID tokens are verified for audience,
  nonce, verified email and optional hosted domain.
- JWTs live only in HttpOnly cookies; no localStorage token, no token in URLs
  except the single-use invitation link.
- Refresh tokens rotate atomically. Reusing an old token revokes the whole
  family and returns `401 REFRESH_REUSE`.
- Mutations require a same-origin `Origin` (or no Origin for server clients) and
  `SameSite=Lax`; cross-site requests get `403 CROSS_ORIGIN_BLOCKED`.
- Auth endpoints are rate-limited (`AUTH_RATE_LIMIT_MAX` per 15 min by default).
- Invitation links are stored as digests and capped at 2 hours.
- Revoked operators (`operators.revoked_at`) are rejected on every request and
  audited; their rows and history are never deleted.
- Vault secrets are encrypted per operator with AAD binding; a database dump
  alone does not yield a usable token. Losing `VAULT_MASTER_KEY` means members
  must reconnect (there is no recovery path by design).
- Single workspace per gateway (`AUTH_WORKSPACE_ID`). Multi-tenant routing needs
  a workspace claim and per-tenant header selection, not implemented here.
- No invitation-management UI was added; use the API or build a small admin
  screen. The existing Members screen still uses the legacy operator endpoints,
  which continue to work through the gateway.
- Audit is asynchronous and best-effort at the call site, as in the rest of the
  platform; it is not a transactional outbox.

## Tests

```bash
cd template-module/server
npm run typecheck
npx vitest run tests/auth-gateway
```

Covered: JWT sign/verify/expiry, spoofed-header stripping, JWT → legacy header
injection, revoked access, legacy switch, CSRF origin guard, root bootstrap,
OAuth state failure, uninvited account, admin-only invitations, two-hour expiry,
single-use acceptance, refresh rotation + replay detection, real reverse-proxy
path preservation to both upstreams, audit payload canonicalisation (no PII, no
floats, no forbidden keys), and the integration vault: round-trip, tamper and
AAD-binding failures, per-operator isolation, status-only responses, rotation,
idempotent delete, and internal-key enforcement.
