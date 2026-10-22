import React from "react";
import { FiAlertTriangle, FiX } from "react-icons/fi";

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  const getVariantStyles = () => {
    switch (variant) {
      case "danger":
        return {
          iconColor: "text-danger",
          iconBg: "bg-danger/10 border-danger/20",
          btnColor:
            "bg-danger-fill hover:bg-danger-fill-hover text-white shadow-danger/20",
        };
      case "warning":
        return {
          iconColor: "text-warning",
          iconBg: "bg-warning/10 border-warning/20",
          btnColor:
            "bg-warning-fill hover:bg-warning-fill-hover text-accent-contrast shadow-warning/20",
        };
      case "info":
      default:
        return {
          iconColor: "text-accent-primary",
          iconBg: "bg-accent-primary/10 border-accent-primary/20",
          btnColor:
            "bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast shadow-accent-primary/40",
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface border border-subtle rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-7 h-7 rounded-lg border flex items-center justify-center ${styles.iconBg} ${styles.iconColor}`}
            >
              <FiAlertTriangle className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-primary">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted hover:text-primary p-1 rounded-lg hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-secondary leading-relaxed">{message}</p>
        </div>

        <div className="px-5 py-3.5 bg-surface-sunken/40 border-t border-subtle flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg border border-strong text-secondary hover:bg-surface-hover transition-colors font-medium"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3.5 py-1.5 rounded-lg font-semibold transition-colors shadow-sm ${styles.btnColor}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
