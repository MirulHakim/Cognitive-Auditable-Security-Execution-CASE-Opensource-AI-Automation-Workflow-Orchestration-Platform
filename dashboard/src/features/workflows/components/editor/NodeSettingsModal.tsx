import React, { useEffect, useMemo, useState } from "react";
import { FiX, FiSave, FiZap, FiTrash2, FiFolderPlus, FiFileText, FiStar, FiCheck } from "react-icons/fi";
import { NODE_REGISTRY, type ConnectorService, type FieldMapping } from "../../constants/NodeRegistry";
import type { CanvasNodeData } from "./nodes/TriggerNode";

interface SettingsConfig {
  title?: string;
  description?: string;
  templateFormat?: "PDF" | "Word";
  isSecret?: boolean;
  operation?: string;
  method?: string;
  endpoint?: string;
  service?: ConnectorService;
  mapping?: FieldMapping[];
  senderWhitelist?: boolean;
  folderPath?: string;
  grantedFiles?: string[];
  aiSummary?: string;
  reviewDecision?: "approved" | "rejected";
  emailRecipient?: string;
  subject?: string;
  body?: string;
  telegramChatId?: string;
  telegramMessage?: string;
  webhookUrl?: string;
  cronExpression?: string;
  humanTime?: string;
  inbox?: string;
  telegramCommand?: string;
}

interface NodeSettingsModalProps {
  node: CanvasNodeData;
  onClose: () => void;
  onUpdateConfig: (id: string, patch: Record<string, unknown>) => void;
}

// Plain-English field labels shown in the settings drawer
const FIELD_LABELS: Record<string, string> = {
  emailRecipient: "Recipient Email Address",
  subject: "Email Subject",
  body: "Email Body",
  telegramChatId: "Chat ID",
  telegramMessage: "Message Text",
  senderWhitelist: "Enforce Sender Whitelist",
};

const SERVICE_DEFAULTS: Record<ConnectorService, { operation: string; fields: string[] }> = {
  gmail: {
    operation: "Send Email",
    fields: ["emailRecipient", "subject", "body"],
  },
  telegram: {
    operation: "Send Message",
    fields: ["telegramChatId", "telegramMessage"],
  },
  "rest-api": {
    operation: "Send REST Call",
    fields: ["endpoint", "method"],
  },
  docs: {
    operation: "Read Documents",
    fields: [],
  },
};

export const NodeSettingsModal: React.FC<NodeSettingsModalProps> = ({ node, onClose, onUpdateConfig }) => {
  const [activeTab, setActiveTab] = useState<"general" | "advanced">("general");
  const config = (node.config ?? {}) as SettingsConfig;

  const definition = useMemo(() => {
    return NODE_REGISTRY.find((item) => item.type === node.type) || {
      title: "Node",
      description: "",
      icon: FiZap,
      color: "text-accent-primary",
    };
  }, [node.type]);

  const IconComponent = definition.icon;
  const isConnector = node.type.startsWith("connector-");
  const isTrigger = node.type.startsWith("trigger-");
  const isAgent = node.type.startsWith("agent-");
  const isLogic = node.type.startsWith("logic-");

  const serviceDefaults = isConnector && config.service ? SERVICE_DEFAULTS[config.service] : null;

  useEffect(() => {
    const escapeClose = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escapeClose);
    return () => document.removeEventListener("keydown", escapeClose);
  }, [onClose]);

  const handleSave = () => {
    onClose();
  };

  const updateFieldValue = (key: string, value: unknown) => {
    onUpdateConfig(node.id, { [key]: value });
  };

  const renderToggle = (key: string, label: string) => (
    <div className="flex items-center justify-between p-3 rounded-lg border border-subtle bg-surface-sunken/50 mb-3">
      <div className="flex-1">
        <div className="text-xs font-medium text-secondary mb-0.5">{label}</div>
        <div className="text-[11px] text-faint">
          {key === "senderWhitelist" ? "Only allow messages from approved sender addresses." : "Enable this security control."}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={Boolean(config[key as keyof SettingsConfig])}
        onClick={() => updateFieldValue(key, !config[key as keyof SettingsConfig])}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
          config[key as keyof SettingsConfig] ? "bg-success" : "bg-surface-hover"
        }`}
      >
        <span
          aria-hidden="true"
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition-transform ${
            config[key as keyof SettingsConfig] ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );

  const renderTextField = (key: string, label: string, value?: string, placeholder?: string, mono?: boolean) => (
    <div className="mb-3">
      <label className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">{label}</label>
      <input
        type="text"
        value={(config[key as keyof SettingsConfig] as string) || value || ""}
        onChange={(e) => updateFieldValue(key, e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={`w-full bg-background border border-strong rounded-lg px-3 py-2 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary transition-colors ${
          mono ? "font-mono" : ""
        }`}
      />
    </div>
  );

  const renderConnectorFields = () => {
    if (!serviceDefaults) return null;

    if (config.service === "gmail" || config.service === "telegram") {
      return (
        <div>
          {config.service === "gmail" ? (
            <>
              {renderTextField("emailRecipient", "Recipient Email Address", "", "recipient@example.com")}
              {renderTextField("subject", "Email Subject", "", "Quarterly Report Ready")}
              {renderTextField("body", "Email Body", "", "Hello,\n\nYour report is attached...")}
            </>
          ) : (
            <>
              {renderTextField("telegramChatId", "Chat ID", "", "@channel or chat ID")}
              {renderTextField("telegramMessage", "Message Text", "", "Alert: System status updated!")}
            </>
          )}
          <p className="text-[11px] text-faint italic mt-1">
            Data flowing from previous nodes will be inserted automatically where needed.
          </p>
        </div>
      );
    }

    // Simulated File/Folder Picker — Document Reader (no queries, no SQL)
    if (config.service === "docs") {
      const files = config.grantedFiles || [];
      return (
        <div>
          <p className="text-[11px] text-faint mb-3">
            Pick a shared folder and the AI will read its documents automatically — no queries to write.
          </p>

          <button
            type="button"
            onClick={() =>
              updateFieldValue("grantedFiles", [
                "financial_report.xlsx",
                "policy.pdf",
              ])
            }
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-dashed border-accent-primary/40 bg-accent-primary/[0.06] text-accent-primary text-xs font-semibold hover:bg-accent-primary/10 hover:border-accent-primary transition-colors"
          >
            <FiFolderPlus className="w-4 h-4" />
            Grant Access to Folder/File
          </button>

          {files.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">
                Accessible Files
              </div>
              <div className="space-y-1.5">
                {files.map((file, index) => (
                  <div
                    key={`${file}-${index}`}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-subtle bg-surface-sunken/50"
                  >
                    <FiFileText className="w-3.5 h-3.5 text-success shrink-0" />
                    <span className="text-xs text-secondary font-mono truncate flex-1">
                      {file}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateFieldValue(
                          "grantedFiles",
                          files.filter((_, i) => i !== index),
                        )
                      }
                      className="text-faint hover:text-danger transition-colors shrink-0"
                      title="Revoke access"
                    >
                      <FiTrash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-faint mt-3">
            Supported formats:{" "}
            <span className="font-mono text-muted">PDF, DOCX, XLSX</span>
          </p>
        </div>
      );
    }

    // REST — advanced endpoint editing in Advanced tab
    return (
      <div>
        {renderTextField("operation", "Operation Description", serviceDefaults.operation, serviceDefaults.operation)}
        <p className="text-[11px] text-faint">Configure authentication, endpoint, and payload mapping in the Advanced tab.</p>
      </div>
    );
  };

  const renderGeneralTab = () => {
    if (isConnector) return renderConnectorFields();

    if (isTrigger) {
      return (
        <div>
          {renderToggle("senderWhitelist", FIELD_LABELS.senderWhitelist)}
          {node.type === "trigger-webhook" && renderTextField("description", "Description", "Receives incoming HTTP POST data", "", false)}
          {node.type === "trigger-cron" && (
            <>
              {renderTextField("cronExpression", "Schedule (cron)", "", "0 9 * * 1-5", true)}
              {renderTextField("humanTime", "Plain-English Schedule", "", "Every weekday at 9:00 AM")}
            </>
          )}
          {node.type === "trigger-email" && renderTextField("inbox", "Inbound Email Address", "", "inbound@example.com")}
          {node.type === "trigger-telegram" && renderTextField("telegramCommand", "Trigger Commands", "", "/start, /alert, text", true)}
        </div>
      );
    }

    if (isAgent) {
      return (
        <div>
          {renderTextField("model", "AI Model", "", "gpt-4o")}
          {renderTextField("dataSource", "Data Source Reference", "", "Upload files or grant access to a folder")}
        </div>
      );
    }

    if (isLogic) {
      return <div>{renderTextField("expression", "Branch Condition", "", "payload.status === 'approved'")}</div>;
    }

    if (node.type === "approval-human") {
      return (
        <div className="space-y-4">
          {/* AI Request Summary — synthesized intent, shown before the
              operator reviews whitelisted payloads (e.g. long emails). */}
          <div className="rounded-lg border border-accent-primary/25 bg-accent-primary/[0.07] p-3.5">
            <div className="flex items-center gap-1.5 text-accent-primary mb-1.5">
              <FiStar className="w-3.5 h-3.5 fill-current shrink-0" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                AI Request Summary
              </span>
            </div>
            <p className="text-xs text-secondary leading-relaxed">
              {config.aiSummary ||
                "Finance Ops requested release of the Q3 vendor payment of $12,450 to Northwind Traders. The AI verified the invoice against the purchase order and found no policy conflicts. Recommended action: approve."}
            </p>
            <p className="text-[10px] text-faint mt-2 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
              Sender verified against whitelist · email condensed from 1,240 words
            </p>
          </div>

          <p className="text-xs text-muted">
            This step pauses workflow execution until a human reviews and clicks <strong className="text-primary">Approve</strong> or <strong className="text-primary">Reject</strong>.
          </p>
          {renderTextField("description", "Reviewer Instructions", "Review the AI output and approve or reject.", "")}
        </div>
      );
    }

    if (node.type === "document-generator") {
      return (
        <div className="space-y-4">
          <div className="mb-3">
            <label className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">Template Format</label>
            <div className="flex gap-2">
              {["PDF", "Word"].map((format) => (
                <button
                  key={format}
                  type="button"
                  onClick={() => updateFieldValue("templateFormat", format)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    (config.templateFormat || "PDF") === format
                      ? "border-accent-primary bg-accent-primary/10 text-accent-primary"
                      : "border-subtle bg-surface-sunken text-muted hover:text-secondary"
                  }`}
                >
                  {format}
                </button>
              ))}
            </div>
          </div>
          {renderTextField("title", "Document Title", "AI Generated Report", "")}
          <p className="text-[11px] text-faint">AI outputs will be filled into the selected template automatically.</p>
        </div>
      );
    }

    return (
      <div>
        {renderTextField("description", "Description", definition.description, "")}
      </div>
    );
  };

  const renderAdvancedTab = () => {
    if (isConnector) {
      // Document Reader: folder access summary instead of payload mapping
      if (config.service === "docs") {
        const files = config.grantedFiles || [];
        return (
          <div className="space-y-4">
            <div className="rounded-lg border border-subtle bg-surface-sunken/50 p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">
                Folder Access
              </div>
              <div className="text-xs font-mono text-secondary truncate mb-2">
                {config.folderPath || "/Shared/Documents"}
              </div>
              {files.length > 0 ? (
                <ul className="space-y-1">
                  {files.map((file, index) => (
                    <li
                      key={`${file}-${index}`}
                      className="flex items-center gap-2 text-[11px] text-muted"
                    >
                      <FiFileText className="w-3 h-3 text-success shrink-0" />
                      <span className="font-mono truncate">{file}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-faint italic">
                  No files granted yet.
                </p>
              )}
            </div>
            <p className="text-[11px] text-faint">
              Documents read from this folder are passed to the AI automatically. Supported formats:{" "}
              <span className="font-mono text-muted">PDF, DOCX, XLSX</span>
            </p>
          </div>
        );
      }

      return (
        <div className="space-y-4">
          {config.service === "rest-api" && (
            <>
              {renderTextField("endpoint", "Endpoint URL", "", "https://api.example.com/v1/...", true)}
              <div className="mb-3">
                <label className="block text-[11px] uppercase tracking-wider text-muted font-semibold mb-1.5">HTTP Method</label>
                <div className="flex gap-2">
                  {["GET", "POST", "PUT", "DELETE"].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => updateFieldValue("method", m)}
                      className={`px-3 py-1.5 rounded border text-xs font-mono font-medium transition-colors ${
                        (config.method || "POST") === m
                          ? "border-success bg-success/10 text-success"
                          : "border-subtle text-muted hover:text-secondary"
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className="text-[11px] uppercase tracking-wider text-muted font-semibold flex justify-between items-center mb-2">
              Field Mapping
              <button
                type="button"
                className="text-accent-primary hover:text-accent-primary-hover transition-colors text-[11px] normal-case"
                onClick={() => {
                  const mapping = [...(config.mapping || []), { source: "", target: "" }];
                  onUpdateConfig(node.id, { mapping });
                }}
              >
                + Add Field
              </button>
            </label>
            {(config.mapping || []).map((row, index) => (
              <div key={index} className="flex items-center gap-2 mb-2">
                <input
                  type="text"
                  value={row.source}
                  onChange={(e) => {
                    const mapping = [...(config.mapping || [])];
                    mapping[index] = { ...mapping[index], source: e.target.value };
                    onUpdateConfig(node.id, { mapping });
                  }}
                  placeholder="From AI"
                  className="flex-1 min-w-0 bg-background border border-strong rounded px-2 py-1.5 text-[11px] text-primary focus:outline-none focus:border-accent-primary font-mono"
                />
                <span className="text-faint">→</span>
                <input
                  type="text"
                  value={row.target}
                  onChange={(e) => {
                    const mapping = [...(config.mapping || [])];
                    mapping[index] = { ...mapping[index], target: e.target.value };
                    onUpdateConfig(node.id, { mapping });
                  }}
                  placeholder="To Service"
                  className="flex-1 min-w-0 bg-background border border-strong rounded px-2 py-1.5 text-[11px] text-primary focus:outline-none focus:border-accent-primary font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    const mapping = (config.mapping || []).filter((_, i) => i !== index);
                    onUpdateConfig(node.id, { mapping });
                  }}
                  className="text-faint hover:text-danger transition-colors"
                  title="Remove"
                >
                  <FiTrash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {(!config.mapping || config.mapping.length === 0) && (
              <p className="text-[11px] text-faint italic">No custom mapping. Payload passes through untouched.</p>
            )}
          </div>
        </div>
      );
    }

    return (
      <div className="text-xs text-muted">
        <p className="mb-2">Technical configuration for this node type.</p>
        <pre className="bg-background border border-subtle rounded-lg p-3 font-mono text-[11px] overflow-auto max-h-48">
          {JSON.stringify(node.config || {}, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-end sm:justify-center p-0 sm:p-4">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-surface border border-subtle rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90vh] z-10">
        <div className="p-4 border-b border-subtle flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-xl border flex items-center justify-center shrink-0 ${definition.color}`}>
              <IconComponent className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-primary truncate">{definition.title}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-strong/40 text-muted shrink-0">
                  {node.id.slice(-6)}
                </span>
              </div>
              <p className="text-[11px] text-muted truncate">{definition.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors shrink-0"
            title="Close"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-subtle bg-surface-sunken/30 shrink-0">
          {(["general", "advanced"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? "border-accent-primary text-accent-primary bg-accent-primary/5"
                  : "border-transparent text-muted hover:text-secondary"
              }`}
            >
              {tab === "general" ? "General" : "Advanced"}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto flex-1">
          {activeTab === "general" ? renderGeneralTab() : renderAdvancedTab()}
        </div>

        <div className="p-3 border-t border-subtle flex flex-wrap justify-end gap-2 shrink-0 bg-surface-sunken/30">
          {node.type === "approval-human" ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-subtle text-xs font-medium text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  updateFieldValue("reviewDecision", "rejected");
                  onClose();
                }}
                className="px-4 py-2 rounded-lg border border-danger/50 text-danger hover:bg-danger/10 font-semibold text-xs transition-colors inline-flex items-center gap-1.5"
              >
                <FiX className="w-3.5 h-3.5" />
                Reject
              </button>
              <button
                type="button"
                onClick={() => {
                  updateFieldValue("reviewDecision", "approved");
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-success hover:bg-success/85 text-black font-semibold text-xs transition-colors shadow-sm shadow-success/40 inline-flex items-center gap-1.5"
              >
                <FiCheck className="w-3.5 h-3.5 stroke-[3]" />
                Approve
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-subtle text-xs font-medium text-muted hover:text-secondary hover:bg-surface-hover transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-sm shadow-accent-primary/40 inline-flex items-center gap-1.5"
              >
                <FiSave className="w-3.5 h-3.5" />
                Save Settings
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NodeSettingsModal;