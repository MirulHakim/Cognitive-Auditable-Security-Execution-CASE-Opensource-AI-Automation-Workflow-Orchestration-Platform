# User-scoped integration vault

Encrypted-at-rest storage for the credentials an operator connects to their own
profile: a Telegram bot token and a Gmail app password. The vault lives entirely
in the auth-gateway sidecar; the existing Express and FastAPI applications are
not modified.

```
Browser ── POST /api/auth/vault/telegram ──▶ Gateway
                                             │  validate session (JWT cookie)
                                             │  AES-256-GCM encrypt
                                             │  AAD = operator + provider
                                             ▼
                                      auth_vault_secrets
                                      (operator_id, provider,
                                       cipher_text, iv, auth_tag)

Workflow engine ── GET /api/internal/vault/:operator_id/:provider ──▶ Gateway
                   x-internal-api-key                                │ decrypt in memory
                                                                     ▼
                                                                  plaintext
```

## Security model

- **Per-operator ownership.** `auth_vault_secrets.operator_id` is a foreign key
  to `operators(operator_id)` with `ON DELETE CASCADE`. There is no
  `workspace_id` column: a Telegram token belongs to one person, not the team.
- **One active secret per provider.** The table's primary key is
  `(operator_id, provider)`. Reconnecting performs an upsert, which rotates the
  value instead of creating a second active credential.
- **Authenticated encryption.** AES-256-GCM, a fresh random 12-byte IV per
  write, and a 16-byte authentication tag. Tampering with the ciphertext, IV or
  tag fails decryption rather than producing garbage.
- **AAD binding.** The envelope is encrypted with additional authenticated data
  `auth-vault:v1:<operator_id>:<provider>`. A stolen ciphertext copied onto
  another operator's row cannot be decrypted there.
- **Write-only to the browser.** `GET /api/auth/vault` returns booleans only.
  No endpoint available to a signed-in user returns ciphertext or plaintext.
- **Just-in-time decryption.** The workflow engine asks for a secret with a
  pre-shared key immediately before a step needs it. The gateway decrypts into
  memory and returns `Cache-Control: private, no-store`.

What a database leak exposes: the set of providers each operator connected and
opaque ciphertext. It does not expose a usable credential unless
`VAULT_MASTER_KEY` is also compromised.

## Required configuration

Add to `template-module/server/.env`:

```bash
# Exactly 32 bytes: base64, base64url, 64 hex characters, or 32 raw characters.
# REQUIRED — the gateway refuses to start without it.
openssl rand -base64 32
VAULT_MASTER_KEY=<paste generated value>

# Pre-shared key for the workflow engine. At least 32 characters.
# Empty/unset disables the internal route with 503 INTERNAL_VAULT_DISABLED.
openssl rand -hex 32
VAULT_INTERNAL_API_KEY=<paste generated value>
```

There is deliberately **no fallback** to `AUTH_JWT_SECRET`. Rotating the master
key makes every existing vault row undecryptable; members must reconnect their
credentials. Keep the key stable and store it in your secret manager.

## Migration

The gateway applies its own migrations when `AUTH_AUTO_MIGRATE=true`, or run:

```bash
cd template-module/server
npm run auth:migrate
```

New file: `src/auth-gateway/db/migrations/006_auth_vault_secrets.sql`.

```sql
CREATE TABLE IF NOT EXISTS auth_vault_secrets (
  operator_id TEXT NOT NULL REFERENCES operators(operator_id) ON DELETE CASCADE,
  provider    TEXT NOT NULL CHECK (provider IN ('telegram', 'gmail')),
  cipher_text TEXT NOT NULL,
  iv          TEXT NOT NULL,
  auth_tag    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT auth_vault_secrets_pkey PRIMARY KEY (operator_id, provider),
  CONSTRAINT auth_vault_secrets_iv_shape CHECK (iv ~ '^[A-Za-z0-9+/]{16}$'),
  CONSTRAINT auth_vault_secrets_auth_tag_shape CHECK (auth_tag ~ '^[A-Za-z0-9+/]{22}==$')
);
```

The migration is additive: it creates a table, does not alter any existing one,
and references the existing `operators` identity table. The table is dropped
with the operator on a hard revocation; a soft revocation is completed by the
gateway's credential purge, which also removes vault rows.

## Browser API

All three routes require the normal HttpOnly JWT session. The operator id comes
exclusively from the verified session, never from the request body.

### `GET /api/auth/vault`

```json
{ "telegram": true, "gmail": false }
```

Response headers include `Cache-Control: private, no-store`. A frontend should
use this only to render Connected / Not Linked state.

### `POST /api/auth/vault/:provider`

`provider` is `telegram` or `gmail`.

```bash
curl -X POST http://localhost:8080/api/auth/vault/telegram \
  -H "Cookie: case_session=<access JWT>" \
  -H "content-type: application/json" \
  -d '{"token":"123456789:AAH..."}'
```

```json
{ "provider": "telegram", "connected": true, "updatedAt": "2026-11-17T10:00:00.000Z" }
```

The body is strict: only `token` is accepted. Leading/trailing whitespace is
trimmed. The response never echoes the credential.

### `DELETE /api/auth/vault/:provider`

```json
{ "provider": "telegram", "connected": false, "deleted": true }
```

Idempotent: a second call returns `deleted: false` with HTTP 200.

Error codes: `400 UNSUPPORTED_VAULT_PROVIDER`, `400 INVALID_VAULT_SECRET`,
`401 UNAUTHENTICATED`, `403 CROSS_ORIGIN_BLOCKED`, `500 INTERNAL_ERROR`.

## Internal workflow-engine route

```
GET /api/internal/vault/:operator_id/:provider
x-internal-api-key: <VAULT_INTERNAL_API_KEY>
```

This route is mounted **before** browser session authentication. A valid user
cookie is not sufficient, and the endpoint is not proxied to any upstream.

```bash
curl http://localhost:8080/api/internal/vault/op-123/telegram \
  -H "x-internal-api-key: $VAULT_INTERNAL_API_KEY"
```

```json
{
  "operatorId": "op-123",
  "provider": "telegram",
  "secret": "123456789:AAH...",
  "updatedAt": "2026-11-17T10:00:00.000Z"
}
```

- `401 INTERNAL_UNAUTHENTICATED` — missing or wrong key. Comparison is
  constant-time.
- `503 INTERNAL_VAULT_DISABLED` — `VAULT_INTERNAL_API_KEY` is not configured.
  The route fails closed instead of falling back to a browser session.
- `404 VAULT_SECRET_NOT_FOUND` — operator has no credential for that provider.
- `500 VAULT_DECRYPTION_FAILED` — wrong/rotated master key, or a tampered row.
  The response never includes cryptographic detail.

The workflow engine should:

1. Keep `VAULT_INTERNAL_API_KEY` in its own server-side environment. Never send
   it to a browser, embed it in a workflow template, or store it in the vault.
2. Request the secret only at the moment a step executes, passing the operator
   id from the workflow instance's owner.
3. Hold the plaintext only in local memory for that execution. Do not write it
   to logs, traces, job payloads, retry queues or a database.
4. Treat `404` as "the operator must connect the integration" and surface a
   user-facing action; treat `500` as a retryable/operational failure.
5. Prefer a direct in-process call where the workflow engine shares the gateway
   codebase: `createVaultService({ store, masterKey })` then
   `reveal(operatorId, provider)`. The HTTP route is for a separate service.

Example Node client:

```ts
const response = await fetch(
  `${GATEWAY_URL}/api/internal/vault/${encodeURIComponent(operatorId)}/${provider}`,
  {
    headers: { "x-internal-api-key": process.env.VAULT_INTERNAL_API_KEY! },
    cache: "no-store",
  },
);
if (!response.ok) throw new Error(`vault lookup failed: ${response.status}`);
const { secret } = await response.json();
// use `secret` for this step only; never log or persist it
```

## Frontend behaviour

`dashboard/src/features/integrations/IntegrationsView.tsx`:

- loads `GET /api/auth/vault` on mount and on retry;
- opens the existing secure input modal for Connect Token / Connect Inbox;
- submits through `POST /api/auth/vault/:provider` and keeps the modal open on
  failure with the server's message;
- disconnects through `DELETE`, with the existing confirmation modal;
- renders Connected / Not Linked from server state only.

Plaintext exists in the modal's controlled input until submit. On success the
input is cleared and the component unmounts its value; nothing is written to
`localStorage` or any other client-side store. Cards display "Encrypted in your
vault" rather than a masked token, because the browser cannot read the value
back.

## Files

| Concern | File |
|---|---|
| AES-256-GCM primitives, key decoding, AAD | `src/auth-gateway/vault.ts` |
| Seal / upsert / reveal service | `src/auth-gateway/vaultService.ts` |
| Browser routes | `src/auth-gateway/routes/vault.ts` |
| Internal route + constant-time key check | `src/auth-gateway/routes/internalVault.ts` |
| Persistence | `src/auth-gateway/store.ts` |
| Migration | `src/auth-gateway/db/migrations/006_auth_vault_secrets.sql` |
| Tests | `tests/auth-gateway/vault.test.ts` |
| React page | `dashboard/src/features/integrations/IntegrationsView.tsx` |
