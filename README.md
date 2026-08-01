# 🚀 CASE — Cognitive Auditable Security Execution Platform

> An open-source, Human-in-the-Loop (HITL) AI automation and workflow orchestration platform built with **FastAPI**, **LangGraph**, **Ollama (`qwen3.5:9b`)**, and **Tailscale**.

---

## 🏗️ Architecture Overview

```text
[ Whitelisted Ingress ] ──▶ [ 1. Ingress Listener ]
 (Gmail / Telegram)             │ Filter sender against whitelist
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

## 📁 Repository Structure & Directory Guide

This platform follows a modular architecture separating orchestration logic, external integrations, API endpoints, and frontend components.

```text
.
├── __pycache__/                    # Python bytecode cache (ignored by Git)
├── config/                         # App settings, whitelists, and prompt templates
├── dashboard\src/                  # React Approval Dashboard frontend
│   ├── components/                 # UI elements (approval cards, PDF/spreadsheet viewers)
│   ├── pages/                      # Dashboard views & job queue pages
│   └── services/                   # API client for backend communications
├── src/                            # Core application source code
│   ├── api/                        # FastAPI REST API endpoints & webhooks
│   ├── document_generators/        # PDF, Excel, Word & text builder modules
│   ├── integrations/               # Gmail, Telegram, and whitelisted data connectors
│   ├── llm/                        # Ollama connection client & prompt handlers
│   ├── storage/                    # State persistence DB & generated document store
│   └── workflow/                   # LangGraph state machine & approval interrupt nodes
├── tests/                          # Unit and integration test suite
├── venv/                           # Local Python virtual environment (ignored by Git)
├── .gitignore                      # Git ignore rules
├── docker-compose.yml              # Container orchestration setup
├── LICENSE                         # Project license
├── README.md                       # Developer setup & documentation guide
└── server.py                       # Main FastAPI backend entrypoint