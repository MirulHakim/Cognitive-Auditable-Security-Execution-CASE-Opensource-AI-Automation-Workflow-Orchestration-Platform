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
          iconColor: "text-rose-400",
          iconBg: "bg-rose-500/10 border-rose-500/20",
          btnColor:
            "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50",
        };
      case "warning":
        return {
          iconColor: "text-amber-400",
          iconBg: "bg-amber-500/10 border-amber-500/20",
          btnColor:
            "bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-950/50",
        };
      case "info":
      default:
        return {
          iconColor: "text-cyan-400",
          iconBg: "bg-cyan-500/10 border-cyan-500/20",
          btnColor:
            "bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-cyan-950/50",
        };
    }
  };

  const styles = getVariantStyles();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-7 h-7 rounded-lg border flex items-center justify-center ${styles.iconBg} ${styles.iconColor}`}
            >
              <FiAlertTriangle className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          <p className="text-xs text-slate-300 leading-relaxed">{message}</p>
        </div>

        <div className="px-5 py-3.5 bg-slate-900/40 border-t border-slate-800 flex items-center justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors font-medium"
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
