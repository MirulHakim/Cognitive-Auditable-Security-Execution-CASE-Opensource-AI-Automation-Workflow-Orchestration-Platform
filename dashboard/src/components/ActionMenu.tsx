import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ActionMenuOption {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  variant?: "default" | "danger";
}

interface ActionMenuModalProps {
  isOpen: boolean;
  position: { top: number; left: number };
  onClose: () => void;
  options: ActionMenuOption[];
}

export const ActionMenu: React.FC<ActionMenuModalProps> = ({
  isOpen,
  position,
  onClose,
  options,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close here if clicking a trigger button; let the button toggle itself
      if (target.closest("[data-action-trigger]")) {
        return;
      }

      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    // Close on scroll to prevent the fixed element from detaching
    const handleScroll = () => {
      onClose();
    };

    document.addEventListener("click", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    window.addEventListener("scroll", handleScroll, true);

    return () => {
      document.removeEventListener("click", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Viewport clamping to prevent the menu from overflowing off-screen
  const menuWidth = 160; // w-40 = 10rem = 160px
  const menuHeight = options.length * 36 + 16;
  const clampedLeft = Math.min(
    position.left,
    window.innerWidth - menuWidth - 8,
  );
  const clampedTop = Math.min(
    position.top,
    window.innerHeight - menuHeight - 8,
  );

  const defaultOptions = options.filter((opt) => opt.variant !== "danger");
  const dangerOptions = options.filter((opt) => opt.variant === "danger");

  const menuContent = (
    <div
      ref={menuRef}
      role="menu"
      style={{
        position: "fixed",
        top: `${Math.max(8, clampedTop)}px`,
        left: `${Math.max(8, clampedLeft)}px`,
      }}
      className="w-40 bg-surface border border-subtle rounded-lg shadow-2xl z-50 py-1 divide-y divide-subtle/60 animate-in fade-in zoom-in-95 duration-100"
    >
      {defaultOptions.length > 0 && (
        <div className="py-1">
          {defaultOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  opt.onClick();
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-secondary hover:text-primary hover:bg-surface-sunken transition-colors text-left"
              >
                <Icon className="w-3.5 h-3.5 text-muted" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {dangerOptions.length > 0 && (
        <div className="py-1">
          {dangerOptions.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.label}
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  opt.onClick();
                  onClose();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-danger hover:bg-danger-fill-hover/10 transition-colors text-left"
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return typeof document !== "undefined"
    ? createPortal(menuContent, document.body)
    : menuContent;
};

export default ActionMenu;
