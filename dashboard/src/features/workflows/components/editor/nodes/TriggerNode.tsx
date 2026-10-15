import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiCopy, FiCheck, FiZap } from "react-icons/fi";
import { NODE_REGISTRY } from "../../../constants/NodeRegistry";

export interface CanvasNodeData {
  id: string;
  type: string;
  position: { x: number; y: number };
  config?: Record<string, any>;
}

interface TriggerNodeProps {
  node: CanvasNodeData;
  scale: number;
  onUpdateSize?: (id: string, width: number, height: number) => void;
  onUpdatePosition: (id: string, newPos: { x: number; y: number }) => void;
  onStartConnection: (
    nodeId: string,
    portType: "output",
    startPos: { x: number; y: number },
    color: string,
  ) => void;
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
}

export const TriggerNode: React.FC<TriggerNodeProps> = ({
  node,
  scale,
  onUpdateSize, // 👈 Destructured properly
  onUpdatePosition,
  onStartConnection,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Lookup node definition from NODE_REGISTRY
  const definition = useMemo(() => {
    return (
      NODE_REGISTRY.find((item) => item.type === node.type) || {
        title: "Trigger",
        badge: "EVENT",
        icon: FiZap,
      }
    );
  }, [node.type]);

  const IconComponent = definition.icon;
  const title = definition.title;
  const badge = definition.badge || "EVENT";

  const handleCopy = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Node Dragging Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      (e.target as HTMLElement).closest(
        "button, input, select, .connection-handle",
      )
    ) {
      return;
    }
    e.stopPropagation();

    setIsDraggingNode(true);
    setDragOffset({
      x: e.clientX / scale - node.position.x,
      y: e.clientY / scale - node.position.y,
    });
    onDragStart?.(node.id);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDraggingNode) return;
    onUpdatePosition(node.id, {
      x: e.clientX / scale - dragOffset.x,
      y: e.clientY / scale - dragOffset.y,
    });
    onDragMove?.(e.clientX, e.clientY);
  };

  const handleMouseUp = (e: MouseEvent) => {
    if (!isDraggingNode) return;
    setIsDraggingNode(false);
    onDragEnd?.(node.id, e.clientX, e.clientY);
  };

  // Measure rendered dimensions using ResizeObserver
  useEffect(() => {
    const el = nodeRef.current;
    if (!el || !onUpdateSize) return;

    onUpdateSize(node.id, el.offsetWidth, el.offsetHeight);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        onUpdateSize(node.id, Math.round(width), Math.round(height));
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [node.id, onUpdateSize]);

  useEffect(() => {
    if (isDraggingNode) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDraggingNode, dragOffset, scale]);

  // Port Cable Connection Handler
  const handlePortMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentWidth = nodeRef.current ? nodeRef.current.offsetWidth : 260;
    const portWorldX = node.position.x + currentWidth;
    const portWorldY = node.position.y + 32; // Center-height of h-16 (64px / 2)
    onStartConnection(
      node.id,
      "output",
      { x: portWorldX, y: portWorldY },
      "#fbbf24",
    );
  };

  // Dynamic Trigger Content Renderer
  const renderTriggerContent = () => {
    switch (node.type) {
      case "trigger-webhook": {
        const webhookUrl = `https://api.axiomflow.internal/v1/hooks/${node.id.slice(-6)}`;
        return (
          <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
            <span className="text-[10px] text-slate-400 font-mono">
              /v1/hooks/{node.id.slice(-6)}
            </span>
            <button
              type="button"
              onClick={(e) => handleCopy(webhookUrl, e)}
              className="text-slate-400 hover:text-amber-400 transition-colors p-0.5"
              title="Copy Webhook URL"
            >
              {copied ? (
                <FiCheck className="w-3 h-3 text-emerald-400" />
              ) : (
                <FiCopy className="w-3 h-3" />
              )}
            </button>
          </div>
        );
      }

      case "trigger-cron":
        return (
          <div className="flex items-center gap-2 mt-0.5 whitespace-nowrap">
            <span className="text-[10px] text-amber-300 font-mono font-medium">
              {node.config?.cronExpression || "0 9 * * 1-5"}
            </span>
            <span className="text-[10px] text-slate-400">
              ({node.config?.humanTime || "Every weekday @ 9:00 AM"})
            </span>
          </div>
        );

      case "trigger-email": {
        const inbox = node.config?.inbox || "inbound@app.axiomflow.io";
        return (
          <div className="flex items-center gap-1.5 mt-0.5 whitespace-nowrap">
            <span className="text-[10px] text-slate-400 font-mono">
              {inbox}
            </span>
            <button
              type="button"
              onClick={(e) => handleCopy(inbox, e)}
              className="text-slate-400 hover:text-amber-400 transition-colors p-0.5"
              title="Copy Inbox Address"
            >
              {copied ? (
                <FiCheck className="w-3 h-3 text-emerald-400" />
              ) : (
                <FiCopy className="w-3 h-3" />
              )}
            </button>
          </div>
        );
      }

      case "trigger-telegram":
        return (
          <div className="flex items-center gap-1 mt-0.5 whitespace-nowrap">
            <span className="text-[10px] text-slate-400 font-mono">
              {node.config?.command || "/start, /alert, text"}
            </span>
          </div>
        );

      default:
        return (
          <span className="text-[10px] text-slate-500 whitespace-nowrap">
            Listening for events
          </span>
        );
    }
  };

  return (
    <div
      ref={nodeRef}
      onMouseDown={handleMouseDown}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        position: "absolute",
      }}
      className={`w-max min-w-[240px] h-16 bg-[#0f172a] border border-amber-500/40 rounded-l-2xl rounded-r-full shadow-xl select-none flex items-center pl-3.5 pr-10 relative ${
        isDraggingNode
          ? "cursor-grabbing ring-2 ring-amber-500/50 shadow-amber-500/20"
          : "cursor-grab hover:border-amber-500/70 hover:shadow-lg transition-shadow"
      }`}
    >
      {/* Icon Badge */}
      <div className="h-9 w-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0 mr-3">
        <IconComponent className="w-4 h-4" />
      </div>

      {/* Main Info */}
      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-xs font-semibold text-white tracking-wide">
            {title}
          </span>
          <span className="text-[9px] font-mono text-amber-400/90 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 shrink-0">
            {badge}
          </span>
        </div>
        {renderTriggerContent()}
      </div>

      {/* Output Port Dot */}
      <div
        data-port-id={`${node.id}-output`}
        onMouseDown={handlePortMouseDown}
        title="Drag connection wire to next node"
        className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-amber-400 border-3 border-[#0b0f19] hover:scale-125 hover:bg-amber-300 transition-transform cursor-crosshair shadow-md shadow-amber-400/50 z-30"
      />
    </div>
  );
};

export default TriggerNode;
