import React, { useState } from "react";
import { FiX, FiLock, FiEye, FiEyeOff } from "react-icons/fi";

interface SecretInputModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  inputLabel: string;
  placeholder: string;
  onClose: () => void;
  onSubmit: (secretValue: string) => void;
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

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    onSubmit(value.trim());
    setValue("");
    onClose();
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
            onClick={onClose}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 flex flex-col gap-4 text-xs"
        >
          <p className="text-muted leading-relaxed">{description}</p>

          <div>
            <label className="block text-secondary font-medium mb-1.5">
              {inputLabel}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
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
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
            >
              Save Credentials
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SecretInputModal;
