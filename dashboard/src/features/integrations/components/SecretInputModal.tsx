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
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
              <FiLock className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-5 flex flex-col gap-4 text-xs"
        >
          <p className="text-slate-400 leading-relaxed">{description}</p>

          <div>
            <label className="block text-slate-300 font-medium mb-1.5">
              {inputLabel}
            </label>
            <div className="relative">
              <input
                type={showSecret ? "text" : "password"}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder}
                className="w-full bg-[#0b0f19] border border-slate-800 rounded-lg px-3 py-2 text-white font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500/50 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
              >
                {showSecret ? (
                  <FiEyeOff className="w-4 h-4" />
                ) : (
                  <FiEye className="w-4 h-4" />
                )}
              </button>
            </div>
            <span className="text-[10px] text-slate-500 mt-1 block">
              Stored securely in your private workspace vault. Not shared with
              team members.
            </span>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold transition-colors shadow-sm shadow-cyan-400/20"
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
