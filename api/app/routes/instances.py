"""Run routes: start, answer a gate, upload an intake file, open the document."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import FileResponse

from ..auth import CurrentOperator, require
from ..errors import unprocessable
from ..schemas import RespondRequest, StartInstanceRequest
from ..services import InstanceService

router = APIRouter(prefix="/api/instances", tags=["instances"])


def _service(request: Request) -> InstanceService:
    return request.app.state.instances_service


@router.get("")
def list_instances(
    request: Request,
    status: str | None = Query(default=None),
    template_id: str | None = Query(default=None),
    actor: CurrentOperator = Depends(require("workflow:read")),
) -> dict[str, Any]:
    items = _service(request).list({"status": status or "", "template_id": template_id or ""})
    return {"instances": items, "count": len(items)}


@router.post("", status_code=201)
def start_instance(
    request: Request,
    body: StartInstanceRequest,
    actor: CurrentOperator = Depends(require("workflow:start")),
) -> dict[str, Any]:
    return _service(request).start(body.templateId, actor.id, body.input or {})


@router.get("/{instance_id}")
def get_instance(
    request: Request,
    instance_id: str,
    actor: CurrentOperator = Depends(require("workflow:read")),
) -> dict[str, Any]:
    return _service(request).detail(instance_id)


@router.post("/{instance_id}/respond")
def respond_instance(
    request: Request,
    instance_id: str,
    body: RespondRequest,
    actor: CurrentOperator = Depends(require("workflow:respond")),
) -> dict[str, Any]:
    return _service(request).respond(instance_id, actor.id, body.approved, body.comments)


@router.post("/{instance_id}/intake")
async def upload_intake(
    request: Request,
    instance_id: str,
    file: UploadFile = File(...),
    actor: CurrentOperator = Depends(require("workflow:respond")),
) -> dict[str, Any]:
    data = await file.read()
    if not data:
        raise unprocessable("Attach the file in the 'file' form field.")
    return _service(request).submit_intake(
        instance_id,
        actor.id,
        file_name=file.filename or "upload",
        mime_type=file.content_type or "application/octet-stream",
        data=data,
    )


@router.post("/{instance_id}/cancel")
def cancel_instance(
    request: Request,
    instance_id: str,
    actor: CurrentOperator = Depends(require("workflow:cancel")),
) -> dict[str, Any]:
    return _service(request).cancel(instance_id, actor.id)


@router.get("/{instance_id}/documents/{step_id}")
def get_document(
    request: Request,
    instance_id: str,
    step_id: str,
    actor: CurrentOperator = Depends(require("workflow:read")),
) -> FileResponse:
    path, filename, mime = _service(request).document(instance_id, step_id)
    return FileResponse(
        path,
        media_type=mime,
        filename=filename,
        headers={"content-disposition": f'inline; filename="{filename}"'},
    )
