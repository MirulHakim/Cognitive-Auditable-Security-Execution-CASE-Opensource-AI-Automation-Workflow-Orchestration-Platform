# CASE Platform — Local Runbook

Zero-to-running local setup for the current CASE stack:

- PostgreSQL for persistence
- Express workflow API (the legacy Node backend)
- Auth gateway sidecar (Google OAuth, sessions, invitations, vault)
- React dashboard

Use this runbook from a fresh clone. It assumes local development only.

---

## Ports and process map

| Component | Directory | Port | Notes |
|---|---|---:|---|
| PostgreSQL 16 | repository root | `5432` | Docker service is named `postgres` |
| Express workflow API | `template-module/server` | `8001` | Must not use `8000` when the gateway is running |
| FastAPI audit API (optional) | `backend` | `8000` | Only needed for `/api/v1/*` routes |
| Auth gateway | `template-module/server` | `8080` | Browser-facing auth and API ingress |
| React dashboard | `dashboard` | `5174` | Vite proxies `/api` to `:8080` |

Request path:

```text
Browser :5174
   └── /api/* ──▶ Auth gateway :8080
                    ├── /api/auth/*, /api/invitations/*  (gateway-owned)
                    └── everything else ──▶ Express :8001
                                             └── /api/v1/* ──▶ FastAPI :8000
```

The Express API and the gateway **must use the same database**. The gateway has foreign keys to `operators`, which the Express migrations own.

### Port collisions and machine differences

These four ports are the usual reason the stack works on one laptop but not another:

| Port | If it is already in use |
|---|---|
| `5432` | Stop the native PostgreSQL service, or change Compose to `"5433:5432"` and use `:5433` in **both** database URLs. |
| `8001` | Set `PORT=8011` and `LEGACY_NODE_API_URL=http://127.0.0.1:8011`, then restart the API and gateway. |
| `8080` | Set `AUTH_GATEWAY_PORT=8081` and add `VITE_API_PROXY=http://127.0.0.1:8081` to `dashboard/.env`, then restart the gateway and Vite. |
| `5174` | Change `server.port` in `dashboard/vite.config.ts`; then update `AUTH_PUBLIC_URL`, `AUTH_DASHBOARD_URL`, `AUTH_GOOGLE_REDIRECT_URI`, and the Google Cloud redirect URI to the new origin. |

Find the process holding a port:

```bash
# macOS / Linux / Git Bash
lsof -i :8080

# Windows PowerShell
Get-NetTCPConnection -LocalPort 8080 | Select-Object OwningProcess
```

Keep server-to-server addresses on `127.0.0.1` and the browser address on `localhost`. Use the same browser origin everywhere; mixing `localhost` and `127.0.0.1` breaks OAuth cookies and redirect matching.

Do **not** copy `node_modules/`, `dist/`, `.venv/`, or the Docker volume to another machine. Reinstall dependencies and rebuild the database with migrations. If you need real data, move it with `pg_dump` / `pg_restore`, not by copying the volume.

---

## 1. Prerequisites and environment setup

### 1.1 Install the baseline tools

| Tool | Version | Check |
|---|---|---|
| Node.js | **22.12+** (Vite 8 requires `^20.19.0 || >=22.12.0`) | `node -v` |
| npm | 10+ | `npm -v` |
| Docker Desktop | Current, with Compose v2; Windows needs WSL 2 | `docker compose version` |
| Git | Any current version | `git --version` |
| Google account | For OAuth sign-in | — |

Ollama is **optional for sign-in**. It is only needed for AI template drafting and document content. If Ollama is down, those features return `502 AI_GENERATION_FAILED`; the rest of the app still runs.

Python/FastAPI is **optional for this runbook**. The three-process stack below runs without it. Only the `/api/v1/*` audit routes need it.

> Commands are bash syntax (macOS, Linux, or Git Bash on Windows). PowerShell differences:
>
> - `cp` → `Copy-Item`
> - `curl` → `curl.exe` (or `Invoke-RestMethod`)
> - PowerShell has no `<<` heredoc; use the interactive `psql` form in section 4.2

### 1.2 Clone and install dependencies

```bash
git clone https://github.com/MirulHakim/Cognitive-Auditable-Security-Execution-CASE-Opensource-AI-Automation-Workflow-Orchestration-Platform.git case-platform
cd case-platform
```

Install the backend workspace and the dashboard:

```bash
cd template-module
npm ci

cd ../dashboard
npm ci
```

`template-module` is an npm workspace; installing there also installs `server/`. `npm ci` installs exactly the committed lockfile, which is what prevents “it works on my machine” dependency drift. Use `npm install` only when you intentionally change dependencies.

### 1.3 Create the environment file

There is **one env file for both backend processes**:

```text
template-module/server/.env
```

Both `npm run dev` and `npm run dev:auth` run with `template-module/server` as their working directory and load this file. Do **not** create a separate `src/auth-gateway/.env`; it will not be loaded.

```bash
cd template-module/server
cp .env.example .env
```

### 1.4 Reusing an existing `.env` (handoff from another machine)

If a teammate already has a working stack, they can send you their `.env` instead of generating new secrets. That keeps OAuth, SMTP, and vault behavior identical.

**Treat this file as a secret.** It contains `AUTH_JWT_SECRET`, `VAULT_MASTER_KEY`, `GOOGLE_CLIENT_SECRET`, and `SMTP_PASS`. Send it through a password manager or an encrypted archive — never Slack, email, chat, or git.

On the sending machine, confirm it is ignored:

```bash
git check-ignore -v template-module/server/.env
```

On the receiving machine, put it at exactly:

```text
<repository-root>/template-module/server/.env
```

If the file is in the default Downloads folder:

```bash
cp ~/Downloads/.env template-module/server/.env
```

```powershell
Copy-Item $HOME\Downloads\.env .\template-module\server\.env
```

Back up an existing `.env` first if it already contains machine-specific values. There is no separate gateway `.env`, and `template-module/server/src/auth-gateway/.env` is not loaded.

```bash
ls -l template-module/server/.env
git check-ignore -v template-module/server/.env
```

A `.env` shares configuration only, not data. Every machine still needs PostgreSQL and the migrations in section 2. If two machines point `DATABASE_URL` at the same database, they share members, invitations, and vault secrets.

Change only the values that are machine-specific:

| Variable(s) | Default | Change when |
|---|---|---|
| `DATABASE_URL`, `AUTH_DATABASE_URL` | `127.0.0.1:5432/case_workflow_db` | PostgreSQL uses another port, host, or database name |
| `PORT`, `LEGACY_NODE_API_URL` | `8001` | The workflow API port is already taken; both must change together |
| `AUTH_GATEWAY_PORT` | `8080` | The gateway port is already taken |
| `AUTH_PUBLIC_URL`, `AUTH_DASHBOARD_URL`, `AUTH_GOOGLE_REDIRECT_URI` | `http://localhost:5174` | The dashboard runs on another port or host; the redirect URI must also be updated in Google Cloud |
| `OLLAMA_BASE_URL` | `127.0.0.1:11434` | Ollama is remote or not installed |
| `SMTP_*` | The sender's system mailbox | You do not have access to that mailbox; use `SMTP_HOST=` and `AUTH_DEV_LOG_MAGIC_LINKS=true` locally |

Keep `AUTH_JWT_SECRET` and `VAULT_MASTER_KEY` stable when reusing an existing database. Changing the JWT secret invalidates every session; changing the vault key makes existing integration credentials undecryptable.

If the OAuth consent screen is in **Testing**, add the receiving developer's Google address as a test user. A shared `.env` does not grant access to someone else's Google account.

If the file is exposed, rotate `AUTH_JWT_SECRET`, rotate `VAULT_MASTER_KEY` (members must reconnect integrations), rotate the Google client secret, and create a new SMTP App Password.

### 1.5 Generate the required secrets

Skip this section if you received a working `.env` in 1.4. Otherwise, generate each value **once** and paste it into `.env`. Regenerating `VAULT_MASTER_KEY` makes every existing integration secret undecryptable.

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # AUTH_JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # VAULT_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # VAULT_INTERNAL_API_KEY
```

- `AUTH_JWT_SECRET`: at least 32 characters.
- `VAULT_MASTER_KEY`: **exactly 32 bytes** when decoded. The gateway refuses to start without it.
- `VAULT_INTERNAL_API_KEY`: optional. If empty, the internal vault-decryption route answers `503`; browser vault features still work.
- `AUTH_TOKEN_ENCRYPTION_KEY`: optional. Blank derives a key from `AUTH_JWT_SECRET`; set a separate value in production so the two can be rotated independently.

### 1.6 Critical `.env` checklist

Open `template-module/server/.env` and verify these values. Keep the rest of the example file as-is unless you need to change a port.

#### Workflow API

```dotenv
# The gateway proxies to this port. Do not leave this at 8000.
PORT=8001
CORS_ORIGINS=http://localhost:5174

# Same database as AUTH_DATABASE_URL below.
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/case_workflow_db
AUTO_MIGRATE=true
```

#### Auth gateway

```dotenv
AUTH_GATEWAY_PORT=8080
AUTH_PUBLIC_URL=http://localhost:5174
AUTH_DASHBOARD_URL=http://localhost:5174
AUTH_GOOGLE_REDIRECT_URI=http://localhost:5174/api/auth/google/callback

AUTH_JWT_SECRET=<paste the generated value>
AUTH_JWT_ISSUER=case-auth-gateway
AUTH_JWT_AUDIENCE=case-platform

GOOGLE_CLIENT_ID=<from Google Cloud>
GOOGLE_CLIENT_SECRET=<from Google Cloud>
GOOGLE_HOSTED_DOMAIN=

AUTH_WORKSPACE_ID=6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b

# MUST resolve to exactly the same database as DATABASE_URL.
AUTH_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/case_workflow_db
AUTH_AUTO_MIGRATE=true

LEGACY_NODE_API_URL=http://127.0.0.1:8001
FASTAPI_BASE_URL=http://127.0.0.1:8000
AUTH_FASTAPI_PREFIXES=/api/v1

AUTH_CORS_ORIGINS=http://localhost:5174
AUTH_COOKIE_SECURE=false
AUTH_TRUST_PROXY=false
AUTH_INVITATION_TTL_MINUTES=120
AUTH_APP_NAME=CASE

# Keep false for strict invitation-only sign-in.
AUTH_ALLOW_LEGACY_IDENTITY=false
```

#### Integration vault

```dotenv
AUTH_TOKEN_ENCRYPTION_KEY=
VAULT_MASTER_KEY=<paste the generated value>
VAULT_INTERNAL_API_KEY=<paste the generated value, or leave empty>
```

#### Invitation email (SMTP)

Invitations are sent by the platform from one dedicated CASE mailbox, never by an admin's personal Gmail.

For the fastest local start, leave `SMTP_HOST` empty and let the gateway print the magic link to its terminal:

```dotenv
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_DEBUG=true
AUTH_EMAIL_FROM=
AUTH_EMAIL_REPLY_TO=
AUTH_DEV_LOG_MAGIC_LINKS=true
```

To send real email, configure the dedicated mailbox:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=noreply.yourcase@gmail.com
SMTP_PASS=your16charapppassword
AUTH_EMAIL_FROM=CASE <noreply.yourcase@gmail.com>
AUTH_DEV_LOG_MAGIC_LINKS=false
SMTP_DEBUG=true
```

Rules that prevent most invitation failures:

- Gmail requires a **16-character App Password**, not the account password.
- Enable 2-Step Verification before creating an App Password: <https://myaccount.google.com/apppasswords>.
- Port `587` uses `SMTP_SECURE=false` (STARTTLS). Port `465` uses `SMTP_SECURE=true`.
- For Gmail, `AUTH_EMAIL_FROM` must use the same address as `SMTP_USER`, otherwise Gmail rewrites the sender.
- Set `AUTH_DEV_LOG_MAGIC_LINKS=false` outside local development.
- Set `SMTP_DEBUG=false` after delivery works.

#### Optional Ollama settings

```dotenv
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5:9b
```

Pull the model only if you want AI drafting:

```bash
ollama pull qwen3.5:9b
ollama serve
```

### 1.7 Create the Google OAuth client

The gateway will not start without `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

1. Open <https://console.cloud.google.com/>.
2. Configure **APIs & Services → OAuth consent screen** as **External / Testing**.
3. Add every Google account that will sign in as a **test user**. A shared `.env` does not authorize a new Google account by itself.
4. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
5. Choose **Web application**.
6. Add this exact **Authorized redirect URI**:

```text
http://localhost:5174/api/auth/google/callback
```

7. Copy the client ID and client secret into `.env`.

Use `localhost`, not `127.0.0.1`, in the browser and in the redirect URI. They are different origins for cookies and OAuth redirect matching.

Leave `GOOGLE_HOSTED_DOMAIN` empty unless every member belongs to one Google Workspace domain. When set, accounts outside that domain are rejected.

---

## 2. Database initialization

### 2.1 Start PostgreSQL

From the repository root:

```bash
docker compose up -d postgres
docker compose ps
```

The service is named **`postgres`** in this repository. `docker compose up -d db` will fail with “no such service”.

Wait until `docker compose ps` shows the container as **healthy**.

### 2.2 Create the workflow database

The Compose init script creates `case_dev` for the optional Python/FastAPI side. The Node workflow API and auth gateway use a separate database, `case_workflow_db`, so their `audit_events` table does not collide with FastAPI's audit schema.

Create it once (the same command works in PowerShell):

```bash
docker compose exec postgres psql -U postgres -c "CREATE DATABASE case_workflow_db;"
```

If PostgreSQL answers `database "case_workflow_db" already exists`, that is safe — continue. Verify the target database:

```bash
docker compose exec postgres psql -U postgres -d case_workflow_db -c "SELECT current_database();"
```

Expected output:

```text
 current_database
------------------
 case_workflow_db
```

### 2.3 Run migrations in order

Both commands read `template-module/server/.env`.

```bash
cd template-module/server

# 1. Legacy workflow tables, audit_events, seed identities
npm run migrate

# 2. Gateway tables: auth_accounts, invitations, refresh tokens, vault
npm run auth:migrate
```

Expected order matters:

- `npm run migrate` creates `operators` and `audit_events`.
- `npm run auth:migrate` refuses to run without `operators`, and the gateway refuses to start without `audit_events`.

On a fresh database, `npm run migrate` seeds three demo identities (`ops-admin`, `ops-operator`, `ops-auditor`). They are **not** Google-linked and cannot sign in through the gateway; they exist for the legacy API and demos. This matters for first login — see section 4.

### 2.4 Verify the tables

```bash
docker compose exec postgres psql -U postgres -d case_workflow_db -c "\dt"
```

You should see at least:

```text
auth_accounts
auth_gateway_migrations
auth_invitations
auth_refresh_tokens
auth_vault_secrets
audit_events
operators
schema_migrations
step_runs
template_reviews
workflow_instances
workflow_templates
```

The LangGraph checkpoint tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`) are created automatically the first time the Express API boots.

Quick table check:

```bash
docker compose exec postgres psql -U postgres -d case_workflow_db -c "
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'operators', 'workflow_templates', 'template_reviews',
    'workflow_instances', 'step_runs', 'audit_events',
    'auth_accounts', 'auth_invitations', 'auth_refresh_tokens',
    'auth_vault_secrets'
  )
ORDER BY table_name;
"
```

---

## 3. Boot the services

Start these in separate terminals and leave each one running.

### Terminal 1 — Express workflow API

```bash
cd template-module/server
npm run dev
```

Equivalent from the workspace root:

```bash
cd template-module
npm run dev:server
```

Expected output includes:

```text
Template API listening on http://127.0.0.1:8001
```

If it says `8000`, `PORT` in `template-module/server/.env` is still wrong. The gateway proxies to `8001`.

### Terminal 2 — Auth gateway

```bash
cd template-module/server
npm run dev:auth
```

Expected output includes:

```text
[auth-gateway] listening on http://localhost:5174 (port 8080)
[auth-gateway] Google callback: http://localhost:5174/api/auth/google/callback
[auth-gateway] upstreams: node=http://127.0.0.1:8001 fastapi=http://127.0.0.1:8000 (/api/v1)
```

The gateway also prints its SMTP configuration at boot. `SMTP_PASS` is shown only as a length, never as a value.

If startup fails with `VAULT_MASTER_KEY is required` or `must decode to exactly 32 bytes`, fix that key before continuing.

### Terminal 3 — React dashboard

```bash
cd dashboard
npm run dev
```

Expected output includes:

```text
Local: http://localhost:5174/
```

Vite proxies `/api` to `http://127.0.0.1:8080` by default. You do not need a `dashboard/.env` for the normal setup. If you change `AUTH_GATEWAY_PORT`, set `VITE_API_PROXY=http://127.0.0.1:<port>` in `dashboard/.env` and restart Vite.

### Smoke test

From a fourth terminal, while all three are running:

```bash
curl -s http://127.0.0.1:8080/api/health
# {"status":"ok","service":"auth-gateway"}

curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5174/
# 200

curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:5174/api/auth/google/start
# 302 https://accounts.google.com/o/oauth2/v2/auth?...
```

If the last command returns `500` or connection refused, the gateway is not running or its Google credentials are incomplete.

> **After editing `.env`, restart Terminals 1 and 2.** `tsx watch` reloads TypeScript files, not `.env`. A gateway that exited on a missing key will not recover just because you saved `.env`.

---

## 4. First-time access (bootstrap the Root Admin)

### 4.1 Why automatic bootstrap does not run here

The gateway's `bootstrapRootAdmin()` only runs when `operators` is **empty**. The legacy migrations seed `ops-admin`, `ops-operator`, and `ops-auditor`, so the table is not empty. The first Google login therefore returns `INVITATION_REQUIRED` unless a matching operator already exists.

Seed the Root Admin explicitly.

### 4.2 Insert the Root Admin

Replace `you@example.com` with the **exact** Google account you added as a test user. Use lowercase.

From the repository root:

```bash
docker compose exec -T postgres psql -U postgres -d case_workflow_db <<'SQL'
INSERT INTO operators (operator_id, display_name, email, role)
VALUES (
  'root-admin',
  'Root Admin',
  'you@example.com',
  'admin'
)
ON CONFLICT (email) DO UPDATE
SET role = 'admin',
    display_name = EXCLUDED.display_name,
    revoked_at = NULL;

SELECT operator_id, display_name, email, role, revoked_at
FROM operators
WHERE operator_id = 'root-admin';
SQL
```

This is idempotent.

If two developers each run their own local database, each must seed their own Google address. If they share one database, seed once and invite the other developers from the Employees screen.

**PowerShell:** `<<'SQL'` heredocs are not supported. Open the database interactively and paste the same `INSERT` and `SELECT` statements:

```powershell
docker compose exec postgres psql -U postgres -d case_workflow_db
```

End the session with `\q` after the statements run.

### 4.3 Let the first Google sign-in create `auth_accounts`

You normally **should not** insert into `auth_accounts` manually. The gateway links the Google subject on the first successful login:

1. The Google profile email is matched against `operators.email`.
2. The gateway inserts the `auth_accounts` row with the real `google_sub`.
3. The session is issued.

A made-up or copied `google_sub` will cause `IDENTITY_CONFLICT` or a failed link. Only pre-insert an account if you already know the **exact numeric Google subject** for that account:

```sql
-- Advanced/optional. Skip this in normal setup.
-- Replace <GOOGLE_SUB> with the actual `sub` from Google, never the email.
INSERT INTO auth_accounts (account_id, operator_id, google_sub, email, email_verified)
VALUES (
  gen_random_uuid(),
  'root-admin',
  '<GOOGLE_SUB>',
  'you@example.com',
  TRUE
)
ON CONFLICT (operator_id) DO NOTHING;
```

### 4.4 Sign in

1. Open <http://localhost:5174>.
2. Click **Continue with Google**.
3. Choose the exact account you seeded.
4. You should land in the dashboard as an admin.

Verify the link:

```bash
docker compose exec postgres psql -U postgres -d case_workflow_db -c "
SELECT o.operator_id, o.display_name, o.email, o.role,
       a.google_sub, a.last_login_at
FROM operators o
LEFT JOIN auth_accounts a ON a.operator_id = o.operator_id
WHERE lower(o.email) = lower('you@example.com');
"
```

`google_sub` and `last_login_at` should both be populated after a successful sign-in. If `google_sub` is null, the email did not match or the callback failed; check the gateway terminal.

### 4.5 Invite the next member

The system is invitation-only after the Root Admin exists.

1. Sign in as the Root Admin.
2. Open **Employees** (or the member management screen).
3. Invite an email as `operator` or `auditor`.
4. The invitee has **2 hours** to accept.

If `SMTP_HOST` is empty and `AUTH_DEV_LOG_MAGIC_LINKS=true`, the gateway prints the acceptance link in Terminal 2. Copy that link into the browser. If SMTP is configured, the invitee receives the email from the CASE system mailbox.

The invitee must sign in with the **exact invited Google address**. Invitation acceptance creates the operator row; the first Google callback links the Google subject.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `no such service: db` | Compose service is named `postgres` | Use `docker compose up -d postgres` |
| `docker: command not found` | Docker Desktop's CLI is not on `PATH` | Start Docker Desktop; use PowerShell, or add Docker's `resources\bin` directory to `PATH` |
| Vite fails with a Node engine or `crypto` error | Node is older than Vite 8's minimum | Install Node 22 LTS or newer, then reinstall in `dashboard/` |
| `ECONNREFUSED 127.0.0.1:5432` | PostgreSQL is not running, or the port is occupied by another install | `docker compose ps`; use `127.0.0.1`, not `localhost` |
| `port is already allocated` on `5432` | A native PostgreSQL service owns the port | Stop it, or change the Compose host port and update both database URLs |
| Migrations say `target: .../template_module` | `.env` is missing or not being loaded | Create `template-module/server/.env` from `.env.example` and run the command from `template-module/server` |
| Gateway exits: `VAULT_MASTER_KEY is required` | Key missing from `.env` | Generate a 32-byte key and paste it in |
| Gateway exits: `VAULT_MASTER_KEY must decode to exactly 32 bytes` | Key is a passphrase or wrong length | Use `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |
| `audit_events is missing` | Gateway started before legacy migrations | Run `npm run migrate` first |
| `operators table is missing` | `auth:migrate` ran before `migrate` | Run `npm run migrate`, then `npm run auth:migrate` |
| `INVITATION_REQUIRED` after Google login | Google email is not in `operators` | Seed the Root Admin or invite that exact email |
| `ACCESS_REVOKED` | `operators.revoked_at` is set | Clear it for local dev: `UPDATE operators SET revoked_at = NULL WHERE email = '...';` |
| `redirect_uri_mismatch` | Google redirect URI is not exact | Use `http://localhost:5174/api/auth/google/callback` in Google Cloud |
| `OAUTH_STATE_INVALID` | Cookies blocked, mixed `localhost`/`127.0.0.1`, or stale tab | Use `localhost:5174`, clear cookies, retry |
| `535-5.7.8 BadCredentials` on invite | Gmail account password used for SMTP | Create a 16-character Google App Password |
| Google shows `access_denied` or `org_internal` on another device | The Google account is not a test user, or `GOOGLE_HOSTED_DOMAIN` excludes it | Add that email as a test user; clear the hosted-domain restriction for outside accounts |
| PowerShell rejects `grep`, `cut`, or `<<` | Those examples are bash-only | Use the cross-platform create command in 2.2 and the interactive `psql` form in 4.2; use `curl.exe` |
| Copied `node_modules`, `dist`, or the Docker volume | Native binaries and volumes are machine/OS-specific | Run `npm install` again, rebuild, and recreate the database with migrations |
| Invitation succeeds but no email | SMTP accepted but delivery filtered | Check spam, `SMTP_DEBUG=true`, and make `AUTH_EMAIL_FROM` match `SMTP_USER` |
| Dashboard API calls fail; gateway `/api/health` works | Express is not on `8001` | Set `PORT=8001`, restart Terminal 1 |
| `EADDRINUSE` on `8001`, `8080`, or `5174` | Old process still running | Stop the old terminal or process, then restart |
| Env changes have no effect | `tsx watch` does not watch `.env` | Stop and restart `npm run dev` and `npm run dev:auth` |

### Full local reset

This deletes all local database data:

```bash
docker compose down -v
docker compose up -d postgres
```

Then repeat section 2.2 onward: create `case_workflow_db`, run both migrations, and seed the Root Admin again.

---

## Minimal verification checklist

- [ ] `node -v` is 22.12 or newer
- [ ] `.env` is at `template-module/server/.env` and `git check-ignore` lists it
- [ ] `docker compose ps` shows `case-postgres` healthy
- [ ] `case_workflow_db` exists
- [ ] `npm run migrate` succeeds
- [ ] `npm run auth:migrate` succeeds
- [ ] `operators`, `auth_accounts`, `auth_invitations`, `auth_refresh_tokens`, and `auth_vault_secrets` exist
- [ ] Express listens on `:8001`
- [ ] Gateway listens on `:8080`
- [ ] Dashboard serves `:5174`
- [ ] `GET /api/health` returns `{"status":"ok","service":"auth-gateway"}`
- [ ] `/api/auth/google/start` returns a `302` to Google
- [ ] Root Admin seed exists with `role = 'admin'`
- [ ] First Google sign-in creates the `auth_accounts` link
