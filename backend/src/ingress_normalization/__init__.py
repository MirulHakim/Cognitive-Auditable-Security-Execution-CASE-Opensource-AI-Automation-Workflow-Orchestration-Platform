"""
Ingress Input Normalization Module

Converts channel-specific raw payloads (Gmail, Telegram, ...) into one
channel-agnostic StandardizedIngressRequest for Intent & Planner to consume.
Independent of workspace configuration, whitelisting, and authorization.
"""

from .normalizer import NORMALIZERS, normalize_ingress
from .schemas import IngressAttachment, StandardizedIngressRequest

__all__ = [
    "normalize_ingress",
    "NORMALIZERS",
    "IngressAttachment",
    "StandardizedIngressRequest",
]
