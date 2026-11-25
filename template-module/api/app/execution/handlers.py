"""One handler per node type.

Every handler answers with ``(status, result)`` where ``status`` is a
``step_runs.status`` value. Handlers never touch the database — the runner owns
persistence, so a handler can be tested on its own.

Steps that need a person (``approval``, ``intake``) do not run here at all: the
runner pauses on them and resumes once the human input arrives.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from .. import llm
from ..config import settings
from ..documents import render_document
from ..schemas import QUERYABLE_TABLES, QUERY_COLUMNS, WorkflowStep
from ..db import db


class StepFailed(Exception):
    """The step could not do its job; the run stops and the reason is recorded."""


@dataclass
class RunContext:
    instance_id: str
    case_input: dict[str, str]
    upstream: list[dict[str, Any]] = field(default_factory=list)
    performed_by: str | None = None

    def ai_outputs(self) -> list[dict[str, Any]]:
        return [
            {"stepId": run["stepId"], "stepName": run["stepName"], "output": run["result"].get("output")}
            for run in self.upstream
            if run.get("result", {}).get("output")
        ]

    def previous_text(self) -> str:
        chunks: list[str] = []
        for run in self.upstream:
            result = run.get("result", {})
            text = result.get("output") or result.get("text") or result.get("note")
            if text:
                chunks.append(f"[{run['stepName']}] {text}")
        return "\n".join(chunks)

    def source_text(self, source: str) -> str:
        parts: list[str] = []
        if source in {"case_input", "folder", "database", "previous_step", "none"}:
            parts.append(
                "Case data:\n"
                + "\n".join(f"- {key}: {value}" for key, value in self.case_input.items())
            )
        if source == "previous_step":
            previous = self.previous_text()
            if previous:
                parts.append(f"Previous steps:\n{previous}")
        if source in {"folder", "database"}:
            previous = self.previous_text()
            if previous:
                parts.append(f"Collected data:\n{previous}")
        return "\n\n".join(part for part in parts if part.strip())


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

_COMPARISON = re.compile(
    r"^\s*(?:input\.|payload\.)?(?P<key>[A-Za-z0-9_.\-]+)\s*"
    r"(?P<op>==|!=|>=|<=|>|<|=~|contains|isEmpty|isNotEmpty)\s*"
    r"(?P<value>'[^']*'|\"[^\"]*\"|-?\d+(?:\.\d+)?|true|false)?\s*$",
    re.IGNORECASE,
)


def _literal(raw: str | None) -> Any:
    if raw is None or raw == "":
        return True
    text = raw.strip()
    if (text.startswith("'") and text.endswith("'")) or (
        text.startswith('"') and text.endswith('"')
    ):
        return text[1:-1]
    lowered = text.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    try:
        return float(text) if "." in text else int(text)
    except ValueError:
        return text


def _lookup(container: dict[str, Any], key: str) -> Any:
    value: Any = container
    for part in key.split("."):
        if isinstance(value, dict):
            value = value.get(part)
        else:
            return None
    return value


def evaluate_condition(expression: str, case_input: dict[str, str]) -> tuple[bool, str]:
    match = _COMPARISON.match(expression or "")
    if not match:
        raise StepFailed(
            f"Could not understand the condition '{expression}'. Use a single comparison, "
            "e.g. amount > 400 or status == 'approved'."
        )
    key, op, raw = match.group("key"), match.group("op").lower(), match.group("value")
    actual = _lookup(case_input, key)
    expected = _literal(raw)

    if op in {"isempty", "isnotempty"}:
        empty = actual in (None, "")
        return (empty if op == "isempty" else not empty), key
    if actual is None:
        return (op == "!=") , key

    left: Any = actual
    if isinstance(actual, str):
        try:
            if not isinstance(expected, str):
                left = float(actual)
        except ValueError:
            pass

    try:
        if op in {"==", "="}:
            matched = str(left) == str(expected) if isinstance(expected, str) else left == expected
        elif op == "!=":
            matched = str(left) != str(expected) if isinstance(expected, str) else left != expected
        elif op == "contains":
            matched = str(expected) in str(actual)
        elif op == "=~":
            matched = re.search(str(expected), str(actual)) is not None
        else:
            matched = {
                ">": left > expected,
                "<": left < expected,
                ">=": left >= expected,
                "<=": left <= expected,
            }[op]
    except TypeError as error:
        raise StepFailed(f"Condition '{expression}' compares values of different types.") from error
    return bool(matched), key


def _safe_child(root: Path, relative: str) -> Path | None:
    candidate = (root / relative).resolve() if not Path(relative).is_absolute() else Path(relative).resolve()
    return candidate if candidate.is_relative_to(root.resolve()) else None


def _read_any(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        from ..intake import read_pdf_text

        return read_pdf_text(path.read_bytes())
    if suffix in {".xlsx", ".xlsm"}:
        from openpyxl import load_workbook  # type: ignore[import-not-found]

        workbook = load_workbook(path, read_only=True, data_only=True)
        lines: list[str] = []
        for sheet in workbook.worksheets:
            lines.append(f"# {sheet.title}")
            for row in sheet.iter_rows(values_only=True):
                cells = [str(cell) for cell in row if cell is not None]
                if cells:
                    lines.append(" | ".join(cells))
        return "\n".join(lines)
    if suffix in {".csv", ".txt", ".md", ".json", ".html"}:
        return path.read_text(encoding="utf-8", errors="replace")
    raise StepFailed(f"'{path.name}' is not a readable file type.")


# --------------------------------------------------------------------------
# Node handlers
# --------------------------------------------------------------------------


def _trigger(step: dict[str, Any], config: dict[str, Any], kind: str) -> tuple[str, dict[str, Any]]:
    detail = {
        "trigger": kind,
        "payload": dict(config),
        "receivedAt": None,
    }
    return "COMPLETED", {"note": f"Triggered by {kind.replace('_', ' ')}.", **detail}


def _review(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    return "COMPLETED", {"note": "Review step executed.", "assignedRole": config.get("assignedRole") or None}


def _validation(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    required = [str(item) for item in (config.get("requiredFields") or []) if str(item).strip()]
    if not required:
        return "COMPLETED", {"note": "Validation step executed: no fields were required."}
    missing = [key for key in required if not str(ctx.case_input.get(key, "")).strip()]
    if missing:
        raise StepFailed(f"Missing required case field(s): {', '.join(missing)}.")
    return "COMPLETED", {
        "note": f"Validation step executed: required fields present ({', '.join(required)}).",
        "checked": required,
    }


def _llm_agent(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    instruction = str(config.get("instruction") or "").strip()
    source = str(config.get("dataSource") or "case_input")
    prompt = (
        "You are the reasoning node of an audited workflow. Answer in plain text.\n\n"
        f"Instruction: {instruction}\n\n{ctx.source_text(source)}\n\nAnswer:"
    )
    try:
        output = llm.generate_text(
            prompt,
            model=config.get("model") or None,
            temperature=float(config.get("temperature") or settings.ollama_temperature),
        )
    except llm.LlmUnavailable as error:
        raise StepFailed(str(error)) from error
    return "COMPLETED", {
        "note": "LLM reasoning completed.",
        "model": config.get("model") or settings.ollama_model,
        "dataSource": source,
        "instruction": instruction,
        "output": output,
        "contentSource": "ai",
    }


def _agent_react(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    instruction = str(config.get("instruction") or "").strip()
    tools = [str(tool) for tool in (config.get("tools") or [])]
    iterations = max(1, min(int(config.get("maxIterations") or 3), 6))
    transcript: list[str] = []
    answer = ""
    for index in range(iterations):
        prompt = (
            "You are a ReAct agent inside an audited workflow.\n"
            f"Tools available: {', '.join(tools) or 'none'}.\n"
            f"Instruction: {instruction}\n\n{ctx.source_text('case_input')}\n\n"
            + ("Progress so far:\n" + "\n".join(transcript) + "\n" if transcript else "")
            + f"Step {index + 1}/{iterations}. Give the best answer you can now, or say DONE."
        )
        try:
            answer = llm.generate_text(prompt, model=config.get("model") or None)
        except llm.LlmUnavailable as error:
            raise StepFailed(str(error)) from error
        transcript.append(f"Iteration {index + 1}: {answer[:400]}")
        if "DONE" in answer.upper():
            break
    return "COMPLETED", {
        "note": "ReAct agent finished.",
        "iterations": len(transcript),
        "tools": tools,
        "output": answer,
        "contentSource": "ai",
    }


def _logic(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    matched, key = evaluate_condition(str(config.get("expression") or ""), ctx.case_input)
    branches = [str(item) for item in (config.get("branches") or ["True", "False"])]
    branch = branches[0] if matched else (branches[1] if len(branches) > 1 else "False")
    return "COMPLETED", {
        "note": f"Condition evaluated to {matched}.",
        "expression": config.get("expression"),
        "subject": key,
        "matched": matched,
        "branch": branch,
    }


def _http(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    method = str(config.get("method") or "POST").upper()
    endpoint = str(config.get("endpoint") or "")
    parsed = urlparse(endpoint)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise StepFailed(f"'{endpoint}' is not a valid http(s) endpoint.")

    payload = {key: value for key, value in ctx.case_input.items()}
    for mapping in config.get("mapping") or []:
        if isinstance(mapping, dict) and mapping.get("source") and mapping.get("target"):
            source = str(mapping["source"]).split(".")[-1]
            if source in ctx.case_input:
                payload[str(mapping["target"])] = ctx.case_input[source]

    if not settings.allow_http_steps:
        return "SIMULATED", {
            "note": "HTTP steps are disabled (ALLOW_HTTP_STEPS=false); the call was simulated.",
            "method": method,
            "endpoint": endpoint,
            "payload": payload,
        }

    try:
        response = httpx.request(
            method,
            endpoint,
            json=payload if method != "GET" else None,
            params=payload if method == "GET" else None,
            timeout=settings.http_timeout_ms / 1000,
        )
    except Exception as error:
        raise StepFailed(f"The endpoint could not be reached: {error}") from error

    return "COMPLETED", {
        "note": f"{method} {endpoint} answered {response.status_code}.",
        "method": method,
        "endpoint": endpoint,
        "statusCode": response.status_code,
        "body": response.text[:2000],
    }


def _document_reader(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    root = settings.resolved_reader_root()
    folder = str(config.get("folderPath") or "").strip()
    # An empty folder means the granted root itself; anything else is a sub-folder.
    folder_path = root if folder in ("", ".", "./") else _safe_child(root, folder)
    folder = folder or str(root)
    if folder_path is None or not folder_path.is_dir():
        raise StepFailed(
            f"The folder '{folder}' does not exist under {root}. Put the files there and try again."
        )

    granted = [str(name) for name in (config.get("grantedFiles") or []) if str(name).strip()]
    if not granted:
        granted = [entry.name for entry in sorted(folder_path.glob("*")) if entry.is_file()][:10]

    files: list[dict[str, Any]] = []
    texts: list[str] = []
    for name in granted:
        path = _safe_child(folder_path, name)
        if path is None or not path.is_file():
            files.append({"name": name, "status": "missing"})
            continue
        try:
            text = _read_any(path)
        except StepFailed as error:
            files.append({"name": name, "status": "unreadable", "reason": str(error)})
            continue
        files.append({"name": name, "status": "read", "bytes": path.stat().st_size})
        texts.append(f"# {name}\n{text.strip()}")

    if not texts:
        raise StepFailed("None of the granted files could be read.")

    return "COMPLETED", {
        "note": f"Read {len(texts)} file(s) from {folder}.",
        "folder": folder,
        "files": files,
        "text": "\n\n".join(texts)[:20_000],
    }


def _db_query(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    table = str(config.get("table") or "")
    if table not in QUERYABLE_TABLES:
        raise StepFailed(f"'{table}' is not a queryable table.")
    column = str(config.get("filterColumn") or "").strip()
    if column and not re.fullmatch(r"[a-z_][a-z0-9_]*", column):
        raise StepFailed("The filter column must be a plain column name.")
    limit = max(1, min(int(config.get("limit") or 10), 50))
    value = str(config.get("filterValue") or "")

    available = {row["column_name"] for row in db.query(
        """SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s""",
        [table],
    )}
    if column and column not in available:
        raise StepFailed(f"'{column}' is not a column of {table}.")

    projection = QUERY_COLUMNS.get(table, "*")
    if column and value:
        rows = db.query(
            f'SELECT {projection} FROM {table} WHERE cast("{column}" as text) ILIKE %s LIMIT %s',
            [f"%{value}%", limit],
        )
    else:
        rows = db.query(f"SELECT {projection} FROM {table} LIMIT %s", [limit])

    serialised = json.loads(json.dumps(rows, default=str))
    return "COMPLETED", {
        "note": f"Read {len(rows)} row(s) from {table}.",
        "table": table,
        "filter": {"column": column or None, "value": value or None},
        "columns": [str(column_name) for column_name in (rows[0].keys() if rows else [])],
        "rowCount": len(rows),
        "rows": serialised[:20],
    }


def _document(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    title = str(config.get("title") or "Generated report")
    result = render_document(
        instance_id=ctx.instance_id,
        step_id=step["id"],
        title=title,
        case_input=ctx.case_input,
        ai_outputs=ctx.ai_outputs(),
        template_format=str(config.get("templateFormat") or "HTML"),
        include_case_input=bool(config.get("includeCaseInput", True)),
        include_ai_output=bool(config.get("includeAIOutput", True)),
    )
    result["note"] = f"Document rendered as {result['format'].upper()}."
    return "COMPLETED", result


def _notification(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    channel = str(config.get("channel") or "email")
    message = str(config.get("message") or "").strip() or "The case has been processed."
    return "SIMULATED", {
        "note": f"Notification queued for {channel}.",
        "channel": channel,
        "recipient": config.get("recipient") or None,
        "message": message,
        "delivery": "simulated",
    }


def _gmail(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    body = str(config.get("body") or "").strip() or "The case has been processed."
    return "SIMULATED", {
        "note": "Email send simulated (no mailbox connected in this deployment).",
        "service": "gmail",
        "to": config.get("emailRecipient") or None,
        "subject": config.get("subject") or "Case outcome",
        "body": body,
        "delivery": "simulated",
    }


def _telegram(step: dict[str, Any], config: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    return "SIMULATED", {
        "note": "Telegram send simulated (no bot token in this deployment).",
        "service": "telegram",
        "chatId": config.get("telegramChatId") or None,
        "message": str(config.get("telegramMessage") or "The case has been processed."),
        "delivery": "simulated",
    }


HANDLERS = {
    "review": _review,
    "validation": _validation,
    "llm_agent": _llm_agent,
    "agent_react": _agent_react,
    "logic_condition": _logic,
    "http_request": _http,
    "document_reader": _document_reader,
    "db_query": _db_query,
    "document": _document,
    "notification": _notification,
    "gmail": _gmail,
    "telegram": _telegram,
}

TRIGGERS = ("trigger_webhook", "trigger_cron", "trigger_email", "trigger_telegram")
GATES = ("approval", "intake")


def handle_step(step: dict[str, Any], ctx: RunContext) -> tuple[str, dict[str, Any]]:
    step_type = str(step.get("type"))
    model = WorkflowStep.model_validate(step)
    config = model.effective_config()

    if step_type in TRIGGERS:
        return _trigger(step, config, step_type)
    handler = HANDLERS.get(step_type)
    if handler is None:
        raise StepFailed(f"'{step_type}' cannot be executed automatically.")
    return handler(step, config, ctx)
