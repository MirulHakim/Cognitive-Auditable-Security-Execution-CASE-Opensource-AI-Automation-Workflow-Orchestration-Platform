import React, { useState, useEffect } from "react";
import { FiX, FiEdit3 } from "react-icons/fi";

interface RenameModalProps {
  isOpen: boolean;
  /** Dialog heading — defaults to "Rename Workflow". */
  title?: string;
  /** Name seeded into the input when the dialog opens. */
  initialValue: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}

/** Shared rename dialog — single trimmed text input, Enter saves, Escape closes. */
export const RenameModal: React.FC<RenameModalProps> = ({
  isOpen,
  title = "Rename Workflow",
  initialValue,
  onSubmit,
  onCancel,
}) => {
  // Draft seeds from `initialValue` at mount — callers mount the dialog
  // per-open (see WorkflowTable) so it always starts from the current name.
  const [value, setValue] = useState(initialValue);

  // Escape closes the dialog from anywhere.
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-subtle rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center">
              <FiEdit3 className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close rename dialog"
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 flex flex-col gap-4 text-xs"
        >
          <div>
            <label className="block text-secondary font-medium mb-1.5">
              Workflow Name
            </label>
            <input
              type="text"
              autoFocus
              required
              value={value}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. Weekly Orders Summary"
              className="w-full bg-background border border-subtle rounded-lg px-3 py-2 text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-accent-contrast font-semibold transition-colors shadow-sm shadow-accent-primary/40"
            >
              Save Name
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RenameModal;
