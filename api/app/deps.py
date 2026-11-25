"""Shared singletons.

The repositories are stateless wrappers around the pool, so one instance per
process is enough and keeps the route modules free of wiring.
"""

from __future__ import annotations

from .audit import AuditStore
from .db import db
from .repos import InstanceRepo, OperatorRepo, TemplateRepo
from .services import InstanceService, TemplateService

operators = OperatorRepo(db)
templates = TemplateRepo(db)
instances = InstanceRepo(db)
audit = AuditStore(db)

template_service = TemplateService(templates, audit)
instance_service = InstanceService(templates, instances, audit)
