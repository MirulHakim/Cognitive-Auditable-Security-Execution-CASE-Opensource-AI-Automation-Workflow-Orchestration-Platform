import React from "react";
import {
  FiGlobe,
  FiClock,
  FiMail,
  FiSend,
  FiCpu,
  FiTerminal,
  FiGitBranch,
  FiShare2,
  FiFolder,
  FiUserCheck,
  FiFileText,
} from "react-icons/fi";

export type NodeCategory = "triggers" | "ai" | "logic" | "connectors" | "terminal";

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge?: string;
  /** Render order in the Node Catalog (lower = earlier). */
  order?: number;
  /** Terminal nodes (Gmail/Telegram) have no output port — chain ends here. */
  isTerminal?: boolean;
  defaultConfig?: Record<string, any>;
}

/* -----------------------------------------------------------------------
   Logic node schema
   -----------------------------------------------------------------------
   Drives LogicNode: `branches` renders one dynamic output port per entry
   (e.g. ["True", "False"] for IF/ELSE, named cases for Switch).
*/
export type LogicMode = "if-else";

export interface LogicConfig {
  /** Branching strategy this node runs. */
  mode: LogicMode;
  /** Condition evaluated at runtime (if subject / switch subject). */
  expression: string;
  /** Labels of the dynamic output ports, one per branch. */
  branches: string[];
}

/* -----------------------------------------------------------------------
   Connector node schema
   -----------------------------------------------------------------------
   Drives ConnectorNode: branded service icon + editable, dynamic
   input-mapping rows.
*/
export type ConnectorService = "gmail" | "telegram" | "rest-api" | "docs";

export interface FieldMapping {
  /** Field on the incoming payload. */
  source: string;
  /** Field expected by the external service. */
  target: string;
}

export interface ConnectorConfig {
  service: ConnectorService;
  /** Human-readable action, e.g. "Send Email". */
  operation: string;
  /** REST only: HTTP verb + target URL. */
  method?: string;
  endpoint?: string;
  /** Dynamic input-mapping rows rendered as editable fields. */
  mapping: FieldMapping[];
  /** Document Reader: shared folder the AI is allowed to read. */
  folderPath?: string;
  /** Document Reader: mock files granted by the operator. */
  grantedFiles?: string[];
  /* Plain-English fields edited in the Node Settings panel. */
  emailRecipient?: string;
  subject?: string;
  body?: string;
  telegramChatId?: string;
  telegramMessage?: string;
}

export const NODE_REGISTRY: NodeDefinition[] = [
  // Triggers (D-capsule nodes)
  {
    type: "trigger-webhook",
    category: "triggers",
    title: "Webhook Trigger",
    badge: "POST",
    description:
      "Listens for incoming HTTP POST payloads from external systems.",
    icon: FiGlobe,
    color: "text-warning bg-warning/10 border-warning/20",
    defaultConfig: {
      httpMethod: "POST",
      endpointPath: "/webhook",
    },
  },
  {
    type: "trigger-cron",
    category: "triggers",
    title: "Schedule / Cron",
    badge: "SCHEDULE",
    description: "Triggers on a repeating cron interval or scheduled cadence.",
    icon: FiClock,
    color: "text-warning bg-warning/10 border-warning/20",
    defaultConfig: {
      cronExpression: "0 9 * * 1-5",
      humanTime: "Every weekday @ 9:00 AM",
    },
  },
  {
    type: "trigger-email",
    category: "triggers",
    title: "Email Received",
    badge: "IMAP",
    description: "Monitors an inbox address for inbound email messages.",
    icon: FiMail,
    color: "text-warning bg-warning/10 border-warning/20",
    defaultConfig: {
      inbox: "inbound@app.axiomflow.io",
    },
  },
  {
    type: "trigger-telegram",
    category: "triggers",
    title: "Telegram Bot",
    badge: "BOT API",
    description:
      "Triggers on incoming commands or messages to your Telegram bot.",
    icon: FiSend,
    color: "text-warning bg-warning/10 border-warning/20",
    defaultConfig: {
      command: "/start, /alert, text",
    },
  },

  // AI Agents (Future modules)
  // Inside NODE_REGISTRY in NodeRegistry.ts
  {
    type: "agent-llm",
    category: "ai",
    title: "LLM Reasoner",
    description: "Prompts an AI model to reason, summarize, or extract schema.",
    icon: FiCpu,
    color: "text-accent-primary bg-accent-primary/10 border-accent-primary/20",
    badge: "MODEL",
    defaultConfig: {
      model: "gpt-4o",
      temperature: 0.2,
      dataSource: null, // excel | folder | file | db
    },
  },
  {
    type: "agent-tool-use",
    category: "ai",
    title: "ReAct Agent",
    description: "Autonomous agent that loops actions with defined API tools.",
    icon: FiTerminal,
    color: "text-accent-primary bg-accent-primary/10 border-accent-primary/20",
    badge: "AUTONOMOUS",
    defaultConfig: {
      model: "claude-3-5-sonnet",
      maxIterations: 5,
      dataSource: null,
    },
  },

  // Logic & Branching
  {
    type: "logic-condition",
    category: "logic",
    title: "If / Else Branch",
    description:
      "Checks a condition, then continues down the True or False path.",
    icon: FiGitBranch,
    color: "text-demo bg-demo/10 border-demo/20",
    defaultConfig: {
      mode: "if-else",
      expression: "payload.status === 'approved'",
      branches: ["True", "False"],
    } satisfies Partial<LogicConfig>,
  },
  {
    type: "approval-human",
    category: "terminal",
    title: "Human Approval",
    description:
      "Pauses execution until a human clicks Approve or Reject.",
    icon: FiUserCheck,
    color: "text-warning bg-warning/10 border-warning/20",
    badge: "REVIEW",
    order: 70,
    defaultConfig: {
      description: "Review the AI output and approve or reject.",
    },
  },
  {
    type: "document-generator",
    category: "terminal",
    title: "Document Generator",
    description: "Generates formatted documents (PDF, Word) from AI outputs.",
    icon: FiFileText,
    color: "text-info bg-info/10 border-info/20",
    badge: "DOC",
    order: 80,
    defaultConfig: {
      templateFormat: "PDF",
      title: "AI Generated Report",
    },
  },

  // Connectors
  {
    type: "connector-http",
    category: "connectors",
    title: "HTTP Request",
    description: "Dispatches authenticated REST requests to external APIs.",
    icon: FiShare2,
    color: "text-success bg-success/10 border-success/20",
    defaultConfig: {
      service: "rest-api",
      operation: "Dispatch REST Call",
      method: "POST",
      endpoint: "https://api.example.com/v1/orders",
      mapping: [
        { source: "payload.id", target: "order_id" },
        { source: "payload.amount", target: "total" },
      ],
    } satisfies Partial<ConnectorConfig>,
  },
  {
    type: "connector-docs",
    category: "connectors",
    title: "Document Reader",
    description: "Reads files from folders your team shares with the AI.",
    icon: FiFolder,
    color: "text-success bg-success/10 border-success/20",
    defaultConfig: {
      service: "docs",
      operation: "Read Documents",
      mapping: [],
      folderPath: "/Shared/Documents",
      grantedFiles: ["financial_report.xlsx", "policy.pdf"],
    } satisfies Partial<ConnectorConfig>,
  },
  {
    type: "connector-gmail",
    category: "connectors",
    title: "Gmail",
    description: "Sends email through a linked Gmail account (end of chain).",
    icon: FiMail,
    color: "text-danger bg-danger/10 border-danger/20",
    badge: "END",
    isTerminal: true,
    order: 90,
    defaultConfig: {
      service: "gmail",
      operation: "Send Email",
      emailRecipient: "",
      subject: "",
      body: "",
      mapping: [],
    } satisfies Partial<ConnectorConfig>,
  },
  {
    type: "connector-telegram",
    category: "connectors",
    title: "Telegram",
    description: "Sends a message through your Telegram bot (end of chain).",
    icon: FiSend,
    color: "text-info bg-info/10 border-info/20",
    badge: "END",
    isTerminal: true,
    order: 91,
    defaultConfig: {
      service: "telegram",
      operation: "Send Message",
      telegramChatId: "",
      telegramMessage: "",
      mapping: [],
    } satisfies Partial<ConnectorConfig>,
  },
];
