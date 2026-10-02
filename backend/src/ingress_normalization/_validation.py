"""
Shared fail-fast validation helper for ingress adapters.

Deliberately minimal: enforces "required fields must be present, or raise a
clear ValueError" so adapters can't drift into fabricating misleading
defaults (e.g. a missing timestamp silently becoming "now" or epoch 0) for
data that's actually missing.

Treats any falsy value (None, "", 0) as missing. Fine for every field this
is currently used on (sender/message IDs and timestamps, none of which are
legitimately empty or zero) - worth remembering if reused for a field where
0 is a valid value.
"""

from typing import Optional, TypeVar

T = TypeVar("T")


def require(value: Optional[T], message: str) -> T:
    if not value:
        raise ValueError(message)
    return value
