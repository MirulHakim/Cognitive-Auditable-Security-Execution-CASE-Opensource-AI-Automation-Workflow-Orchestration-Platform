"""FastAPI application — the Python runtime for the CASE workflow engine.

    uvicorn app.main:app --host 127.0.0.1 --port 8000

The routes mirror ``template-module/server`` exactly (same paths, same JSON
shapes), so the dashboard only needs its proxy pointed here.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import __version__
from .auth import current_operator  # noqa: F401  (imported for route wiring parity)
from .config import settings
from .db import db
from .deps import operators, template_service
from .errors import ApiError, api_error_handler, validation_error_handler
from .migrate import apply_migrations
from .routes import audit as audit_routes
from .routes import instances as instance_routes
from .routes import nodes as node_routes
from .routes import operators as operator_routes
from .routes import templates as template_routes
from .schemas import NODE_CATALOGUE


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    db.open()
    if settings.auto_migrate:
        applied = apply_migrations(db)
        if applied:
            print(f"[migrations] applied: {', '.join(applied)}", flush=True)
    app.state.operators = operators
    app.state.templates_service = template_service
    from .deps import instance_service

    app.state.instances_service = instance_service
    print(f"Template API (FastAPI) listening on http://127.0.0.1:{settings.port}", flush=True)
    print(
        f"  Model: {settings.ollama_base_url} ({settings.ollama_model}); "
        f"{len(NODE_CATALOGUE)} node types",
        flush=True,
    )
    try:
        yield
    finally:
        db.close()


app = FastAPI(
    title="CASE workflow API",
    description="Cognitive-Auditable Security Execution — workflow engine and audit trail.",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]

app.include_router(template_routes.router)
app.include_router(instance_routes.router)
app.include_router(operator_routes.router)
app.include_router(audit_routes.router)
app.include_router(node_routes.router)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "runtime": "fastapi",
        "version": __version__,
        "nodes": len(NODE_CATALOGUE),
    }


@app.exception_handler(ApiError)
async def _api_error(request: Request, exc: ApiError) -> JSONResponse:  # pragma: no cover
    return await api_error_handler(request, exc)
