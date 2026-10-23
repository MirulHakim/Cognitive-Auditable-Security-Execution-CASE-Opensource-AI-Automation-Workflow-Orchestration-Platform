import React, { useState } from "react";
import {
  FiMail,
  FiCheckCircle,
  FiTrash2,
  FiRefreshCw,
  FiLock,
} from "react-icons/fi";
import SecretInputModal from "./SecretInputModal";

interface GmailIntegrationCardProps {
  linkedEmail: string | null;
  onSaveCredentials: (email: string) => void;
  onDisconnect: () => void;
}

// UI-REGION: Gmail integration card — link/unlink states for the user's
// personal mailbox sync handle.
export const GmailIntegrationCard: React.FC<GmailIntegrationCardProps> = ({
  linkedEmail,
  onSaveCredentials,
  onDisconnect,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const isConnected = Boolean(linkedEmail);

  // TODO[BACKEND]: The1.5s sync result below is mocked — replace with
  // GET /api/integrations/gmail/status so the backend verifies IMAP/Gmail
  // API access with the stored credential and reports the real listener
  // state; linking should ultimately use Google OAuth with the gmail.readonly
  // scope instead of a typed handle.
  const handleTestInboxSync = () => {
    setIsCheckingSync(true);
    setSyncStatus(null);
    setTimeout(() => {
      setIsCheckingSync(false);
      setSyncStatus(
        "Inbox reader active. Listening for trigger events via IMAP/Gmail API.",
      );
      setTimeout(() => setSyncStatus(null), 4000);
    }, 1500);
  };

  return (
    <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-danger/10 border border-danger/20 text-danger flex items-center justify-center shrink-0">
              <FiMail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-primary">
                  Gmail / Google Workspace
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    isConnected
                      ? "bg-success/10 text-success border-success/20"
                      : "bg-surface-hover text-muted border-strong"
                  }`}
                >
                  {isConnected ? "Linked" : "Disconnected"}
                </span>
              </div>
              <p className="text-xs text-muted mt-0.5">
                Allows personal email trigger nodes to detect inbound messages
                and parse triage attachments.
              </p>
            </div>
          </div>
        </div>

        {/* Status block */}
        <div className="mt-4 p-3 bg-background border border-subtle/80 rounded-lg text-xs space-y-1">
          {isConnected ? (
            <div className="flex items-center justify-between">
              <span className="text-muted font-mono">Linked Inbox:</span>
              <span className="font-mono text-accent-primary font-medium">
                {linkedEmail}
              </span>
            </div>
          ) : (
            <p className="text-faint text-[11px]">
              No mailbox linked. Connect your work Gmail account or App Password
              to enable email-driven triggers.
            </p>
          )}

          {syncStatus && (
            <p className="text-[11px] text-success flex items-center gap-1.5 pt-1 border-t border-subtle">
              <FiCheckCircle className="w-3.5 h-3.5" />
              {syncStatus}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-subtle/80 text-xs">
        <span className="text-[11px] text-faint flex items-center gap-1">
          <FiLock className="w-3 h-3 text-muted" />
          Read-only metadata scopes
        </span>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={handleTestInboxSync}
                disabled={isCheckingSync}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-strong hover:bg-surface-hover text-secondary transition-colors font-medium disabled:opacity-50"
              >
                <FiRefreshCw
                  className={`w-3 h-3 ${isCheckingSync ? "animate-spin" : ""}`}
                />
                <span>{isCheckingSync ? "Verifying..." : "Check Sync"}</span>
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="p-1.5 rounded-lg border border-danger/20 bg-danger/10 text-danger hover:bg-danger-fill-hover/20 transition-colors"
                title="Unlink Gmail Account"
              >
                <FiTrash2 className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
            >
              <FiMail className="w-3.5 h-3.5" />
              <span>Connect Inbox</span>
            </button>
          )}
        </div>
      </div>

      <SecretInputModal
        isOpen={isModalOpen}
        title="Connect Personal Gmail"
        description="Enter your Google Workspace email address or App Password. This grants permission only to read inbound notifications configured in your personal email trigger nodes."
        inputLabel="Google Account Email / App Password"
        placeholder="your.name@company.com"
        onClose={() => setIsModalOpen(false)}
        onSubmit={onSaveCredentials}
      />
    </div>
  );
};

export default GmailIntegrationCard;
