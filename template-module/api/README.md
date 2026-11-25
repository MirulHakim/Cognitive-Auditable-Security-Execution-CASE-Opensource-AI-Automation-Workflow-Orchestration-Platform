# CASE workflow API — FastAPI

The Python runtime for the workflow engine. It replaces the Express server in
`template-module/server` with the same HTTP contract, so the dashboard does not
change when the proxy target moves.

```
dashboard (React)  ──/api──▶  FastAPI :8000  ──▶  PostgreSQL :5433
                                    │
                                    ├─▶ Ollama (LLM reasoner, intake summaries)
                                    └─▶ output/documents (generated files)
```

## Run it

```bash
docker compose up -d                     # Postgres on 127.0.0.1:5433 (from the repo root)

cd template-module/api
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt     # Windows
# .venv/bin/python -m pip install -r requirements.txt       # macOS / Linux

cp .env.example .env                     # DATABASE_URL, OLLAMA_*, READER_ROOT …
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Migrations run on startup (`AUTO_MIGRATE=true`). They are the same SQL files the
Node server used plus `007_node_vocabulary.sql`, so a database written by either
runtime stays valid: this API verifies audit chains the Node server produced, and
the Node server can still read templates created here.

```bash
.venv/Scripts/python -m pytest -q        # 15 contract tests
```

## Endpoints

| Area | Routes |
|---|---|
| identity | `GET /api/operators/me`, `GET/POST /api/operators`, `PATCH /api/operators/:id/role`, `DELETE /api/operators/:id` |
| templates | `GET/POST /api/templates`, `GET/PUT/DELETE /api/templates/:id`, `POST /api/templates/generate`, `/approve`, `/reject`, `/activate` |
| runs | `GET/POST /api/instances`, `GET /api/instances/:id`, `POST /:id/respond`, `POST /:id/intake`, `POST /:id/cancel`, `GET /:id/documents/:stepId` |
| audit | `GET /api/audit`, `GET /api/audit/events/:id`, `POST /api/audit/verify` |
| editor | `GET /api/nodes` (the node catalogue), `GET /api/nodes/health` |
| ops | `GET /api/health` |

Errors use the envelope the dashboard already renders:
`{"error": {"code", "message", "details"}}`.

## Nodes

Each node on the editor canvas is one execution step. The catalogue
(`app/schemas.py::NODE_CATALOGUE`) declares, per type: its category, title,
description, defaults and the fields its right-hand settings panel shows. Adding
a node means one catalogue entry plus one handler in
`app/execution/handlers.py`.

| Category | Nodes |
|---|---|
| Triggers | `trigger_webhook`, `trigger_cron`, `trigger_email`, `trigger_telegram` |
| People & approvals | `review`, `validation`, `approval`, `intake`, `notification` |
| AI agents | `llm_agent` (LLM reasoner), `agent_react` |
| Logic | `logic_condition` (if / else branch) |
| Tools | `document` (HTML/PDF/DOCX generator), `http_request` |
| Data sources | `document_reader` (folder reader), `db_query` (read-only SELECT) |
| Integrations | `gmail`, `telegram` (terminal, simulated) |

Execution is a deterministic walk over the approved steps
(`app/execution/runner.py`). `approval` and `intake` pause the run; the resume
routes continue from the next index. Every executed step writes a `step_runs`
row, and every privileged action appends a hash-chained `audit_events` row.

## Business rules

* the first step must be a trigger or a review; at most one trigger, and it can
  only be first;
* an approval must come after a validation;
* `gmail` / `telegram` end the chain — nothing may follow them;
* notification channels are limited to `email` and `telegram`;
* `db_query` may only read allowlisted tables (no free SQL from the browser);
* `document_reader` only reads inside `READER_ROOT`;
* `http_request` is simulated unless `ALLOW_HTTP_STEPS=true`.

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 8000 | advertised port |
| `DATABASE_URL` | `postgresql://postgres:postgres@127.0.0.1:5433/template_module` | Postgres |
| `AUTO_MIGRATE` | true | apply pending SQL migrations on startup |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | `http://127.0.0.1:11434` / `qwen3.5:9b` | the model |
| `DOCUMENT_OUTPUT_DIR` | `../../output/documents` | where generated documents are written |
| `READER_ROOT` | `../../samples` | sandbox for the document reader |
| `ALLOW_HTTP_STEPS` | false | enable real outbound HTTP |
| `MAX_STEPS` | 30 | template size limit |

## Tests

`tests/test_contract.py` pins the audit digest to a hash produced by the Node
implementation, plus the node catalogue, business rules and the condition
evaluator. Run it before changing either runtime.
