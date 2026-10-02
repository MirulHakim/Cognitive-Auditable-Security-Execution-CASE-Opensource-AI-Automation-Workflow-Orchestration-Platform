"""
CASE — Data Standardization & Normalization Layer
Service (Step 4)

Location: src/standardization/service.py

The only two functions other modules should call. They dispatch to the right
adapter (Step 3), then emit exactly one audit event (see §8 of the spec) on
success or failure.

No AI in this module. Everything here is deterministic Python.
"""

from __future__ import annotations

from typing import Any, Literal, Optional, Union

from pydantic import ValidationError

from .adapters import gmail, json_file, rest_api, telegram, web_form
from .adapters.base import FieldMapping, ResourceInfo, StandardizationError, build_record_set
from .audit_port import AuditLogger, NullAuditLogger
from .schemas import SCHEMA_VERSION, ResourceType, StandardMessage, StandardRecord, StandardRecordSet
from .utils import sha256_hex

# Adapter label recorded in audit details (§8). EMAIL_SERVICE reuses the Gmail
# parser, so it shares the Gmail adapter's label.
_ADAPTER_NAME = {
    "GMAIL": "gmail_adapter v1",
    "TELEGRAM": "telegram_adapter v1",
    "WEB_FORM": "web_form_adapter v1",
    "REST_API": "rest_api_adapter v1",
    "JSON_FILE": "json_file_adapter v1",
    "EMAIL_SERVICE": "gmail_adapter v1",
}

_ACTOR = "CASE System"
_ROLE = "SYSTEM"


def _audit_failure(audit: AuditLogger, *, workspace_id: str, execution_id: Optional[str],
                   target: str, stage: Literal["message", "resource"], exc: StandardizationError) -> None:
    audit.log_event(
        workspace_id=workspace_id, actor=_ACTOR, role=_ROLE,
        action="STANDARDIZATION_FAILED",
        target=target, source=exc.source, outcome="FAILURE",
        details={"stage": stage, "source": exc.source, "code": exc.code, "reason": str(exc)[:300]},
        execution_id=execution_id,
    )


def standardize_message(
    channel: Literal["GMAIL", "TELEGRAM", "WEB_FORM"],
    raw: dict,
    *,
    workspace_id: str,
    execution_id: Optional[str] = None,
    verified: bool = False,
    user_email: Optional[str] = None,
    user_name: Optional[str] = None,
    metadata: Optional[dict] = None,
    audit: Optional[AuditLogger] = None,
) -> StandardMessage:
    """Convert a raw inbound payload into a StandardMessage.

    `verified` is the ingress whitelist/DKIM/SPF result for GMAIL/TELEGRAM.
    `user_email`/`user_name` come from the validated JWT for WEB_FORM.
    """
    log = audit or NullAuditLogger()

    try:
        if channel == "GMAIL":
            msg = gmail.to_message(raw, workspace_id=workspace_id, verified=verified, metadata=metadata)
        elif channel == "TELEGRAM":
            msg = telegram.to_message(raw, workspace_id=workspace_id, verified=verified, metadata=metadata)
        elif channel == "WEB_FORM":
            if not user_email:
                raise StandardizationError(
                    "user_email is required to standardize a WEB_FORM message",
                    code="VALIDATION_ERROR", source="WEB_FORM",
                )
            msg = web_form.to_message(raw, workspace_id=workspace_id, user_email=user_email, user_name=user_name)
        else:
            raise StandardizationError(f"unsupported channel: {channel}", code="UNSUPPORTED_INPUT", source=str(channel))
    except StandardizationError as exc:
        _audit_failure(log, workspace_id=workspace_id, execution_id=execution_id,
                       target=execution_id or "unknown", stage="message", exc=exc)
        raise
    except ValidationError as exc:
        wrapped = StandardizationError(f"{channel} message failed validation: {exc.errors()[0]['msg']}", source=channel)
        _audit_failure(log, workspace_id=workspace_id, execution_id=execution_id,
                       target=execution_id or "unknown", stage="message", exc=wrapped)
        raise wrapped from exc

    log.log_event(
        workspace_id=workspace_id, actor=_ACTOR, role=_ROLE,
        action="MESSAGE_STANDARDIZED",
        target=execution_id or msg.source_message_id, source=channel, outcome="SUCCESS",
        details={
            "adapter": _ADAPTER_NAME[channel],
            "schema": f"StandardMessage {SCHEMA_VERSION}",
            "input_hash": msg.raw_hash,
            "output_hash": sha256_hex(msg.canonical_json()),
            "body_truncated": msg.body_truncated,
            "attachment_count": len(msg.attachments),
        },
        execution_id=execution_id,
    )
    return msg


def _standardize_email_service(raw: Any, *, resource: ResourceInfo, workspace_id: str,
                               execution_id: str) -> StandardRecordSet:
    """EMAIL_SERVICE: raw is a list of Gmail API messages. A message that
    fails to parse is skipped with a warning rather than failing the whole set."""
    if resource.resource_type is not ResourceType.EMAIL_SERVICE:
        raise StandardizationError(
            f"email_service standardization got a {resource.resource_type.value} resource", source="EMAIL_SERVICE",
        )
    if not isinstance(raw, list):
        raise StandardizationError("EMAIL_SERVICE data must be a list of Gmail messages", source="EMAIL_SERVICE")

    warnings: list[str] = []
    records: list[StandardRecord] = []
    for i, gmail_msg in enumerate(raw):
        try:
            records.append(gmail.to_record(gmail_msg))
        except (StandardizationError, ValidationError) as exc:
            reason = exc.errors()[0]["msg"] if isinstance(exc, ValidationError) else str(exc)
            warnings.append(f"message {i + 1} skipped ({reason})")

    return build_record_set(
        records=records, field_types=gmail.EMAIL_FIELD_TYPES, resource=resource,
        workspace_id=workspace_id, execution_id=execution_id, raw=raw, warnings=warnings,
    )


def standardize_resource(
    resource: ResourceInfo,
    raw: Any,
    *,
    workspace_id: str,
    execution_id: str,
    mapping: Optional[Union[dict, FieldMapping]] = None,
    audit: Optional[AuditLogger] = None,
) -> StandardRecordSet:
    """Convert data fetched from a resource into a StandardRecordSet.

    `raw` is: REST_API -> parsed JSON, JSON_FILE -> bytes/str/JSON,
    EMAIL_SERVICE -> list of Gmail API messages.
    `mapping` is required for REST_API, optional for JSON_FILE, unused for EMAIL_SERVICE.
    """
    log = audit or NullAuditLogger()
    source = resource.resource_type.value

    try:
        if resource.resource_type is ResourceType.REST_API:
            if mapping is None:
                raise StandardizationError(
                    f"a field mapping is required to standardize REST_API resource '{resource.resource_name}'",
                    code="MAPPING_INVALID", source="REST_API",
                )
            record_set = rest_api.to_record_set(
                raw, resource=resource, mapping=mapping, workspace_id=workspace_id, execution_id=execution_id,
            )
        elif resource.resource_type is ResourceType.JSON_FILE:
            record_set = json_file.to_record_set(
                raw, resource=resource, workspace_id=workspace_id, execution_id=execution_id, mapping=mapping,
            )
        elif resource.resource_type is ResourceType.EMAIL_SERVICE:
            record_set = _standardize_email_service(
                raw, resource=resource, workspace_id=workspace_id, execution_id=execution_id,
            )
        else:
            raise StandardizationError(f"unsupported resource type: {resource.resource_type}",
                                       code="UNSUPPORTED_INPUT", source=source)
    except StandardizationError as exc:
        _audit_failure(log, workspace_id=workspace_id, execution_id=execution_id,
                       target=execution_id or resource.resource_name, stage="resource", exc=exc)
        raise
    except ValidationError as exc:
        wrapped = StandardizationError(f"{source} data failed validation: {exc.errors()[0]['msg']}", source=source)
        _audit_failure(log, workspace_id=workspace_id, execution_id=execution_id,
                       target=execution_id or resource.resource_name, stage="resource", exc=wrapped)
        raise wrapped from exc

    log.log_event(
        workspace_id=workspace_id, actor=_ACTOR, role=_ROLE,
        action="DATA_STANDARDIZED",
        target=execution_id or resource.resource_name, source=source, outcome="SUCCESS",
        details={
            "adapter": _ADAPTER_NAME[source],
            "schema": f"StandardRecordSet {SCHEMA_VERSION}",
            "resource_id": resource.resource_id,
            "resource_type": source,
            "record_count": record_set.record_count,
            "truncated": record_set.truncated,
            "warning_count": len(record_set.warnings),
            "input_hash": record_set.raw_hash,
            "output_hash": sha256_hex(record_set.canonical_json()),
        },
        execution_id=execution_id,
    )
    return record_set


__all__ = ["standardize_message", "standardize_resource"]
