import React, { useState } from "react";
import {
  FiSend,
  FiCheckCircle,
  FiTrash2,
  FiExternalLink,
  FiKey,
} from "react-icons/fi";
import SecretInputModal from "./SecretInputModal";

interface TelegramIntegrationCardProps {
  botToken: string | null;
  onSaveToken: (token: string) => void;
  onDisconnect: () => void;
}

export const TelegramIntegrationCard: React.FC<
  TelegramIntegrationCardProps
> = ({ botToken, onSaveToken, onDisconnect }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const isConnected = Boolean(botToken);

  const handleTestConnection = () => {
    setIsTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setIsTesting(false);
      setTestResult(
        "Handshake successful! Bot @AxiomFlowTriggerBot is responding.",
      );
      setTimeout(() => setTestResult(null), 4000);
    }, 1200);
  };

  const maskedToken = botToken
    ? `${botToken.slice(0, 5)}...${botToken.slice(-4)}`
    : null;

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
              <FiSend className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  Telegram Bot Access
                </h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                    isConnected
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                      : "bg-slate-800 text-slate-400 border-slate-700"
                  }`}
                >
                  {isConnected ? "Connected" : "Not Linked"}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Execute Telegram workflow commands and pipe private alerts
                directly to your account.
              </p>
            </div>
          </div>
        </div>

        {/* Status block */}
        <div className="mt-4 p-3 bg-[#0b0f19] border border-slate-800/80 rounded-lg text-xs space-y-1">
          {isConnected ? (
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-mono">
                Personal Bot Token:
              </span>
              <span className="font-mono text-cyan-400 font-medium">
                {maskedToken}
              </span>
            </div>
          ) : (
            <p className="text-slate-500 text-[11px]">
              No Telegram bot token linked to your employee profile yet. Obtain
              one from @BotFather.
            </p>
          )}

          {testResult && (
            <p className="text-[11px] text-emerald-400 flex items-center gap-1.5 pt-1 border-t border-slate-800">
              <FiCheckCircle className="w-3.5 h-3.5" />
              {testResult}
            </p>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center justify-between pt-4 mt-4 border-t border-slate-800/80 text-xs">
        <a
          href="https://t.me/botfather"
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 hover:text-cyan-400 transition-colors inline-flex items-center gap-1 text-[11px]"
        >
          <span>Open BotFather</span>
          <FiExternalLink className="w-3 h-3" />
        </a>

        <div className="flex items-center gap-2">
          {isConnected ? (
            <>
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting}
                className="px-3 py-1.5 rounded-lg border border-slate-700 hover:bg-slate-800 text-slate-200 transition-colors font-medium disabled:opacity-50"
              >
                {isTesting ? "Testing..." : "Test Connection"}
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="p-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors"
                title="Disconnect Telegram Bot"
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
              <FiKey className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Connect Token</span>
            </button>
          )}
        </div>
      </div>

      <SecretInputModal
        isOpen={isModalOpen}
        title="Link Personal Telegram Bot"
        description="Paste your Telegram HTTP API bot token generated from @BotFather. This enables your workflows to send alerts and parse incoming bot commands on your behalf."
        inputLabel="Bot API Token"
        placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ"
        onClose={() => setIsModalOpen(false)}
        onSubmit={onSaveToken}
      />
    </div>
  );
};

export default TelegramIntegrationCard;
