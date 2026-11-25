"""Runtime configuration — the same variable names the Node server used.

``.env`` is read from ``template-module/api/.env`` first, then from the parent
``template-module/server/.env`` so an existing local setup keeps working.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

API_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = API_DIR.parent.parent

# api/.env wins; the Node server's .env is the fallback so one file keeps both
# runtimes configured during the migration.
load_dotenv(API_DIR / ".env")
load_dotenv(API_DIR.parent / "server" / ".env", override=False)


def _str(name: str, default: str) -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = _str(name, "true" if default else "false").lower()
    return raw in {"1", "true", "yes", "on"}


def _csv(name: str, default: str) -> tuple[str, ...]:
    raw = _str(name, default)
    return tuple(part.strip() for part in raw.split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    port: int = field(default_factory=lambda: _int("PORT", 8000))
    database_url: str = field(
        default_factory=lambda: _str(
            "DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:5433/template_module"
        )
    )
    auto_migrate: bool = field(default_factory=lambda: _bool("AUTO_MIGRATE", True))
    cors_origins: tuple[str, ...] = field(
        default_factory=lambda: _csv(
            "CORS_ORIGINS", "http://localhost:4174,http://localhost:5174,http://localhost:5173"
        )
    )
    # The model. Kept as plain HTTP so the AI stack needs no extra SDK.
    ollama_base_url: str = field(
        default_factory=lambda: _str(
            "OLLAMA_BASE_URL", _str("OLLAMA_HOST", "http://127.0.0.1:11434")
        )
    )
    ollama_model: str = field(default_factory=lambda: _str("OLLAMA_MODEL", "qwen3.5:9b"))
    ollama_temperature: float = field(default_factory=lambda: _float("OLLAMA_TEMPERATURE", 0.2))
    ollama_timeout_ms: int = field(default_factory=lambda: _int("OLLAMA_TIMEOUT_MS", 120_000))
    max_steps: int = field(default_factory=lambda: _int("MAX_STEPS", 30))
    supported_roles: tuple[str, ...] = field(
        default_factory=lambda: _csv("SUPPORTED_ROLES", "officer,approver,coordinator")
    )
    supported_channels: tuple[str, ...] = field(
        default_factory=lambda: _csv("SUPPORTED_NOTIFICATION_CHANNELS", "email,telegram")
    )
    document_output_dir: Path = field(
        default_factory=lambda: Path(_str("DOCUMENT_OUTPUT_DIR", "../../output/documents"))
    )
    # Sandbox for the Document Reader node: files are only read under this root.
    reader_root: Path = field(default_factory=lambda: Path(_str("READER_ROOT", "../../samples")))
    allow_http_steps: bool = field(default_factory=lambda: _bool("ALLOW_HTTP_STEPS", False))
    http_timeout_ms: int = field(default_factory=lambda: _int("HTTP_STEP_TIMEOUT_MS", 15_000))

    def resolved_document_dir(self) -> Path:
        """Absolute output directory, created on demand."""
        root = self.document_output_dir
        if not root.is_absolute():
            # Relative paths resolve against the api directory, so documents and
            # reader files stay put regardless of the directory uvicorn starts in.
            root = API_DIR / root
        root.mkdir(parents=True, exist_ok=True)
        return root

    def resolved_reader_root(self) -> Path:
        root = self.reader_root
        if not root.is_absolute():
            root = API_DIR / root
        return root


settings = Settings()
