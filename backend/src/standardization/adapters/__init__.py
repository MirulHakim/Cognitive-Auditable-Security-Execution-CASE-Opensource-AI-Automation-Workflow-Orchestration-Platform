"""
CASE — Data Standardization & Normalization Layer
Adapters package (Step 3)

Location: src/standardization/adapters/__init__.py

Standardization 1 (incoming request -> StandardMessage):  gmail, telegram, web_form
Standardization 2 (resource data -> StandardRecordSet):   gmail (EMAIL_SERVICE), rest_api, json_file
"""

from . import gmail, json_file, rest_api, telegram, web_form
from .base import FieldMapping, FieldSpec, ResourceInfo, StandardizationError

__all__ = ["gmail", "telegram", "web_form", "rest_api", "json_file",
           "FieldMapping", "FieldSpec", "ResourceInfo", "StandardizationError"]
