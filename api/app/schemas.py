"""Domain vocabulary, the node catalogue and request models.

Two ideas live here:

* ``NODE_CATALOGUE`` — one entry per node an operator can put on the canvas.
  It drives ``GET /api/nodes`` and therefore the editor's right-hand settings
  panel: every field the panel shows is declared here (label, kind, options,
  default, help). Adding a node type is one dictionary entry plus an execution
  handler.
* ``WorkflowStep`` — the stored shape. It keeps the original six step fields and
  adds ``config``: the per-node settings the panel writes.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

# --------------------------------------------------------------------------
# Vocabulary
# --------------------------------------------------------------------------

STEP_TYPES = (
    # manual human steps (the original template-module vocabulary)
    "review",
    "validation",
    "approval",
    "intake",
    "document",
    "notification",
    # triggers
    "trigger_webhook",
    "trigger_cron",
    "trigger_email",
    "trigger_telegram",
    # AI nodes
    "llm_agent",
    "agent_react",
    # logic
    "logic_condition",
    # tools / data
    "http_request",
    "document_reader",
    "db_query",
    # integrations (terminal)
    "gmail",
    "telegram",
)

StepType = Literal[
    "review",
    "validation",
    "approval",
    "intake",
    "document",
    "notification",
    "trigger_webhook",
    "trigger_cron",
    "trigger_email",
    "trigger_telegram",
    "llm_agent",
    "agent_react",
    "logic_condition",
    "http_request",
    "document_reader",
    "db_query",
    "gmail",
    "telegram",
]

TRIGGER_TYPES = (
    "trigger_webhook",
    "trigger_cron",
    "trigger_email",
    "trigger_telegram",
)

TERMINAL_TYPES = ("gmail", "telegram")

FILE_TYPES = ("pdf", "jpg", "jpeg", "png")
ORIGINS = ("MANUAL", "AI_DRAFTED")
REVIEW_STATUSES = ("PENDING", "APPROVED", "REJECTED")
INSTANCE_STATUSES = ("RUNNING", "PAUSED", "COMPLETED", "REJECTED", "CANCELLED")
STEP_RUN_STATUSES = ("COMPLETED", "APPROVED", "REJECTED", "SIMULATED", "FAILED")
AUDIT_OUTCOMES = ("SUCCESS", "FAILURE", "PENDING")
ROLES = ("admin", "operator", "auditor")

# Tables a ``db_query`` node may read. Anything else is refused before SQL runs.
QUERYABLE_TABLES = (
    "workflow_templates",
    "workflow_instances",
    "step_runs",
    "audit_events",
    "template_reviews",
    "operators",
)

# Which columns a ``db_query`` node returns per table: enough to be useful in a
# report, never blobs such as ``steps`` or ``details`` that bloat the run record.
QUERY_COLUMNS = {
    "workflow_templates": "template_id, name, version, origin, is_active, created_at, updated_at",
    "workflow_instances": "instance_id, template_name, template_version, status, current_step, cursor_index, created_at, updated_at",
    "step_runs": "run_id, instance_id, step_id, step_type, status, performed_by, started_at, finished_at",
    "audit_events": "event_seq, recorded_at, actor_id, actor_role, action, target_type, target_id, outcome",
    "template_reviews": "review_id, template_id, status, reviewed_by, created_at",
    "operators": "operator_id, display_name, role, created_at",
}


class NodeField(BaseModel):
    """One control in the right-hand settings panel."""

    key: str
    label: str
    kind: Literal["text", "textarea", "number", "select", "multiselect", "chips", "checkbox"] = "text"
    options: list[str] | None = None
    optionLabels: dict[str, str] | None = None
    default: Any = None
    placeholder: str | None = None
    help: str | None = None
    min: float | None = None
    max: float | None = None


class NodeDefinition(BaseModel):
    type: StepType
    category: Literal["triggers", "manual", "ai", "logic", "tools", "database", "integrations"]
    title: str
    description: str
    badge: str | None = None
    is_terminal: bool = False
    accepts_input: bool = False
    defaults: dict[str, Any] = Field(default_factory=dict)
    fields: list[NodeField] = Field(default_factory=list)


def _f(
    key: str,
    label: str,
    kind: str = "text",
    *,
    options: list[str] | None = None,
    option_labels: dict[str, str] | None = None,
    default: Any = None,
    placeholder: str | None = None,
    help: str | None = None,
    min: float | None = None,
    max: float | None = None,
) -> NodeField:
    return NodeField(
        key=key,
        label=label,
        kind=kind,  # type: ignore[arg-type]
        options=options,
        optionLabels=option_labels,
        default=default,
        placeholder=placeholder,
        help=help,
        min=min,
        max=max,
    )


_CASE_SOURCES = ["none", "case_input", "previous_step", "folder", "database"]
_CASE_SOURCE_LABELS = {
    "none": "Nothing",
    "case_input": "The case details",
    "previous_step": "The step before",
    "folder": "A folder",
    "database": "The database",
}

_ROLE_OPTIONS = ["", "officer", "approver", "coordinator"]
_ROLE_LABELS = {
    "": "Anyone",
    "officer": "Officer",
    "approver": "Approver",
    "coordinator": "Coordinator",
}

_TABLE_LABELS = {
    "workflow_templates": "Templates",
    "workflow_instances": "Runs",
    "step_runs": "Run steps",
    "audit_events": "Audit log",
    "template_reviews": "Approvals",
    "operators": "People",
}

_CHANNEL_LABELS = {"email": "Email", "telegram": "Telegram"}

NODE_CATALOGUE: list[NodeDefinition] = [
    # ---------------------------------------------------------------- triggers
    NodeDefinition(
        type="trigger_webhook",
        category="triggers",
        title="Webhook",
        badge="POST",
        description="Starts when another system sends data here.",
        accepts_input=True,
        defaults={"httpMethod": "POST", "endpointPath": "/webhook", "payload": {}},
        fields=[
            _f("httpMethod", "Request type", "select", options=["POST", "GET"], default="POST"),
            _f(
                "endpointPath",
                "Web address",
                default="/webhook",
                placeholder="/webhook",
                help="The last part of the link, e.g. /webhook.",
            ),
        ],
    ),
    NodeDefinition(
        type="trigger_cron",
        category="triggers",
        title="Schedule",
        badge="SCHEDULE",
        description="Starts on a day and time you choose.",
        defaults={"cronExpression": "0 9 * * 1-5", "humanTime": "Every weekday @ 9:00 AM"},
        fields=[
            _f(
                "cronExpression",
                "Time code",
                default="0 9 * * 1-5",
                placeholder="0 9 * * 1-5",
                help="When it runs. 0 9 * * 1-5 = 9:00 on weekdays.",
            ),
            _f("humanTime", "In plain words", default="Every weekday @ 9:00 AM"),
        ],
    ),
    NodeDefinition(
        type="trigger_email",
        category="triggers",
        title="Email arrives",
        badge="EMAIL",
        description="Starts when an email arrives in the inbox.",
        defaults={"inbox": "inbound@workspace.local", "subjectFilter": ""},
        fields=[
            _f("inbox", "Inbox address", default="inbound@workspace.local"),
            _f(
                "subjectFilter",
                "Only if subject has",
                placeholder="pothole",
                help="Leave empty to accept every email.",
            ),
        ],
    ),
    NodeDefinition(
        type="trigger_telegram",
        category="triggers",
        title="Telegram message",
        badge="BOT",
        description="Starts when someone messages the bot.",
        defaults={"command": "/start", "chatId": ""},
        fields=[
            _f("command", "Word to watch for", default="/start", help="The message that starts it."),
            _f("chatId", "Chat to watch", placeholder="-100123456", help="Leave empty to watch every chat."),
        ],
    ),
    # ------------------------------------------------------------ manual steps
    NodeDefinition(
        type="review",
        category="manual",
        title="Review",
        badge="HUMAN",
        description="Someone looks at the case. The run keeps going.",
        defaults={"assignedRole": ""},
        fields=[_f("assignedRole", "Who does it", "select", options=_ROLE_OPTIONS, option_labels=_ROLE_LABELS)],
    ),
    NodeDefinition(
        type="validation",
        category="manual",
        title="Check details",
        description="Makes sure the case has the details it needs.",
        defaults={"requiredFields": []},
        fields=[
            _f(
                "requiredFields",
                "Details that must be filled in",
                "chips",
                default=[],
                placeholder="complainant",
                help="One per entry. The run stops if one is empty.",
            )
        ],
    ),
    NodeDefinition(
        type="approval",
        category="manual",
        title="Approval",
        badge="REVIEW",
        description="Waits for a person to say yes or no.",
        defaults={"commentsRequired": False},
        fields=[
            _f("assignedRole", "Who approves", "select", options=_ROLE_OPTIONS, option_labels=_ROLE_LABELS),
            _f("commentsRequired", "Ask for a reason when rejected", "checkbox", default=False),
        ],
    ),
    NodeDefinition(
        type="intake",
        category="manual",
        title="Upload file",
        badge="UPLOAD",
        description="Waits for an upload, then reads the file.",
        accepts_input=True,
        defaults={
            "acceptedFileTypes": ["pdf", "jpg", "png"],
            "instruction": "Read the document and pick out the key facts.",
        },
        fields=[
            _f(
                "acceptedFileTypes",
                "Allowed file types",
                "multiselect",
                options=list(FILE_TYPES),
                default=["pdf", "jpg", "png"],
            ),
            _f(
                "instruction",
                "What to look for",
                "textarea",
                default="Read the document and pick out the key facts.",
            ),
        ],
    ),
    NodeDefinition(
        type="notification",
        category="manual",
        title="Send a message",
        description="Sends a test message by email or Telegram.",
        defaults={"channel": "email", "recipient": "", "message": ""},
        fields=[
            _f(
                "channel",
                "Send by",
                "select",
                options=["email", "telegram"],
                option_labels=_CHANNEL_LABELS,
                default="email",
            ),
            _f("recipient", "Send to", placeholder="name@workspace.local"),
            _f("message", "Message", "textarea", placeholder="Your case has been processed."),
        ],
    ),
    # ------------------------------------------------------------------- AI
    NodeDefinition(
        type="llm_agent",
        category="ai",
        title="AI step",
        badge="AI",
        description="The AI reads the case and writes an answer.",
        accepts_input=True,
        defaults={
            "model": "qwen3.5:9b",
            "temperature": 0.2,
            "dataSource": "case_input",
            "instruction": "Summarise the case and list the facts an approver must check.",
        },
        fields=[
            _f(
                "dataSource",
                "Read from",
                "select",
                options=_CASE_SOURCES,
                option_labels=_CASE_SOURCE_LABELS,
                default="case_input",
            ),
            _f("model", "AI model", default="qwen3.5:9b", help="The AI model to use."),
            _f("temperature", "Creativity", "number", default=0.2, min=0, max=1, help="0 = strict, 1 = free."),
            _f(
                "instruction",
                "What to do",
                "textarea",
                default="Summarise the case and list the facts an approver must check.",
            ),
        ],
    ),
    NodeDefinition(
        type="agent_react",
        category="ai",
        title="AI agent",
        badge="AUTO",
        description="The AI works through the case in steps, then answers.",
        defaults={
            "model": "qwen3.5:9b",
            "temperature": 0.2,
            "maxIterations": 3,
            "tools": ["case_lookup"],
            "dataSource": "case_input",
            "instruction": "Look into the case and suggest what to do next.",
        },
        fields=[
            _f(
                "dataSource",
                "Read from",
                "select",
                options=_CASE_SOURCES,
                option_labels=_CASE_SOURCE_LABELS,
                default="case_input",
            ),
            _f("model", "AI model", default="qwen3.5:9b", help="The AI model to use."),
            _f("maxIterations", "Rounds", "number", default=3, min=1, max=6, help="How many tries the AI gets."),
            _f("tools", "Tools it may use", "chips", default=["case_lookup"], help="Short names, one per entry."),
            _f("instruction", "Instruction", "textarea", default="Investigate the case and propose the next action."),
        ],
    ),
    # ---------------------------------------------------------------- logic
    NodeDefinition(
        type="logic_condition",
        category="logic",
        title="If / else",
        description="Sends the run one way or the other.",
        defaults={"expression": "complainant != ''", "branches": ["True", "False"]},
        fields=[
            _f(
                "expression",
                "Condition",
                default="complainant != ''",
                placeholder="amount > 400",
                help="For example: amount > 400",
            ),
            _f("branches", "Branch names", "chips", default=["True", "False"]),
        ],
    ),
    # ---------------------------------------------------------------- tools
    NodeDefinition(
        type="document",
        category="tools",
        title="Document",
        badge="DOC",
        description="Fills a document with the case and AI text.",
        defaults={
            "templateFormat": "HTML",
            "title": "AI Generated Report",
            "includeCaseInput": True,
            "includeAIOutput": True,
        },
        fields=[
            _f("templateFormat", "File type", "select", options=["HTML", "PDF", "DOCX"], default="HTML"),
            _f("title", "Document title", default="AI Generated Report"),
            _f("includeCaseInput", "Add case details", "checkbox", default=True),
            _f("includeAIOutput", "Add AI answer", "checkbox", default=True),
        ],
    ),
    NodeDefinition(
        type="http_request",
        category="tools",
        title="Send to a website",
        description="Sends the case to another website.",
        defaults={
            "method": "POST",
            "endpoint": "https://api.example.com/v1/orders",
            "mapping": [{"source": "payload.id", "target": "order_id"}],
        },
        fields=[
            _f("method", "Method", "select", options=["GET", "POST", "PUT", "PATCH"], default="POST"),
            _f("endpoint", "Link", default="https://api.example.com/v1/orders"),
            _f(
                "mapping",
                "Fields to send",
                "chips",
                default=[],
                placeholder="case field -> their field",
                help="One per entry: case field -> their field.",
            ),
        ],
    ),
    NodeDefinition(
        type="document_reader",
        category="database",
        title="Read a folder",
        badge="FILES",
        description="Reads the files you allowed in a folder.",
        accepts_input=True,
        defaults={"folderPath": "", "grantedFiles": ["invoice.pdf"], "instruction": "Pick out the key numbers."},
        fields=[
            _f(
                "folderPath",
                "Folder",
                default="",
                help="Leave empty to read the main folder.",
            ),
            _f("grantedFiles", "Files to read", "chips", default=["invoice.pdf"]),
            _f("instruction", "What to look for", "textarea", default="Pick out the key numbers."),
        ],
    ),
    NodeDefinition(
        type="db_query",
        category="database",
        title="Look up records",
        badge="DATA",
        description="Looks up saved records. Read only.",
        defaults={"table": "workflow_instances", "filterColumn": "status", "filterValue": "PAUSED", "limit": 10},
        fields=[
            _f(
                "table",
                "Table",
                "select",
                options=list(QUERYABLE_TABLES),
                option_labels=_TABLE_LABELS,
                default="workflow_instances",
            ),
            _f("filterColumn", "Column to check", default="status", help="A plain column of the table."),
            _f("filterValue", "Equals", placeholder="PAUSED"),
            _f("limit", "How many rows", "number", default=10, min=1, max=50),
        ],
    ),
    # --------------------------------------------------------- integrations
    NodeDefinition(
        type="gmail",
        category="integrations",
        title="Gmail",
        badge="END",
        is_terminal=True,
        description="Sends the result by email.",
        defaults={"emailRecipient": "", "subject": "", "body": ""},
        fields=[
            _f("emailRecipient", "To", placeholder="name@workspace.local"),
            _f("subject", "Subject", placeholder="Case outcome"),
            _f("body", "Message", "textarea"),
        ],
    ),
    NodeDefinition(
        type="telegram",
        category="integrations",
        title="Telegram",
        badge="END",
        is_terminal=True,
        description="Sends the result on Telegram.",
        defaults={"telegramChatId": "", "telegramMessage": ""},
        fields=[
            _f("telegramChatId", "Chat", placeholder="-100123456"),
            _f("telegramMessage", "Message", "textarea"),
        ],
    ),
]

NODE_BY_TYPE: dict[str, NodeDefinition] = {node.type: node for node in NODE_CATALOGUE}

CATEGORY_LABELS = {
    "triggers": "How it starts",
    "manual": "People steps",
    "ai": "AI steps",
    "logic": "Decisions",
    "tools": "Actions",
    "database": "Files and data",
    "integrations": "How it ends",
}


# --------------------------------------------------------------------------
# Stored shapes
# --------------------------------------------------------------------------


class Position(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: float
    y: float


class WorkflowStep(BaseModel):
    """One node on the canvas == one execution step."""

    model_config = ConfigDict(extra="allow")

    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    type: StepType
    description: str = ""
    assignedRole: str | None = None
    channel: str | None = None
    acceptedFileTypes: list[Literal["pdf", "jpg", "jpeg", "png"]] | None = None
    instruction: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    position: Position | None = None

    @field_validator("description")
    @classmethod
    def _trim(cls, value: str) -> str:
        return value.strip()

    def effective_config(self) -> dict[str, Any]:
        """Defaults from the catalogue, overlaid with what the operator set.

        Older templates only carry ``channel``/``acceptedFileTypes``/``instruction``
        at the top level, so those are folded into ``config`` here.
        """
        node = NODE_BY_TYPE.get(self.type)
        merged: dict[str, Any] = dict(node.defaults) if node else {}
        merged.update({k: v for k, v in self.config.items() if v is not None})
        if self.channel:
            merged.setdefault("channel", self.channel)
        if self.acceptedFileTypes:
            merged["acceptedFileTypes"] = list(self.acceptedFileTypes)
        if self.instruction:
            merged["instruction"] = self.instruction
        if self.assignedRole:
            merged.setdefault("assignedRole", self.assignedRole)
        return merged


class CreateTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    steps: list[WorkflowStep] = Field(min_length=1)


class UpdateTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    steps: list[WorkflowStep] | None = None

    @field_validator("steps")
    @classmethod
    def _non_empty(cls, value: list[WorkflowStep] | None) -> list[WorkflowStep] | None:
        if value is not None and len(value) == 0:
            raise ValueError("Provide at least one step.")
        return value


class GenerateTemplateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prompt: str = Field(min_length=1, max_length=4000)


class StartInstanceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    templateId: str
    input: dict[str, str] | None = None

    @field_validator("input")
    @classmethod
    def _limits(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value and len(value) > 50:
            raise ValueError("At most 50 input fields are allowed.")
        return value

    @field_validator("input")
    @classmethod
    def _field_length(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        for key, item in (value or {}).items():
            if not key.strip() or len(key) > 100:
                raise ValueError("Input keys must be 1-100 characters.")
            if len(item) > 4000:
                raise ValueError(f"Input value for '{key}' is longer than 4000 characters.")
        return value


class RespondRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    approved: bool
    comments: str | None = Field(default=None, max_length=2000)


class InviteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    displayName: str | None = Field(default=None, max_length=120)
    role: Literal["operator", "auditor"]


class RoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["operator", "auditor"]


# --------------------------------------------------------------------------
# Serialisation helpers
# --------------------------------------------------------------------------


def iso_utc(value: datetime | None) -> str | None:
    """JS-compatible ISO-8601 with milliseconds (``…T15:00:00.000Z``)."""
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    value = value.astimezone(timezone.utc)
    return f"{value.strftime('%Y-%m-%dT%H:%M:%S')}.{value.microsecond // 1000:03d}Z"


def step_to_json(step: WorkflowStep | dict[str, Any]) -> dict[str, Any]:
    """Stable JSON for a stored step: no nulls, config always present."""
    raw = step.model_dump(exclude_none=True) if isinstance(step, WorkflowStep) else dict(step)
    out: dict[str, Any] = {
        "id": raw["id"],
        "name": raw["name"],
        "type": raw["type"],
        "description": raw.get("description", ""),
    }
    for key in ("assignedRole", "channel", "acceptedFileTypes", "instruction", "position"):
        if raw.get(key) not in (None, [], {}):
            out[key] = raw[key]
    out["config"] = raw.get("config") or {}
    return out


def normalise_steps(steps: list[WorkflowStep] | list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [step_to_json(step) for step in steps]
