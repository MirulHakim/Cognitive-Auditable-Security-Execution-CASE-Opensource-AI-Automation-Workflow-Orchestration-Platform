"""Structured API errors.

Every failure answers with the envelope the dashboard already understands:

    {"error": {"code": "...", "message": "...", "details": {...}}}
"""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details: dict[str, Any] = details or {}


def bad_request(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(400, "BAD_REQUEST", message, details)


def unauthorized(message: str = "Sign in to continue.") -> ApiError:
    return ApiError(401, "UNAUTHORIZED", message)


def forbidden(permission: str) -> ApiError:
    return ApiError(
        403,
        "FORBIDDEN",
        f"Your role cannot perform this action ({permission}).",
        {"requiredPermission": permission},
    )


def not_found(message: str) -> ApiError:
    return ApiError(404, "NOT_FOUND", message)


def conflict(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(409, "CONFLICT", message, details)


def unprocessable(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(422, "VALIDATION_FAILED", message, details)


def upstream(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(502, "UPSTREAM_FAILED", message, details)


def unavailable(message: str, details: dict[str, Any] | None = None) -> ApiError:
    return ApiError(503, "SERVICE_UNAVAILABLE", message, details)


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details or {}}}


async def api_error_handler(_request: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status,
        content=error_body(exc.code, exc.message, exc.details),
    )


async def validation_error_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Mirror the Node server's structural-error list."""
    structural = [
        {
            "path": ".".join(str(part) for part in error.get("loc", ()) if part != "body") or "(root)",
            "message": error.get("msg", "Invalid value."),
            "code": str(error.get("type", "invalid")),
        }
        for error in exc.errors()
    ]
    return JSONResponse(
        status_code=422,
        content=error_body(
            "VALIDATION_FAILED",
            "Request failed validation.",
            {"structural": structural, "businessRules": []},
        ),
    )
