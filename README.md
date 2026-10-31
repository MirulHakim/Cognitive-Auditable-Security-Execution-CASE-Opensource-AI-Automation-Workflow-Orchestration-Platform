```markdown
# 🚀 CASE — Cognitive Auditable Security Execution Platform

> An open-source, Human-in-the-Loop (HITL) AI automation and workflow orchestration platform built with **FastAPI**, **LangGraph**, **Ollama (`qwen3.5:9b`)**, and **Tailscale**.

---

## 📋 Table of Contents
- [Overview](#-overview)
- [Architecture Overview](#-architecture-overview)
- [Repository Structure](#-repository-structure)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
- [Running Tests](#-running-tests)
- [Module Documentation](#-module-documentation)
- [Development Guide](#-development-guide)
  - [1. Running AI Document Generators](#1-running-ai-document-generators)
  - [2. Creating New Document Builders](#2-creating-new-document-builders)
  - [3. Adding LangGraph Workflow Nodes](#3-adding-langgraph-workflow-nodes)
- [Security & Path Guardrails](#-security--path-guardrails)
- [Troubleshooting](#-troubleshooting)

---

## 🔍 Overview

The **CASE Platform** provides stateful, human-in-the-loop AI automation with strict execution boundaries. Key architectural guarantees include:

* **Local Inference:** Driven by Qwen 3.5 (9B) via Ollama over local loopback (`127.0.0.1`) or Tailscale mesh.
* **Deterministic Structured Outputs:** Enforces strict output contracts using Pydantic schemas (eliminates LLM conversational filler).
* **Directory Locking:** All file generation tools are strictly path-sandboxed to prevent path traversal vulnerability attacks.
* **State Machine Workflows:** LangGraph-managed graphs with approval gates (`interrupt()`) for human authorization before high-risk actions.

---

## 🏗️ Architecture Overview

```text
[ Whitelisted Ingress ] ──▶ [ 1. Ingress Listener ]
 (Gmail / Telegram)            │ Filter sender against whitelist
                               ▼
                        [ 2. Intent & Planner ] ──▶ Ollama (Qwen 3.5:9B)
                               │                   Generates Plan & Summary
                               ▼
                       🛑 APPROVAL GATE #1 (Data Fetch Permission)
                               │ (Approved via Dashboard)
                               ▼
                        [ 3. Data Ingestion ]   ──▶ Whitelisted Sources
                               │
                               ▼
                        [ 4. Doc Generator ]    ──▶ PDF / Excel / Word / Text
                               │
                               ▼
                       🛑 APPROVAL GATE #2 (Final Delivery Review)
                               │ (Approved via Dashboard)
                               ▼
                        [ 5. Egress Responder ] ──▶ Reply Email / Telegram

```

---

## 📁 Repository Structure

```text
CASE-Platform/
├── backend/                        # Main backend application
│   ├── src/                        # Core backend source code
│   │   ├── workflow/                 # LangGraph state machine & approval nodes
│   │   ├── ai_intent/                # AI intent classification (Gemini)
│   │   ├── secure_api/               # Secure API Layer — enterprise integration & normalization
│   │   ├── audit/                    # Audit & Transparency Layer — hash chaining, provenance, export
│   │   ├── security/                 # Authentication & authorization (JWT, RBAC)
│   │   ├── document_generators/      # PDF, Excel, Word builder modules
│   │   │   ├── pdf/
│   │   │   ├── word/
│   │   │   └── xlsx/
│   │   └── storage/                  # Shared database pool (database.py) + migration runner (migrate.py)
│   ├── migrations/                 # Numbered SQL files, applied in order (001_..., 002_...)
│   ├── db/init/                    # One-time Postgres setup: roles + dev database
│   ├── tests/                      # Automated unit and integration test suite
│   ├── .venv/                      # Local Python virtual environment (git-ignored)
│   ├── pytest.ini
│   ├── requirements.txt
│   └── server.py                   # Primary FastAPI backend entrypoint
├── docs/                           # Module plans and guides (audit/, standardization/)
├── frontend/                       # React frontend (in progress)
├── .gitignore
├── docker-compose.yml              # Local PostgreSQL
└── README.md
```

## 🛠️ Prerequisites

Before you start, make sure you have installed:

1. **Python 3.11+**
2. **Node.js 18+ & npm** (for running the React Dashboard)
3. **Ollama**: Download from [ollama.com](https://ollama.com) and pull the Qwen model:
```bash
ollama pull qwen3.5:9b

```

4. **Docker Desktop** (runs PostgreSQL locally): [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/). On Windows it needs WSL 2; see [Troubleshooting](#docker-desktop-says-engine-stopped) if the engine does not start.

---

## 🚀 Quick Start

### 1. Clone Repository & Setup Backend

```powershell
# Clone the repository
git clone https://github.com/MirulHakim/Cognitive-Auditable-Security-Execution-CASE-Opensource-AI-Automation-Workflow-Orchestration-Platform.git
cd Cognitive-Auditable-Security-Execution-CASE-Opensource-AI-Automation-Workflow-Orchestration-Platform/backend

# Create Python virtual environment
python -m venv .venv

# Activate virtual environment (PowerShell)
.\.venv\Scripts\Activate.ps1

# Or for cmd.exe
.\.venv\Scripts\activate.bat

# Install core dependencies
pip install -r requirements.txt
```

### 2. Start the Database (PostgreSQL)

Run from the repository root (where `docker-compose.yml` is):

```powershell
docker compose up -d      # start PostgreSQL in the background
docker compose ps         # STATUS should say "healthy"
```

The first start downloads the `postgres:16` image and runs `backend/db/init/01_roles.sql` once, which creates:

| Name | What it is |
|---|---|
| `case_owner` | Database role that **owns** the tables and runs migrations |
| `case_app` | Database role the **app** connects as (cannot change or delete audit records) |
| `case_dev` | Development database |

Other useful commands: `docker compose down` (stop, keep data) and `docker compose down -v` (stop and **delete all data** for a fresh start).

### 3. Create the Tables (Migrations)

From `backend/`, as the owner role:

```powershell
# PowerShell
$env:CASE_MIGRATION_URL = "postgresql://case_owner:case_owner_dev@localhost:5432/case_dev"
.\.venv\Scripts\python -m src.storage.migrate

# cmd.exe
set CASE_MIGRATION_URL=postgresql://case_owner:case_owner_dev@localhost:5432/case_dev
.venv\Scripts\python -m src.storage.migrate
```

Running it again only applies new files. Never edit a migration that has already been applied; add a new numbered file instead.

The app itself connects as `case_app` through the `DATABASE_URL` setting (e.g. in `backend/.env`):

```
DATABASE_URL=postgresql://case_app:case_app_dev@localhost:5432/case_dev
```

> These passwords are for local development only.

### Viewing the Tables

PostgreSQL has no built-in web console (unlike the Firebase console). Use a client, e.g. the **PostgreSQL** extension for VS Code (by Microsoft) or pgAdmin, with host `localhost`, port `5432`, user `postgres`, password `postgres`.

---

## 🧪 Running Tests

From `backend/`:

```powershell
.\.venv\Scripts\python -m pytest                           # everything
.\.venv\Scripts\python -m pytest -m "not integration"      # unit tests only, no database needed
.\.venv\Scripts\python -m pytest -m integration -v         # PostgreSQL tests only
```

Tests marked `integration` need the database from step 2. They create their own `case_test` database on each run, so `case_dev` is not touched. If PostgreSQL is not running they are **skipped** (with the reason), not failed.

---

## 📚 Module Documentation

| Module | Owner | Docs |
|---|---|---|
| Audit & Transparency Layer | Ain | [docs/audit/README.md](docs/audit/README.md): how to record events from your module, logging patterns, database protection, status per phase |
| Standardization | Ain | [docs/standardization/STANDARDIZATION_MODULE_SPEC.md](docs/standardization/STANDARDIZATION_MODULE_SPEC.md) |

**Recording audit events from another module:** take an `AuditLogger` (from `src.audit.port`) as a parameter and call `await audit.log_event(...)`. Never put message bodies, prompts, tokens or email addresses in `details`. See the Audit README for the rules and for which logging pattern (A/B/C) to use.

---

## 💻 Development Guide

### 1. Running AI Document Generators

Test interactive AI generators directly from your terminal:

```powershell
# Run PDF Generator
.\venv\Scripts\python.exe src/document_generators/pdf_ai_runner.py

# Run Excel Generator
.\venv\Scripts\python.exe src/document_generators/excel_ai_runner.py

# Run Word Document Generator
.\venv\Scripts\python.exe src/document_generators/word_ai_runner.py

```

### 2. Creating New Document Builders

All document generation modules follow a 3-part pattern:

1. **Schema (`*_schemas.py`)**: Defines output layout with Pydantic.
2. **Builder (`*_builder.py`)**: Renders file formats using pure Python modules (`reportlab`, `openpyxl`, `python-docx`).
3. **Runner / Node (`*_ai_runner.py`)**: Links `ChatOllama` with `.with_structured_output()` to safely generate raw file data.

#### Path Safety Guard Pattern

Every document builder **must** lock file output to its local directory to prevent path traversal vulnerabilities:

```python
from pathlib import Path

def generate_file_safely(data) -> str:
    script_dir = Path(__file__).parent.resolve()
    clean_filename = Path(data.filename).name  # Strips relative path tokens (../)
    target_path = (script_dir / clean_filename).resolve()

    # Security check: Ensure target file stays inside root directory
    if target_path.parent != script_dir:
        raise PermissionError("Access Denied: Path traversal attempt detected.")

    # Write file content...
    return str(target_path)

```

---

## 🛡️ Security & Path Guardrails

* **Zero Path Traversal:** No LLM-generated string can write files outside its designated execution directory.
* **Strict JSON Schemas:** All model output is validated via Pydantic; non-conforming tokens are rejected automatically.
* **Human-in-the-Loop Approval:** Destructive or high-impact actions trigger an `interrupt()` gate in LangGraph, pausing execution until explicitly approved via the dashboard.

---

## ❓ Troubleshooting

### Connection Refused (`WinError 10061`)

* Confirm Ollama is running (`ollama serve`).
* Use `http://127.0.0.1:11434` instead of `localhost` in your `.env` to avoid Windows IPv6 routing issues.

### `PermissionError: [Errno 13] Permission denied`

* Close any open previews or instances of generated `.pdf`, `.xlsx`, or `.docx` files in external viewers (e.g., Microsoft Word, Adobe Acrobat) so Python can overwrite them.

### Docker Desktop says "Engine stopped"

* The first start can take a few minutes.
* Run `wsl --status`. If it says *"virtualization is not enabled"*, run `wsl.exe --install --no-distribution` in PowerShell **as Administrator**, then restart the computer.
* Check Task Manager → Performance → CPU → **Virtualization: Enabled**. If it is disabled, enable Intel VT-x / AMD SVM in the BIOS/UEFI settings.

### Integration tests are skipped: "PostgreSQL not reachable at localhost:5432"

* Start the database: `docker compose up -d` (from the repository root), then check `docker compose ps`.
* Port 5432 already in use: another PostgreSQL is running on your machine. Stop it, or change the port in `docker-compose.yml` and set `CASE_TEST_ADMIN_URL` accordingly.

### `'.venv' is not recognized as an internal or external command`

* In cmd.exe, use backslashes: `.venv\Scripts\python ...` (not `.venv/Scripts/python`).

### `Psycopg cannot use the 'ProactorEventLoop' to run in async mode`

* On Windows, psycopg's async mode needs a `SelectorEventLoop` instead of the default `ProactorEventLoop`. The tests already use one (`tests/audit/integration/conftest.py`). Starting the app itself with the database on Windows is set up when the modules are connected (Audit Phase 6). On Linux/Docker this does not apply.

```