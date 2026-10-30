"""
CASE — Audit & Transparency Layer
Chain verification (AUDIT_MODULE_PLAN.md §5.3, §5.5, §8.3)

Location: src/audit/verifier.py

verify_chain walks a workspace's events in seq order, in batches of 1,000,
and for each event checks:
- seq is the expected next value         -> GAP / DUPLICATE_SEQ
- previous_hash == prior current_hash    -> LINK_BROKEN
- recomputed hash == stored current_hash -> RECORD_MODIFIED
and compares the events with the chain head (audit_chain_heads):
- head says more records than found      -> TAIL_TRUNCATED
- a record exists after the head         -> INSERTED_OUTSIDE_LOG_EVENT
- same seq as the head, different hash   -> HEAD_MISMATCH

It stops checking at the first break, but keeps reading so the result can
say how many later records are unverifiable and which record was really the
last one found. Only reads; logging the result (AUDIT_INTEGRITY_VERIFIED /
AUDIT_INTEGRITY_FAILED) is done by AuditService.verify_chain.

verify_lineage (§8.5) is added here in Phase 4.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Callable, Optional
from uuid import UUID, uuid4

from .canonical import GENESIS_HASH, compute_event_hash
from .errors import AuditValidationError
from .repository import AuditRepository
from .schemas import AuditEvent, ChainBreakReasonEnum, ChainVerificationResult, VerificationStatusEnum

#verifier can request up to 1000 events at a time 
#but the repository may return fewer if the range is smaller or the workspace has fewer events.
BATCH_SIZE = 1000

#alias to simplify the name(buat lagi pendek)
Reason = ChainBreakReasonEnum

def _utc_now() -> datetime:
    return datetime.now(timezone.utc)

#check if the requested seq range is valid and return the first seq to check
def _check_range(from_seq: Optional[int], to_seq: Optional[int]) -> int:
    """Validate the requested seq range and return the first seq to check."""
    for name, value in (("from_seq", from_seq), ("to_seq", to_seq)):
        if value is not None and (
            not isinstance(value, int)  #to check if value is not integer
            or isinstance(value, bool)  #to check if value is boolean
            or value < 1):              #to check if value is less than 1
            #then, reject verification 
            raise AuditValidationError(f"{name} must be a whole number >= 1", code="INVALID_RANGE")
    #if from_seq is None, then first seq to check is 1, otherwise it is from_seq
    first = from_seq or 1
    #to prevent error to_seq
    if to_seq is not None and to_seq < first:
        raise AuditValidationError("to_seq must not be smaller than from_seq", code="INVALID_RANGE")
    return first

#core integrity checks for a single event
#returning the first problem found, None if the event is fine
def _check_event(event: AuditEvent, *, expected_seq: int, previous_hash: str,
                 head_seq: int, head_hash: str, compare_head: bool) -> Optional[tuple[int, Reason]]:
    """Return (broken_at_seq, reason) for the first problem with this event, or None."""
    
    #event.seq:current audit event, expected_seq:next seq number, compare_head: a boolean indicating whether to compare with the head event
    
    #check missing sequence
    if event.seq > expected_seq:
        return expected_seq, Reason.GAP  # the missing seq is the broken record
    #check duplicate sequence
    if event.seq < expected_seq:
        return event.seq, Reason.DUPLICATE_SEQ
    #ada orang bypass, and insert event
    if compare_head and event.seq > head_seq:
        return event.seq, Reason.INSERTED_OUTSIDE_LOG_EVENT
    #check if the previous hash matches the expected previous hash
    if event.previous_hash != previous_hash:
        return event.seq, Reason.LINK_BROKEN
    #check if the current hash matches the computed hash
    if compute_event_hash(event) != event.current_hash:   #ada dalam canonical.py
        return event.seq, Reason.RECORD_MODIFIED
    #check chain head mismatch
    if compare_head and event.seq == head_seq and event.current_hash != head_hash:
        return event.seq, Reason.HEAD_MISMATCH
    return None


async def verify_chain(
        repository: AuditRepository, 
        workspace_id: UUID, 
        *,
        from_seq: Optional[int] = None, 
        to_seq: Optional[int] = None,
        verified_by: str = "system", 
        verified_role: str = "SYSTEM",
        clock: Callable[[], datetime] = _utc_now,
        new_id: Callable[[], UUID] = uuid4
) -> ChainVerificationResult:
    """Verify one workspace chain, or the part from_seq..to_seq of it.

    A range that starts after seq 1 trusts the stored current_hash of the
    record just before it (from_seq - 1) as its starting link. The head is
    compared only when the range reaches the head (to_seq None or >= head).
    """
    #validate range and start timer - timer is for verification result later nak tengok berapa lama
    first = _check_range(from_seq, to_seq)
    started = time.perf_counter()

    #retrieve current chain head 
    head = await repository.get_head(workspace_id)
    #if a chain head exist, use its values, otherwise use 0 for head_seq and head_hash; representing empty chain
    head_seq, head_hash = (head.last_seq, head.last_hash) if head is not None else (0, GENESIS_HASH)
    #compare_head will return boolean, nak check if kita tengah semak yang paling last
    compare_head = to_seq is None or to_seq >= head_seq
    #The last seq this range should contain if nothing was deleted.
    end_expected = head_seq if compare_head else to_seq

    #initialie tracking variables for the verification process
    broken: Optional[tuple[int, Reason]] = None
    checked = 0
    after_break = 0
    last_found_seq, last_found_hash = 0, GENESIS_HASH

    #set nilai awal (default) previous_hash as GENESIS_HASH - used if checking starts from first record
    previous_hash = GENESIS_HASH
    #kalau checking starts in between chains (contoh: bermula dari seq 50, bukannya seq 1), kita kena check dulu previous event ada ke tak
    if first > 1:
        anchor = await repository.list_events(
            workspace_id, 
            from_seq=first - 1, 
            to_seq=first - 1)
        #jadikan anchor ni as previous_hash before checking the first event in the range. If anchor is empty, it means the previous event is missing, so we mark it as broken with Reason.GAP
        if anchor:
            previous_hash = anchor[0].current_hash
            last_found_seq, last_found_hash = anchor[0].seq, anchor[0].current_hash
        else:
            broken = (first - 1, Reason.GAP)

    #track which sequence should appear next
    expected_seq = first
    #tell the repo where next batch should begin
    cursor = first
    while True:
        #tarik a batch of events from the repository, starting from cursor, up to to_seq, with a limit of BATCH_SIZE
        batch = await repository.list_events(
            workspace_id, 
            from_seq=cursor, 
            to_seq=to_seq, 
            limit=BATCH_SIZE
        )
        for event in batch:
            last_found_seq, last_found_hash = event.seq, event.current_hash

            #kalau dah ada broken exist sebelum, ni, ignore the rest of the events, but still count how many come after the broken one
            if broken is not None:
                after_break += 1
                continue

            #check the event for any issues, passing in the expected sequence number, previous hash, head sequence and hash, and whether to compare with the head
            broken = _check_event(event, expected_seq=expected_seq, previous_hash=previous_hash,
                                  head_seq=head_seq, head_hash=head_hash, compare_head=compare_head)
           
            #update current checking state: 
            #if the event is after a broken one, we increment after_break; 
            #otherwise, we increment checked. 
            #we also update previous_hash and expected_seq for the next iteration.           
            if broken is not None and broken[1] is Reason.GAP:
                after_break += 1  # this event comes after the missing one, so it is not checked
            else:
                checked += 1

            #update previous_hash and expected_seq for the next event
            previous_hash = event.current_hash
            expected_seq = event.seq + 1

        #if the batch is smaller than BATCH_SIZE, it means we have reached the end of available events
        #so break the loop
        if len(batch) < BATCH_SIZE:
            break

        #now, set the cursor to the next expected sequence number for the next batch
        cursor = batch[-1].seq + 1

    #nak check if every record found was fine, but some at the end are missing.
    #last event is missing
    if broken is None and last_found_seq < end_expected:
        broken = (last_found_seq + 1, Reason.TAIL_TRUNCATED if compare_head else Reason.GAP)

    return ChainVerificationResult(
        verification_id=new_id(),
        workspace_id=workspace_id,
        verified_by=verified_by,
        verified_role=verified_role,
        verified_at=clock(),
        from_seq=first,
        to_seq=to_seq,
        events_checked=checked,
        status=VerificationStatusEnum.VERIFIED if broken is None else VerificationStatusEnum.BROKEN,
        broken_at_seq=None if broken is None else broken[0],
        reason=None if broken is None else broken[1],
        unverifiable_after=None if broken is None else after_break,
        head_seq=head_seq,
        head_hash=head_hash,
        last_found_seq=last_found_seq,
        last_found_hash=last_found_hash,
        duration_ms=int((time.perf_counter() - started) * 1000),
    )


__all__ = ["BATCH_SIZE", "verify_chain"]
