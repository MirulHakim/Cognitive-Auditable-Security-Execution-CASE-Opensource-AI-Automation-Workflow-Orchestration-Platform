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
