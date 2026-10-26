"""
CASE — Audit & Transparency Layer
AuditService: the only way events are recorded (AUDIT_MODULE_PLAN.md §8.1)

Location: src/audit/service.py

`log_event` satisfies audit.port.AuditLogger, so any module
that takes an AuditLogger can be given an AuditService. It returns None;
`append_event` does the same work and returns the stored AuditEvent.

Every check runs before the repository is called, so a rejected event never
takes the chain lock or uses up a seq number.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Callable, Optional
from uuid import UUID, uuid4

from pydantic import ValidationError

from .canonical import GENESIS_HASH, CanonicalizationError, canonical_json, compute_event_hash, normalize
from .catalogue import EVENT_TYPES, REQUIRED_DETAILS, AuditAction, find_forbidden_keys
from .errors import AuditValidationError
from .repository import AuditRepository, ChainHead
from .schemas import (ActorRoleEnum, ActorTypeEnum, AuditEvent, AuditSourceEnum, ChainVerificationResult,
                      OutcomeEnum)
from . import verifier

if TYPE_CHECKING:
    # psycopg is added in Audit Phase 3; only needed for the type hint.
    from psycopg import AsyncConnection

MAX_DETAILS_BYTES = 8 * 1024

# Ids and targets are references, not free text. Restricting the characters
# also keeps email addresses (rule 5: store a hash instead) out of these fields.
_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
_TARGET_TYPE_RE = re.compile(r"[a-z][a-z_]{0,31}")
_TARGET_ID_RE = re.compile(r"[A-Za-z0-9_/][A-Za-z0-9._:/-]{0,255}")
_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")

#return current UTC datetime
def _utc_now() -> datetime:
    return datetime.now(timezone.utc)

#validate enum values (action, outcome, role, source) and raise AuditValidationError if invalid
def _enum_value(enum_cls: type, value: Any, code: str, label: str):
    try:
        return enum_cls(value)
    except ValueError:
        raise AuditValidationError(f"unknown {label}", code=code) from None

#map the role to actor type. SYSTEM and AI roles are mapped to SYSTEM and AI actor types, respectively. All other roles are mapped to USER actor type.
def _actor_type(role: ActorRoleEnum) -> ActorTypeEnum:
    if role is ActorRoleEnum.SYSTEM:
        return ActorTypeEnum.SYSTEM
    if role is ActorRoleEnum.AI:
        return ActorTypeEnum.AI
    return ActorTypeEnum.USER

#reject if the actor is not string, empty/whitespace only, too long, contains control characters or '@'.
def _check_actor(actor: Any) -> None:
    if not isinstance(actor, str) or not actor.strip() or len(actor) > 128 \
            or _CONTROL_RE.search(actor) or "@" in actor:
        raise AuditValidationError("actor must be 1-128 characters, with no control characters or '@'",
                                   code="INVALID_ACTOR")

#lets say input target = "execution:abc123", output will be  target_type = "execution" target_id = "abc123"
def _split_target(target: Any) -> tuple[str, str]:
    """'execution:abc' -> ('execution', 'abc'); split on the first ':' only."""
    if not isinstance(target, str) or ":" not in target:
        raise AuditValidationError("target must look like '<type>:<id>', e.g. 'execution:<id>'",
                                   code="INVALID_TARGET")
    target_type, target_id = target.split(":", 1)
    if not _TARGET_TYPE_RE.fullmatch(target_type):
        raise AuditValidationError("target type must be lowercase letters and '_' (e.g. 'execution')",
                                   code="INVALID_TARGET")
    if not _TARGET_ID_RE.fullmatch(target_id):
        raise AuditValidationError("target id is empty, too long or has characters that are not allowed",
                                   code="INVALID_TARGET")
    return target_type, target_id


class AuditService:
    """Validates events and appends them to the workspace hash chain.

    `clock` and `new_id` are injectable so tests get fixed timestamps and
    event ids, and therefore reproducible hashes.
    """

    def __init__(self, repository: AuditRepository, *, clock: Callable[[], datetime] = _utc_now,
                 new_id: Callable[[], UUID] = uuid4) -> None:
        self._repository = repository #storage used to store the events in a workspace hash chain. It is an instance of AuditRepository, which is a protocol that defines the methods for appending events, getting the head of the chain, and listing events.
        self._clock = clock #to get tiestamp
        self._new_id = new_id #to produce UUID

    async def log_event(self, *, workspace_id: str, actor: str, role: str, action: str,
                        target: str, source: str, outcome: str, details: dict[str, Any],
                        execution_id: str | None = None,
                        session: AsyncConnection | None = None) -> None:
        await self.append_event(workspace_id=workspace_id, actor=actor, role=role, action=action,
                                target=target, source=source, outcome=outcome, details=details,
                                execution_id=execution_id, session=session)

    async def append_event(self, *, workspace_id: str, actor: str, role: str, action: str,
                           target: str, source: str, outcome: str, details: dict[str, Any],
                           execution_id: str | None = None,
                           session: AsyncConnection | None = None) -> AuditEvent:
        # 1-6: identity and classification fields.
        audit_action = _enum_value(AuditAction, action, "UNKNOWN_ACTION", "action")
        audit_outcome = _enum_value(OutcomeEnum, outcome, "INVALID_OUTCOME", "outcome")
        actor_role = _enum_value(ActorRoleEnum, role, "INVALID_ROLE", "role")
        _check_actor(actor)
        #validate target and split into type and id. The target must be a string in the format "<type>:<id>", where <type> is lowercase letters and underscores, and <id> is alphanumeric characters, underscores, slashes, colons, or hyphens. If the target is invalid, an AuditValidationError is raised.
        target_type, target_id = _split_target(target)
        workspace_uuid = self._workspace_uuid(workspace_id)
        audit_source = _enum_value(AuditSourceEnum, source, "INVALID_SOURCE", "source")
        if execution_id is not None and (not isinstance(execution_id, str) or not _ID_RE.fullmatch(execution_id)):
            raise AuditValidationError("execution_id is empty, too long or has characters that are not allowed",
                                       code="INVALID_EXECUTION_ID")

        # 7-10: details. Privacy checks come before the required-keys check, so a
        # forbidden key is reported even when a required key is also missing.
        stored_details = self._check_details(audit_action, details)

        def build(head: Optional[ChainHead]) -> AuditEvent:
            # Runs under the chain lock, so event_timestamp never goes backwards as seq goes up.
            values: dict[str, Any] = {
                "event_id": self._new_id(),
                "workspace_id": workspace_uuid,
                "seq": 1 if head is None else head.last_seq + 1,
                "event_timestamp": self._now(),
                "execution_id": execution_id,
                "event_type": EVENT_TYPES[audit_action],
                "action": audit_action.value,
                "actor_type": _actor_type(actor_role),
                "actor_id": actor,
                "actor_role": actor_role,
                "target_type": target_type,
                "target_id": target_id,
                "source": audit_source,
                "outcome": audit_outcome,
                "details": stored_details,
                "previous_hash": GENESIS_HASH if head is None else head.last_hash,
            }
            return AuditEvent(**values, current_hash=compute_event_hash(values))
        #hantar to repository.py to append the event to the workspace hash chain. 
        #The repository will handle locking and ensure that the event is appended correctly, returning a deep copy of the stored AuditEvent.
        return await self._repository.append(workspace_uuid, build, session=session)

    async def verify_chain(self, workspace_id: str, *, actor: str, role: str,
                           from_seq: int | None = None, to_seq: int | None = None,
                           source: str = "WEB_APP") -> ChainVerificationResult:
        """Run verifier.verify_chain (§8.3) and log the result as
        AUDIT_INTEGRITY_VERIFIED or AUDIT_INTEGRITY_FAILED (§5.5).

        The result describes the chain as it was before this log event was
        added. If the log write fails the error is raised; the read API
        (Phase 5) decides how to report it.
        """
        # TODO(Audit Phase 3): also store the result in hash_chain_verifications.
        actor_role = _enum_value(ActorRoleEnum, role, "INVALID_ROLE", "role")
        _check_actor(actor)
        workspace_uuid = self._workspace_uuid(workspace_id)
        _enum_value(AuditSourceEnum, source, "INVALID_SOURCE", "source")

        result = await verifier.verify_chain(self._repository, workspace_uuid, from_seq=from_seq, to_seq=to_seq,
                                             verified_by=actor, verified_role=actor_role.value,
                                             clock=self._now, new_id=self._new_id)

        details: dict[str, Any] = {
            "verification_id": str(result.verification_id),
            "events_checked": result.events_checked,
            "head_seq": result.head_seq,
            "head_hash": result.head_hash,
        }
        if result.is_verified:
            action, outcome = AuditAction.AUDIT_INTEGRITY_VERIFIED, OutcomeEnum.SUCCESS
        else:
            action, outcome = AuditAction.AUDIT_INTEGRITY_FAILED, OutcomeEnum.FAILURE
            details.update(broken_at_seq=result.broken_at_seq, reason=result.reason.value)
        await self.log_event(workspace_id=str(workspace_uuid), actor=actor, role=actor_role.value,
                             action=action.value, target=f"workspace:{workspace_uuid}", source=source,
                             outcome=outcome.value, details=details)
        return result

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise RuntimeError("AuditService clock must return a timezone-aware datetime")
        return now.astimezone(timezone.utc)

    @staticmethod
    def _workspace_uuid(workspace_id: Any) -> UUID:
        if isinstance(workspace_id, UUID):
            return workspace_id
        try:
            return UUID(workspace_id)
        except (TypeError, ValueError, AttributeError):
            raise AuditValidationError("workspace_id must be a UUID", code="INVALID_WORKSPACE") from None

    @staticmethod
    def _check_details(action: AuditAction, details: Any) -> dict[str, Any]:
        if not isinstance(details, dict):
            raise AuditValidationError("details must be a dict", code="INVALID_DETAILS")
        try:
            normalized = normalize(details, "details")
        except CanonicalizationError as exc:
            raise AuditValidationError(f"details cannot be recorded: {exc}", code="INVALID_DETAILS") from None

        forbidden = find_forbidden_keys(normalized, "details")
        if forbidden:
            raise AuditValidationError(
                f"details contain forbidden keys (store ids, counts or hashes instead): {', '.join(forbidden)}",
                code="FORBIDDEN_DETAILS",
            )

        size = len(canonical_json(normalized).encode("utf-8"))
        if size > MAX_DETAILS_BYTES:
            raise AuditValidationError(f"details are {size} bytes; the limit is {MAX_DETAILS_BYTES}",
                                       code="DETAILS_TOO_LARGE")

        model = REQUIRED_DETAILS.get(action)
        if model is not None:
            try:
                model.model_validate(normalized)
            except ValidationError as exc:
                # loc + error type only: pydantic's messages and `input` can echo the value.
                problems = "; ".join(f"{'.'.join(map(str, err['loc'])) or '(details)'}: {err['type']}"
                                     for err in exc.errors())
                raise AuditValidationError(f"{action.value} details are invalid: {problems}",
                                           code="INVALID_REQUIRED_DETAILS") from None
        return normalized


__all__ = ["AuditService", "MAX_DETAILS_BYTES"]
