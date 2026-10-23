import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiFileText } from "react-icons/fi";
import { NODE_REGISTRY } from "../../../constants/NodeRegistry";
import type { CanvasNodeData } from "./TriggerNode";

interface DocumentNodeProps {
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
  toCanvasCoords?: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onOpenSettings?: (nodeId: string) => void;
  /** Bi-directional port: LIFO-detaches the newest wire if any are attached,
   *  otherwise starts a fresh wire from this port. Handled by the editor. */
  onBiDiPortMouseDown?: (
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    color: string,
  ) => void;
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
}

interface DocumentConfig {
  templateFormat?: "PDF" | "Word";
  title?: string;
}

export const DocumentNode: React.FC<DocumentNodeProps> = ({
  node,
  scale,
  onUpdateSize,
  onUpdatePosition,
  onConnectTarget,
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
        title: "Document Generator",
        badge: "DOC",
        description: "Generates formatted documents from AI outputs.",
        icon: FiFileText,
        color: "text-info bg-info/10 border-info/20",
      }
    );
  }, [node.type]);

  const config = (node.config ?? {}) as Partial<DocumentConfig>;
  const IconComponent = definition.icon;
  const templateFormat = config.templateFormat || "PDF";
  const documentTitle = config.title || "AI Generated Report";

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

  // Tool node: single bi-directional port at the top-center pairs with an
  // AI agent's bottom tool hub instead of left-to-right side ports.
  const handleToolPortDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onBiDiPortMouseDown?.(e, node.id, "tool", "var(--info)");
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
          ? "cursor-grabbing border-info ring-2 ring-info/40 shadow-info/20"
          : "cursor-grab border-info/40 hover:border-info/70 hover:shadow-lg"
      }`}
      title="Double-click to open settings"
    >
      {/* Blue left accent stripe */}
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-info rounded-l-[10px] pointer-events-none" />

      {/* Header */}
      <div className="flex items-center gap-2.5 pl-4 pr-3 py-3 border-b border-subtle">
        <div className="h-9 w-9 rounded-lg bg-info/10 border border-info/20 text-info flex items-center justify-center shrink-0">
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary tracking-wide truncate">
            {definition.title}
          </div>
          <div className="text-[10px] text-muted truncate">{definition.description}</div>
        </div>
        <span className="text-[9px] font-mono text-info bg-info/10 border border-info/20 px-1.5 py-0.5 rounded shrink-0">
          {definition.badge || "DOC"}
        </span>
      </div>

      {/* Body: document preview */}
      <div className="px-4 py-3">
        <div className="text-[11px] text-secondary font-medium mb-1 truncate">
          {documentTitle}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[10px] font-mono text-info bg-info/10 border border-info/20 px-1.5 py-0.5 rounded">
            <FiFileText className="w-3 h-3" />
            {templateFormat}
          </span>
          <span className="text-[10px] text-faint truncate flex-1">Ready to generate</span>
        </div>
      </div>

      {/* Tool port: single bi-directional port at the top-center */}
      <div
        data-port-id={`${node.id}-tool`}
        onMouseDown={handleToolPortDown}
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectTarget?.(node.id, "tool");
        }}          title="Tool port — pairs with an AI agent's generation (right) or data (left) port; drag out to detach the newest wire (LIFO)"
        className="connection-handle absolute -top-2 left-1/2 -translate-x-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-info hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-info/50"
      />
    </div>
  );
};

export default DocumentNode;