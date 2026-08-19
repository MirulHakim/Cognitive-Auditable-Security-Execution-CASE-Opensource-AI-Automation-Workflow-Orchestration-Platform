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
│   │   └── storage/                  # Database persistence
│   ├── tests/                      # Automated unit and integration test suite
│   ├── .venv/                      # Local Python virtual environment (git-ignored)
│   ├── requirements.txt
│   └── server.py                   # Primary FastAPI backend entrypoint
├── frontend/                       # React frontend (in progress)
├── .gitignore
├── docker-compose.yml
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

```