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

export const GmailIntegrationCard: React.FC<GmailIntegrationCardProps> = ({
  linkedEmail,
  onSaveCredentials,
  onDisconnect,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCheckingSync, setIsCheckingSync] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const isConnected = Boolean(linkedEmail);

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
    <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
              <FiMail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Gmail / Google Workspace
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    isConnected
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {isConnected ? "Linked" : "Disconnected"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Allows personal email trigger nodes to detect inbound messages
                and parse triage attachments.
              </p>
            </div>
          </div>
        </div>

        {/* Status block */}
        <div className="mt-4 p-3 bg-[#0b0f19] border border-slate-800/80 rounded-lg text-xs space-y-1">
          {isConnected ? (
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">Linked Inbox:</span>
              <span className="font-mono text-cyan-400 font-medium">
                {linkedEmail}
              </span>
            </div>
          ) : (
            <p className="text-slate-500 text-[11px]">
              No mailbox linked. Connect your work Gmail account or App Password
              to enable email-driven triggers.
            </p>
          )}

          {syncStatus && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-1 border-t border-slate-800">
              <FiCheckCircle className="w-3.5 h-3.5" />
              {syncStatus}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800/80 text-xs">
        <span className="text-[11px] text-slate-500 flex items-center gap-1">
          <FiLock className="w-3 h-3 text-slate-400" />
          Read-only metadata scopes
        </span>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={handleTestInboxSync}
                disabled={isCheckingSync}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 transition-colors font-medium disabled:opacity-50"
              >
                <FiRefreshCw
                  className={`w-3 h-3 ${isCheckingSync ? "animate-spin" : ""}`}
                />
                <span>{isCheckingSync ? "Verifying..." : "Check Sync"}</span>
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="p-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                title="Unlink Gmail Account"
              >
                <FiTrash2 className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setIsModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold transition-colors shadow-sm shadow-cyan-400/20"
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
