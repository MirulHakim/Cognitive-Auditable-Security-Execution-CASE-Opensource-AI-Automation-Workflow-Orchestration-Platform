import React, { useState, useEffect } from "react";
import { FiShield, FiLock } from "react-icons/fi";
import TelegramIntegrationCard from "./components/TelegramIntegrationCard";
import GmailIntegrationCard from "./components/GmailIntegrationCard";
import ConfirmModal from "../../components/ConfirmModal";

interface UserSecrets {
  telegramBotToken: string | null;
  gmailAccount: string | null;
}

export const IntegrationsView: React.FC = () => {
  // Store user-scoped credentials safely in local browser storage for prototype testing
  const [secrets, setSecrets] = useState<UserSecrets>(() => {
    const saved = localStorage.getItem("axiomflow_personal_integrations");
    return saved
      ? JSON.parse(saved)
      : {
          telegramBotToken: null,
          gmailAccount: null,
        };
  });

  const [disconnectType, setDisconnectType] = useState<
    "telegram" | "gmail" | null
  >(null);

  useEffect(() => {
    localStorage.setItem(
      "axiomflow_personal_integrations",
      JSON.stringify(secrets),
    );
  }, [secrets]);

  const handleSaveTelegram = (token: string) => {
    setSecrets((prev) => ({ ...prev, telegramBotToken: token }));
  };

  const handleSaveGmail = (email: string) => {
    setSecrets((prev) => ({ ...prev, gmailAccount: email }));
  };

  const handleConfirmDisconnect = () => {
    if (disconnectType === "telegram") {
      setSecrets((prev) => ({ ...prev, telegramBotToken: null }));
    } else if (disconnectType === "gmail") {
      setSecrets((prev) => ({ ...prev, gmailAccount: null }));
    }
    setDisconnectType(null);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-primary">
      {/* View Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-primary tracking-tight">
            Personal Integrations & Secrets
          </h1>
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
            <FiLock className="w-3 h-3" />
            User Vault
          </span>
        </div>
        <p className="text-xs text-muted mt-1">
          Connect your individual communication channels. These credentials are
          tied exclusively to your account and never exposed across team
          workflows.
        </p>
      </div>

      {/* Security Privacy Notice */}
      <div className="bg-surface border border-accent-primary/20 rounded-xl p-4 flex items-start gap-3.5 shadow-sm">
        <div className="w-8 h-8 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center shrink-0 mt-0.5">
          <FiShield className="w-4 h-4" />
        </div>
        <div className="text-xs leading-relaxed">
          <h4 className="text-primary font-semibold">Isolated Employee Scope</h4>
          <p className="text-muted mt-0.5">
            Unlike global workflow templates which are shared across all team
            members, Telegram bot tokens and mailbox sync handles are strictly
            confidential to your profile. When you test or execute workflows
            containing personal triggers, the platform uses your private tokens.
          </p>
        </div>
      </div>

      {/* Integration Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <TelegramIntegrationCard
          botToken={secrets.telegramBotToken}
          onSaveToken={handleSaveTelegram}
          onDisconnect={() => setDisconnectType("telegram")}
        />

        <GmailIntegrationCard
          linkedEmail={secrets.gmailAccount}
          onSaveCredentials={handleSaveGmail}
          onDisconnect={() => setDisconnectType("gmail")}
        />
      </div>

      {/* Disconnect Confirmation Modal */}
      <ConfirmModal
        isOpen={Boolean(disconnectType)}
        title={
          disconnectType === "telegram"
            ? "Disconnect Telegram Bot"
            : "Unlink Gmail Account"
        }
        message={
          disconnectType === "telegram"
            ? "Are you sure you want to remove your personal Telegram bot token? Workflows that rely on your bot commands will stop responding."
            : "Are you sure you want to unlink your Gmail account? Automated inbound email triggers will no longer fetch messages from your inbox."
        }
        confirmLabel="Disconnect"
        cancelLabel="Keep Integration"
        variant="danger"
        onConfirm={handleConfirmDisconnect}
        onCancel={() => setDisconnectType(null)}
      />
    </div>
  );
};

export default IntegrationsView;
