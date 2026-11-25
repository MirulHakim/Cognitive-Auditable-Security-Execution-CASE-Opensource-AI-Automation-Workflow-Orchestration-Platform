"""The model, over Ollama's HTTP API.

Kept as plain HTTP on purpose: one dependency (httpx) instead of an SDK, and the
same endpoint the Node server used (``/api/generate``), so both runtimes can use
the identical local model.
"""

from __future__ import annotations

import json
from typing import Any

import httpx

from .config import settings


class LlmUnavailable(Exception):
    """The model is not reachable or answered with garbage."""


def _post(prompt: str, *, model: str | None, temperature: float | None, json_mode: bool) -> str:
    payload: dict[str, Any] = {
        "model": model or settings.ollama_model,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": settings.ollama_temperature if temperature is None else temperature
        },
    }
    if json_mode:
        payload["format"] = "json"

    try:
        response = httpx.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/generate",
            json=payload,
            timeout=settings.ollama_timeout_ms / 1000,
        )
    except Exception as error:  # connection refused, DNS, timeout …
        raise LlmUnavailable(f"The model is unreachable at {settings.ollama_base_url}.") from error

    if response.status_code >= 400:
        raise LlmUnavailable(f"The model answered {response.status_code}.")

    body = response.json() if response.content else {}
    text = str(body.get("response", "")).strip()
    if not text:
        raise LlmUnavailable("The model returned an empty answer.")
    return text


def generate_text(prompt: str, *, model: str | None = None, temperature: float | None = None) -> str:
    return _post(prompt, model=model, temperature=temperature, json_mode=False)


def generate_json(prompt: str, *, model: str | None = None, temperature: float | None = None) -> Any:
    raw = _post(prompt, model=model, temperature=temperature, json_mode=True)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        # Models sometimes wrap JSON in prose or fences; try the outermost braces.
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            try:
                return json.loads(raw[start : end + 1])
            except json.JSONDecodeError:
                pass
        raise LlmUnavailable("The model did not answer with JSON.") from error


def health() -> dict[str, Any]:
    try:
        response = httpx.get(
            f"{settings.ollama_base_url.rstrip('/')}/api/tags",
            timeout=min(5.0, settings.ollama_timeout_ms / 1000),
        )
        models = [entry.get("name") for entry in response.json().get("models", [])]
        return {"reachable": response.status_code < 400, "baseUrl": settings.ollama_base_url, "models": models}
    except Exception:
        return {"reachable": False, "baseUrl": settings.ollama_base_url, "models": []}
