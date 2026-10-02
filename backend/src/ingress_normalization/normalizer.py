"""
Ingress normalizer registry.

Dispatches a raw channel payload to the right adapter based on `source`.
Adding a new channel means writing one new adapter function and adding one
entry here - nothing else in the pipeline (Intent & Planner included) needs
to change.
"""

from typing import Any, Callable, Dict

from .gmail_adapter import normalize_gmail
from .schemas import StandardizedIngressRequest
from .telegram_adapter import normalize_telegram

IngressNormalizer = Callable[[Dict[str, Any]], StandardizedIngressRequest]

NORMALIZERS: Dict[str, IngressNormalizer] = {
    "GMAIL": normalize_gmail,
    "TELEGRAM": normalize_telegram,
}


def normalize_ingress(source: str, raw: Dict[str, Any]) -> StandardizedIngressRequest:
    """Convert a raw channel payload into a StandardizedIngressRequest.

    Raises ValueError if no adapter is registered for `source`. Does not
    check whether the source is enabled for a workspace - that's the
    Ingress Listener / security layer's responsibility.
    """
    normalizer = NORMALIZERS.get(source.upper())
    if normalizer is None:
        raise ValueError(f"No normalizer registered for source: {source}")
    return normalizer(raw)
