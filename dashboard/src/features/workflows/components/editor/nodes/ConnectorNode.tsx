import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiShare2 } from "react-icons/fi";
import {
  NODE_REGISTRY,
  type ConnectorConfig,
  type ConnectorService,
} from "../../../constants/NodeRegistry";
import type { CanvasNodeData } from "./TriggerNode";

interface ConnectorNodeProps {
  node: CanvasNodeData;
  scale: number;
  onUpdateSize?: (id: string, width: number, height: number) => void;
  onUpdatePosition: (id: string, newPos: { x: number; y: number }) => void;
  onUpdateConfig?: (id: string, patch: Record<string, unknown>) => void;
  onStartConnection: (
    nodeId: string,
    portType: string,
    startPos: { x: number; y: number },
    color: string,
  ) => void;
  onConnectTarget?: (targetNodeId: string, targetPort: string) => void;
  onTargetPortMouseDown?: (
    e: React.MouseEvent,
    targetNodeId: string,
    targetPort: string,
  ) => void;
  /** Converts screen coordinates (e.g. from a port's getBoundingClientRect)
   *  into canvas/world coordinates using the editor's transform state. */
  toCanvasCoords: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
  onOpenSettings?: (nodeId: string) => void;
  /** Bi-directional port: LIFO-detaches the newest wire if any are attached,
   *  otherwise starts a fresh wire from this port. Handled by the editor. */
  onBiDiPortMouseDown?: (
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    color: string,
  ) => void;
}

/* Brand styling per external service. Every value is a literal Tailwind
   class string so the scanner emits them; portVar is a runtime CSS var. */
interface ServiceMeta {
  chip: string;
  label: string;
  border: string;
  hoverBorder: string;
  ring: string;
  portBorder: string;
  portVar: string;
}

const SERVICE_META: Record<ConnectorService, ServiceMeta> = {
  gmail: {
    chip: "text-danger bg-danger/10 border-danger/20",
    label: "GMAIL",
    border: "border-danger/40",
    hoverBorder: "hover:border-danger",
    ring: "ring-2 ring-danger/40 shadow-danger/20",
    portBorder: "border-danger",
    portVar: "var(--danger)",
  },
  telegram: {
    chip: "text-info bg-info/10 border-info/20",
    label: "TELEGRAM",
    border: "border-info/40",
    hoverBorder: "hover:border-info",
    ring: "ring-2 ring-info/40 shadow-info/20",
    portBorder: "border-info",
    portVar: "var(--info)",
  },
  "rest-api": {
    chip: "text-success bg-success/10 border-success/20",
    label: "REST API",
    border: "border-success/40",
    hoverBorder: "hover:border-success",
    ring: "ring-2 ring-success/40 shadow-success/20",
    portBorder: "border-success",
    portVar: "var(--success)",
  },
  docs: {
    chip: "text-success bg-success/10 border-success/20",
    label: "FILES",
    border: "border-success/40",
    hoverBorder: "hover:border-success",
    ring: "ring-2 ring-success/40 shadow-success/20",
    portBorder: "border-success",
    portVar: "var(--success)",
  },
};

/* Plain-English subtitle per service — shown on the compact canvas card.
   Gmail and Telegram are terminal actions (end of the execution chain). */
const SERVICE_SUBTITLE: Record<ConnectorService, string> = {
  gmail: "Send Email",
  telegram: "Send Message",
  "rest-api": "Send data to an external API",
  docs: "Reads files from a folder",
};

export const ConnectorNode: React.FC<ConnectorNodeProps> = ({
  node,
  scale,
  onUpdateSize,
  onUpdatePosition,
  onConnectTarget,
  onTargetPortMouseDown,
  onOpenSettings,
  onBiDiPortMouseDown,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const definition = useMemo(() => {
    return (
      NODE_REGISTRY.find((item) => item.type === node.type) || {
        title: "Connector",
        description: "",
        icon: FiShare2,
      }
    );
  }, [node.type]);

  const config = (node.config ?? {}) as Partial<ConnectorConfig>;
  const service: ConnectorService = config.service ?? "rest-api";
  const meta = SERVICE_META[service] ?? SERVICE_META["rest-api"];
  const operation = config.operation ?? "";
  // Tools (REST, Document Reader) report up to an AI agent via a
  // top-center bi-directional port instead of left-to-right side ports.
  const isTool = service === "rest-api" || service === "docs";
  // Gmail / Telegram end the execution chain: input only, no output.
  const isTerminal = service === "gmail" || service === "telegram";
  const IconComponent = definition.icon;
  const subtitle =
    definition.description || operation || SERVICE_SUBTITLE[service];

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

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenSettings?.(node.id);
  };

  useEffect(() => {
    if (!isDraggingNode) return;

    const handleMouseMove = (e: MouseEvent) => {
      onUpdatePosition(node.id, {
        x: e.clientX / scale - dragOffset.x,
        y: e.clientY / scale - dragOffset.y,
      });
      onDragMove?.(e.clientX, e.clientY);
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDraggingNode(false);
      onDragEnd?.(node.id, e.clientX, e.clientY);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [
    isDraggingNode,
    dragOffset,
    scale,
    node.id,
    onUpdatePosition,
    onDragMove,
    onDragEnd,
  ]);

  // Measure rendered dimensions using ResizeObserver (port fallback coords)
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

  // Pixel-perfect port reference: read the port dot's live screen rect and
  // convert it into world coordinates through the editor's transform.
  const handleToolPortDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onBiDiPortMouseDown?.(e, node.id, "tool", meta.portVar);
  };

  return (
    <div
      ref={nodeRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        position: "absolute",
      }}
      className={`w-[240px] select-none relative rounded-xl border-2 bg-surface shadow-xl transition-colors duration-200 ${
        isDraggingNode
          ? `cursor-grabbing ${meta.ring}`
          : `cursor-grab ${meta.border} ${meta.hoverBorder} hover:shadow-lg`
      }`}
      title="Double-click to open settings"
    >
      {/* Compact header: branded icon + title + plain-English subtitle */}
      <div className="flex items-center gap-2.5 pl-4 pr-3 py-3">
        <div
          className={`h-9 w-9 rounded-lg border flex items-center justify-center shrink-0 ${meta.chip}`}
        >
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary tracking-wide truncate">
            {definition.title}
          </div>
          <div className="text-[10px] text-muted truncate">{subtitle}</div>
        </div>
        {isTerminal && (
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${meta.chip}`}
          >
            END
          </span>
        )}
      </div>

      {/* Supported-format badge — Document Reader only (subtle, below header) */}
      {service === "docs" && (
        <div className="px-4 pb-3 -mt-1">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-subtle bg-surface-sunken/60 text-muted">
            PDF, DOCX, XLSX
          </span>
        </div>
      )}

      {/* Tool port (REST / Document Reader): single bi-directional port at the
          top-center — pairs with an AI agent's bottom tool hub. */}
      {isTool && (
        <div
          data-port-id={`${node.id}-tool`}
          onMouseDown={handleToolPortDown}
          onMouseUp={(e) => {
            e.stopPropagation();
            onConnectTarget?.(node.id, "tool");
          }}
          title="Tool port — pairs with an AI agent's tool port; drag out to detach the newest wire (LIFO)"
          className={`connection-handle absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 hover:scale-125 transition-transform cursor-pointer z-30 shadow-md ${meta.portBorder}`}
        />
      )}

      {/* Input port — terminal nodes only (Gmail / Telegram end the chain).
          Mouse-up connects, mouse-down detaches newest wire (LIFO). */}
      {isTerminal && (
        <div
          data-port-id={`${node.id}-input`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onTargetPortMouseDown?.(e, node.id, "input");
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
            onConnectTarget?.(node.id, "input");
          }}
          title="Input port — drag out to detach the newest wire (LIFO)"
          className={`connection-handle absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 hover:scale-125 transition-transform cursor-pointer z-30 shadow-md ${meta.portBorder}`}
        />
      )}
    </div>
  );
};

export default ConnectorNode;
