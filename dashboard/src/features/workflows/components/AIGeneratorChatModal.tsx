import React, { useState, useRef, useEffect } from "react";
import { FiX, FiStar, FiSend, FiExternalLink } from "react-icons/fi";

interface AIGeneratorChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Routes into the canvas — called by the AI's "Open in Workflow Builder" action. */
  onOpenBuilder?: (workflowId?: string) => void;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** Renders the "[Open in Workflow Builder]" action on the mock AI reply. */
  showOpenAction?: boolean;
}

/** Workflow id handed back by the prototype generator. */
const MOCK_AI_WORKFLOW_ID = "mock-ai-generated-id";

export const AIGeneratorChatModal: React.FC<AIGeneratorChatModalProps> = ({
  isOpen,
  onClose,
  onOpenBuilder,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      text: "Hi — describe the workflow you want to build and I'll draft it on your local LLaMA 3 engine.",
    },
  ]);
  const [draft, setDraft] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);

  // Escape closes the chat (mirrors the Node Library modal).
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Safety: never leave a pending typing timer behind on unmount.
  useEffect(
    () => () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
    },
    [],
  );

  // Keep the newest message in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping]);

  if (!isOpen) return null;

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || isTyping) return;

    setMessages((prev) => [...prev, { id: Date.now(), role: "user", text }]);
    setDraft("");
    setIsTyping(true);

    // Simulated 2-second generation delay, then the mock draft reply.
    typingTimerRef.current = window.setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: "assistant",
          text: "I've drafted a workflow based on your request.",
          showOpenAction: true,
        },
      ]);
      setIsTyping(false);
    }, 2000);
  };

  const handleOpenBuilder = () => {
    onClose();
    onOpenBuilder?.(MOCK_AI_WORKFLOW_ID);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Chat Panel */}
      <div className="relative w-full max-w-lg bg-surface border border-subtle rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 border-b border-subtle flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary">
              <FiStar className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-primary tracking-wide">
                Generate with AI
              </h2>
              <p className="text-[11px] text-muted">
                Describe a pipeline — your local LLaMA 3 engine drafts it.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close AI generator"
            className="p-1.5 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <FiX className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[240px]"
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={
                  message.role === "user"
                    ? "max-w-[80%] rounded-2xl rounded-br-md bg-accent-primary text-accent-contrast px-3.5 py-2 text-xs leading-relaxed"
                    : "max-w-[85%] rounded-2xl rounded-bl-md bg-surface-sunken border border-subtle text-secondary px-3.5 py-2 text-xs leading-relaxed"
                }
              >
                <p>{message.text}</p>
                {message.showOpenAction && (
                  <button
                    type="button"
                    onClick={handleOpenBuilder}
                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/30 text-accent-primary text-[11px] font-semibold transition-colors"
                  >
                    <FiExternalLink className="w-3 h-3" />
                    <span>Open in Workflow Builder</span>
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Simulated typing indicator */}
          {isTyping && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-surface-sunken border border-subtle px-3.5 py-2.5 flex items-center gap-1.5">
                {[0, 150, 300].map((delay) => (
                  <span
                    key={delay}
                    className="w-1.5 h-1.5 rounded-full bg-muted animate-bounce"
                    style={{ animationDelay: `${delay}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={handleSend}
          className="p-3 border-t border-subtle flex items-center gap-2 bg-surface-sunken/30"
        >
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. Read new invoices, classify with AI, approve over RM10k..."
            className="flex-1 min-w-0 bg-surface border border-subtle rounded-lg px-3 py-2 text-xs text-primary placeholder:text-faint focus:outline-none focus:border-accent-primary/50 transition-colors"
          />
          <button
            type="submit"
            disabled={!draft.trim() || isTyping}
            aria-label="Send message"
            className="shrink-0 w-9 h-9 rounded-lg bg-accent-primary hover:bg-accent-primary-hover disabled:opacity-40 disabled:cursor-not-allowed text-accent-contrast flex items-center justify-center transition-colors shadow-sm shadow-accent-primary/40"
          >
            <FiSend className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default AIGeneratorChatModal;
