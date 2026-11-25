"""The node catalogue the editor builds its canvas and settings panel from."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from ..auth import current_operator
from fastapi import Depends

from ..auth import CurrentOperator
from ..config import settings
from ..llm import health as llm_health
from ..schemas import CATEGORY_LABELS, NODE_CATALOGUE

router = APIRouter(prefix="/api", tags=["nodes"])


@router.get("/nodes")
def list_nodes(
    actor: CurrentOperator = Depends(current_operator),
) -> dict[str, Any]:
    """Every node type, its category and the fields its settings panel shows."""
    return {
        "nodes": [
            {
                "type": node.type,
                "category": node.category,
                "title": node.title,
                "description": node.description,
                "badge": node.badge,
                "isTerminal": node.is_terminal,
                "acceptsInput": node.accepts_input,
                "defaults": node.defaults,
                "fields": [field.model_dump(exclude_none=True) for field in node.fields],
            }
            for node in NODE_CATALOGUE
        ],
        "categories": [
            {"id": key, "label": label} for key, label in CATEGORY_LABELS.items()
        ],
        "limits": {
            "maxSteps": settings.max_steps,
            "supportedRoles": list(settings.supported_roles),
            "supportedChannels": list(settings.supported_channels),
        },
    }


@router.get("/nodes/health")
def node_health() -> dict[str, Any]:
    """Model reachability, shown in the editor so a missing model is obvious."""
    return {"model": settings.ollama_model, **llm_health()}
