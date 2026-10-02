"""
Ingress Input Normalization - Schemas

Converts channel-specific raw payloads (Gmail, Telegram, ...) into one
channel-agnostic StandardizedIngressRequest, so Intent & Planner never needs
to understand per-channel payload structures.

This module is intentionally independent of workspace configuration,
enabled-source checks, whitelisting, authentication, and authorization -
those are enforced by the Ingress Listener / security layer. workspace_id
below is populated by whichever component resolves it, not by the adapters
in this module - the exact ordering relative to normalization is not
assumed or hardcoded here.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class IngressAttachment(BaseModel):
    """Reference to an attachment. Actual file content is fetched later via
    the channel-specific API using attachment_id - never embedded here."""
    attachment_id: str
    filename: Optional[str] = None
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None


class StandardizedIngressRequest(BaseModel):
    """Channel-agnostic representation of an inbound message, regardless of
    whether it arrived via Gmail, Telegram, or a future channel."""
    source: str
    sender_id: str
    sender_name: Optional[str] = None
    subject: Optional[str] = None
    content: str
    attachments: List[IngressAttachment] = Field(default_factory=list)
    received_at: datetime
    source_message_id: str
    workspace_id: Optional[str] = None  # populated by whichever component resolves it - never set by adapters in this module
    metadata: Dict[str, Any] = Field(default_factory=dict)
