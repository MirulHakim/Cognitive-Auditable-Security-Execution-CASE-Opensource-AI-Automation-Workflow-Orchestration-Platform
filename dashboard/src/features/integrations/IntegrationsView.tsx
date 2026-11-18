import React, { useEffect, useState } from "react";
import { FiShield, FiLock, FiAlertCircle, FiRefreshCw } from "react-icons/fi";
import TelegramIntegrationCard from "./components/TelegramIntegrationCard";
import GmailIntegrationCard from "./components/GmailIntegrationCard";
import ConfirmModal from "../../components/ConfirmModal";
import {
  connectVaultSecret,
  disconnectVaultSecret,
  errorMessage,
  getVaultStatus,
} from "../../api/client";
import type { VaultProvider, VaultStatus } from "../../api/types";

const EMPTY_STATUS: VaultStatus = { telegram: false, gmail: false };

/**
 * Personal integrations are write-only from the browser's point of view:
 *  - GET /api/auth/vault returns connection booleans, never the credential;
 *  - POST seals the pasted value with AES-256-GCM in the gateway;
 *  - DELETE removes the row.
 *
 * No secret is written to localStorage or kept in React state after submit.
 */
export const IntegrationsView: React.FC = () => {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [disconnectType, setDisconnectType] = useState<VaultProvider | null>(
    null,
  );
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getVaultStatus()
      .then((next) => {
        if (cancelled) return;
        setStatus(next);
        setLoadError(null);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retryLoad = () => {
    setIsLoading(true);
    setReloadKey((key) => key + 1);
  };

  const handleConnect = async (provider: VaultProvider, secret: string) => {
    setActionError(null);
    try {
      const result = await connectVaultSecret(provider, secret);
      setStatus((previous) => ({
        ...(previous ?? EMPTY_STATUS),
        [provider]: result.connected,
      }));
    } catch (error) {
      // Rethrown so the modal stays open and renders the server's message.
      if (error instanceof Error) throw error;
      throw new Error("Could not save the credential.", { cause: error });
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectType || isDisconnecting) return;
    const provider = disconnectType;
    setIsDisconnecting(true);
    setActionError(null);
    try {
      await disconnectVaultSecret(provider);
      setStatus((previous) => ({
        ...(previous ?? EMPTY_STATUS),
        [provider]: false,
      }));
      setDisconnectType(null);
    } catch (error) {
      setActionError(errorMessage(error));
      setDisconnectType(null);
    } finally {
      setIsDisconnecting(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto text-primary">
      {/* View Header */}
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold text-primary tracking-tight">
            Personal Integrations &amp; Secrets
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
            members, Telegram bot tokens and mailbox credentials are strictly
            confidential to your profile. Each value is encrypted with
            AES-256-GCM before it reaches PostgreSQL and is write-only: not
            even you can read it back from this page. Workflows use your private
            credentials only at execution time.
          </p>
        </div>
      </div>

      {loadError && (
        <div
          role="alert"
          className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-3 flex items-center justify-between gap-3 text-xs"
        >
          <span className="text-danger flex items-center gap-2">
            <FiAlertCircle className="w-4 h-4 shrink-0" />
            {loadError}
          </span>
          <button
            type="button"
            onClick={retryLoad}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-danger/20 text-danger hover:bg-danger/10 font-medium"
          >
            <FiRefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="bg-danger/10 border border-danger/20 rounded-xl px-4 py-3 text-xs text-danger flex items-center gap-2"
        >
          <FiAlertCircle className="w-4 h-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* Integration Cards Grid */}
      {isLoading && !status ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="bg-surface border border-subtle rounded-xl p-5 shadow-sm min-h-[210px] animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-surface-hover" />
                <div className="space-y-2">
                  <div className="h-3 w-40 rounded bg-surface-hover" />
                  <div className="h-2.5 w-56 rounded bg-surface-hover" />
                </div>
              </div>
              <div className="mt-5 h-16 rounded-lg bg-background border border-subtle/80" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <TelegramIntegrationCard
            connected={status?.telegram ?? false}
            onSaveToken={(token) => handleConnect("telegram", token)}
            onDisconnect={() => {
              setActionError(null);
              setDisconnectType("telegram");
            }}
          />

          <GmailIntegrationCard
            connected={status?.gmail ?? false}
            onSaveCredentials={(credential) => handleConnect("gmail", credential)}
            onDisconnect={() => {
              setActionError(null);
              setDisconnectType("gmail");
            }}
          />
        </div>
      )}

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
        confirmLabel={isDisconnecting ? "Disconnecting…" : "Disconnect"}
        cancelLabel="Keep Integration"
        variant="danger"
        onConfirm={() => void handleConfirmDisconnect()}
        onCancel={() => {
          if (!isDisconnecting) setDisconnectType(null);
        }}
      />
    </div>
  );
};

export default IntegrationsView;
