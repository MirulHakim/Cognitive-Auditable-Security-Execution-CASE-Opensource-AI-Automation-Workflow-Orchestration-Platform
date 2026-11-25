"""Template lifecycle routes (create, review, version, activate)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request

from ..auth import CurrentOperator, require
from ..deps import audit, template_service
from ..schemas import CreateTemplateRequest, GenerateTemplateRequest, UpdateTemplateRequest
from ..services import TemplateService

router = APIRouter(prefix="/api/templates", tags=["templates"])


def _service(request: Request) -> TemplateService:
    return request.app.state.templates_service


def _record(actor: CurrentOperator, action: str, template: dict[str, Any], details: dict[str, Any]) -> None:
    audit.record(
        actor_id=actor.id,
        actor_role=actor.role,
        action=action,
        target_type="template",
        target_id=str(template.get("templateId", "")),
        details=details,
    )


@router.get("")
def list_templates(
    request: Request,
    origin: str | None = Query(default=None),
    status: str | None = Query(default=None),
    is_active: str | None = Query(default=None),
    actor: CurrentOperator = Depends(require("template:read")),
) -> dict[str, Any]:
    items = _service(request).list(
        {"origin": origin or "", "status": status or "", "is_active": is_active or ""}
    )
    return {"templates": items, "count": len(items)}


@router.post("/generate")
def generate_template(
    request: Request,
    body: GenerateTemplateRequest,
    actor: CurrentOperator = Depends(require("template:generate")),
) -> dict[str, Any]:
    result = _service(request).generate(body.prompt, actor.id)
    if "template" in result:
        _record(actor, "TEMPLATE_DRAFTED", result["template"], {"prompt": body.prompt[:500], "origin": "AI_DRAFTED"})
    return result


@router.post("", status_code=201)
def create_template(
    request: Request,
    body: CreateTemplateRequest,
    actor: CurrentOperator = Depends(require("template:create")),
) -> dict[str, Any]:
    template = _service(request).create(body.name, body.steps, actor.id)
    _record(actor, "TEMPLATE_CREATED", template, {"name": template["name"], "steps": len(template["steps"])})
    return {"template": template}


@router.get("/{template_id}")
def get_template(
    request: Request,
    template_id: str,
    actor: CurrentOperator = Depends(require("template:read")),
) -> dict[str, Any]:
    return {"template": _service(request).get(template_id)}


@router.put("/{template_id}")
def update_template(
    request: Request,
    template_id: str,
    body: UpdateTemplateRequest,
    actor: CurrentOperator = Depends(require("template:edit")),
) -> dict[str, Any]:
    template = _service(request).update(template_id, body)
    _record(actor, "TEMPLATE_EDITED", template, {"name": template["name"], "steps": len(template["steps"])})
    return {"template": template}


@router.delete("/{template_id}")
def deactivate_template(
    request: Request,
    template_id: str,
    actor: CurrentOperator = Depends(require("template:deactivate")),
) -> dict[str, Any]:
    template = _service(request).deactivate(template_id)
    _record(actor, "TEMPLATE_DEACTIVATED", template, {"name": template["name"]})
    return {"template": template}


@router.post("/{template_id}/approve")
def approve_template(
    request: Request,
    template_id: str,
    body: dict[str, Any] | None = None,
    actor: CurrentOperator = Depends(require("template:approve")),
) -> dict[str, Any]:
    comments = (body or {}).get("comments")
    template = _service(request).approve(template_id, actor.id, comments)
    _record(actor, "TEMPLATE_APPROVED", template, {"name": template["name"], "comments": comments})
    return {"template": template}


@router.post("/{template_id}/reject")
def reject_template(
    request: Request,
    template_id: str,
    body: dict[str, Any],
    actor: CurrentOperator = Depends(require("template:approve")),
) -> dict[str, Any]:
    comments = str(body.get("comments") or "")
    template = _service(request).reject(template_id, actor.id, comments)
    _record(actor, "TEMPLATE_REJECTED", template, {"name": template["name"], "comments": comments})
    return {"template": template}


@router.post("/{template_id}/activate")
def activate_template(
    request: Request,
    template_id: str,
    actor: CurrentOperator = Depends(require("template:deactivate")),
) -> dict[str, Any]:
    template = _service(request).activate(template_id)
    _record(actor, "TEMPLATE_ACTIVATED", template, {"name": template["name"]})
    return {"template": template}
