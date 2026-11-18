import React, { useState } from "react";
import { FiX, FiLock, FiEye, FiEyeOff } from "react-icons/fi";

interface SecretInputModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  onClose: () => void;
  /** Rejects on failure so the modal can stay open and show the error. */
  onSubmit: (secretValue: string) => Promise<void> | void;
}

export const SecretInputModal: React.FC<SecretInputModalProps> = ({
  isOpen,
  title,
  description,
  inputLabel,
  placeholder,
  onClose,
  onSubmit,
}) => {
  const [value, setValue] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clear the plaintext on every dismissal path, without an effect that would
  // trigger a cascading render.
  const handleClose = () => {
    setValue("");
    setShowSecret(false);
    setError(null);
    setIsSubmitting(false);
    onClose();
  };

  if (!isOpen) return null;

  // The plaintext leaves this component once, over TLS, to the gateway. The
  // gateway seals it with AES-256-GCM; the browser never receives it back.
  // Nothing is persisted in localStorage, and state is cleared on success.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const secret = value.trim();
    if (!secret || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(secret);
      handleClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not save the credential.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
              <FiLock className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 flex flex-col gap-4 text-xs"
        >
          <p className="text-muted leading-relaxed">{description}</p>

          {error && (
            <p
              role="alert"
              className="text-[11px] text-danger bg-danger/10 border border-danger/20 rounded-lg px-3 py-2"
            >
              {error}
            </p>
          )}

          <div>
            <label className="block text-secondary font-medium mb-1.5">
              {inputLabel}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                required
                value={value}
                disabled={isSubmitting}
                onChange={(e) => setValue(e.target.value)}
                autoComplete="off"
                placeholder={placeholder}
                className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary font-mono placeholder:text-faint focus:outline-none focus:border-accent-primary/50 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-faint hover:text-secondary"
              >
                {showSecret ? (
                  <FiEyeOff className="w-4 h-4" />
                ) : (
                  <FiEye className="w-4 h-4" />
                )}
              </button>
            </div>
            <span className="text-[10px] text-faint mt-1 block">
              Stored securely in your private workspace vault. Not shared with
              team members.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-subtle">
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="px-3.5 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40 disabled:opacity-60"
            >
              {isSubmitting ? "Encrypting…" : "Save Credentials"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SecretInputModal;
