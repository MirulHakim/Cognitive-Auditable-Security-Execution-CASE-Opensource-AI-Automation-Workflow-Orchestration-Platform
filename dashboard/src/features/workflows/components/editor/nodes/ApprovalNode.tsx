import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiUserCheck, FiStar } from "react-icons/fi";
import { NODE_REGISTRY } from "../../../constants/NodeRegistry";
import type { CanvasNodeData } from "./TriggerNode";

interface ApprovalNodeProps {
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
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
}

interface ApprovalConfig {
  description?: string;
}

export const ApprovalNode: React.FC<ApprovalNodeProps> = ({
  node,
  scale,
  onUpdateSize,
  onUpdatePosition,
  onStartConnection,
  onConnectTarget,
  onTargetPortMouseDown,
  toCanvasCoords,
  onOpenSettings,
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
        title: "Human Approval",
        badge: "REVIEW",
        description: "Pauses workflow until a human approves or rejects.",
        icon: FiUserCheck,
        color: "text-warning bg-warning/10 border-warning/20",
      }
    );
  }, [node.type]);

  const config = (node.config ?? {}) as Partial<ApprovalConfig>;
  const IconComponent = definition.icon;
  const description = config.description || definition.description;

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

  const handleOutputPortDown = (
    e: React.MouseEvent<HTMLDivElement>,
    portId: string,
    color: string,
  ) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const world = toCanvasCoords
      ? toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: node.position.x + 240, y: node.position.y + 50 };
    onStartConnection(node.id, portId, world, color);
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
          ? "cursor-grabbing border-warning ring-2 ring-warning/40 shadow-warning/20"
          : "cursor-grab border-warning/40 hover:border-warning/70 hover:shadow-lg"
      }`}
      title="Double-click to open settings"
    >
      {/* Compact header: icon + title + plain-English subtitle */}
      <div className="flex items-center gap-2.5 pl-4 pr-3 pt-2.5 pb-2">
        <div className="h-9 w-9 rounded-lg bg-warning/10 border border-warning/20 text-warning flex items-center justify-center shrink-0">
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary tracking-wide truncate">
            {definition.title}
          </div>
          <div className="text-[10px] text-muted truncate">{description}</div>
        </div>
      </div>

      {/* AI summary indicator — the LLM synthesizes the whitelisted
          payload before the operator reviews it. */}
      <div className="mx-4 mb-1 flex items-center gap-1.5 px-2 py-1 rounded-md border border-accent-primary/20 bg-accent-primary/[0.07]">
        <FiStar className="w-3 h-3 text-accent-primary fill-current shrink-0" />
        <span className="text-[9px] text-accent-primary/90 truncate">
          AI summary ready before review
        </span>
      </div>

      {/* Reviewer decision zones — one tinted row per outcome. Rows are
          spaced with gap-3; the port dot straddles the card border and
          stays vertically centered on its label. */}
      <div className="pb-3 pt-1 flex flex-col gap-3">
        <div className="relative flex items-center justify-end h-7 pr-4 rounded-md bg-success/10">
          <span className="text-[10px] font-medium text-success mr-2">
            Approved
          </span>
          <div
            data-port-id={`${node.id}-output-approved`}
            onMouseDown={(e) =>
              handleOutputPortDown(e, "output-approved", "var(--success)")
            }
            title="Drag from Approved branch"
            className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-success border-2 border-background hover:scale-125 transition-transform cursor-crosshair z-30 shadow-md shadow-success/50"
          />
        </div>
        <div className="relative flex items-center justify-end h-7 pr-4 rounded-md bg-danger/10">
          <span className="text-[10px] font-medium text-danger mr-2">
            Rejected
          </span>
          <div
            data-port-id={`${node.id}-output-rejected`}
            onMouseDown={(e) =>
              handleOutputPortDown(e, "output-rejected", "var(--danger)")
            }
            title="Drag from Rejected branch"
            className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-danger border-2 border-background hover:scale-125 transition-transform cursor-crosshair z-30 shadow-md shadow-danger/50"
          />
        </div>
      </div>

      {/* Input port: mouse-up connects, mouse-down detaches newest wire (LIFO) */}
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
        className="connection-handle absolute -left-2 top-[30px] -translate-y-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-warning hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-warning/50"
      />
    </div>
  );
};

export default ApprovalNode;