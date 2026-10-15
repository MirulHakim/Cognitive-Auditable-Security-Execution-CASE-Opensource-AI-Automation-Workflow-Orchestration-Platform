import React from "react";
import {
  FiGlobe,
  FiClock,
  FiMail,
  FiSend,
  FiCpu,
  FiTerminal,
  FiGitBranch,
  FiCode,
  FiShare2,
  FiDatabase,
} from "react-icons/fi";

export type NodeCategory = "triggers" | "ai" | "logic" | "connectors";

export interface NodeDefinition {
  type: string;
  category: NodeCategory;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  badge?: string;
  defaultConfig?: Record<string, any>;
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
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
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
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
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
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
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
    color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
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
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
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
    color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
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
      "Branches workflow path conditionally based on expression checks.",
    icon: FiGitBranch,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },
  {
    type: "logic-code",
    category: "logic",
    title: "Script / Transform",
    description:
      "Runs custom TypeScript/JavaScript snippets to transform payloads.",
    icon: FiCode,
    color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
  },

  // Connectors
  {
    type: "connector-http",
    category: "connectors",
    title: "HTTP Request",
    description: "Dispatches authenticated REST requests to external APIs.",
    icon: FiShare2,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    type: "connector-db",
    category: "connectors",
    title: "Database Query",
    description: "Runs SQL or collection queries against connected datastores.",
    icon: FiDatabase,
    color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  },
];
