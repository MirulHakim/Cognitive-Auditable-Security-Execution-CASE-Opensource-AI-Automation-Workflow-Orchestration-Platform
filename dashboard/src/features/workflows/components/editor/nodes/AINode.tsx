import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiCpu } from "react-icons/fi";
import { NODE_REGISTRY } from "../../../constants/NodeRegistry";
import type { CanvasNodeData } from "./TriggerNode";

interface AINodeProps {
  node: CanvasNodeData;
  scale: number;
  onUpdateSize?: (id: string, width: number, height: number) => void;
  onUpdatePosition: (id: string, newPos: { x: number; y: number }) => void;
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
  /** Bi-directional port: LIFO-detaches the newest wire if any are attached,
   *  otherwise starts a fresh wire from this port. Handled by the editor,
   *  which owns the edge list. */
  onBiDiPortMouseDown?: (
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    color: string,
  ) => void;
  /** Converts screen coordinates into canvas/world coordinates. */
  toCanvasCoords?: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
  onOpenSettings?: (nodeId: string) => void;
}

// UI-REGION: AI Agent Node — canvas card for agent-* types with the dual
// bottom ports (Database/data @30% + Tool/gen @70%) and their mono labels.
// Presentational: workflow state is owned by WorkflowEditor.
export const AINode: React.FC<AINodeProps> = ({
  node,
  scale,
  onUpdateSize,
  onUpdatePosition,
  onStartConnection,
  onConnectTarget,
  onTargetPortMouseDown,
  onBiDiPortMouseDown,
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
        title: "AI Agent",
        description: "",
        icon: FiCpu,
      }
    );
  }, [node.type]);

  const IconComponent = definition.icon;
  const title = definition.title;
  const description =
    definition.description ||
    "AI agent that reasons, summarizes, or takes actions.";

  // Node Dragging Handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, .connection-handle"))
      return;
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
  const portWorld = (el: HTMLDivElement) => {
    const rect = el.getBoundingClientRect();
    return toCanvasCoords
      ? toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : { x: node.position.x + 120, y: node.position.y + 55 };
  };

  const handleOutputPortDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    onStartConnection(
      node.id,
      "output",
      portWorld(e.currentTarget),
      "var(--accent-primary)",
    );
  };

  // Bottom edge split into two bi-directional ports. Each carries its own
  // family color so wires inherit the right palette on creation:
  //  - `data` (bottom-left,  30%): emerald — pairs with Data/KB nodes.
  //  - `gen`  (bottom-right, 70%): sky    — pairs with Generator nodes.
  const handleBiDiPortDown =
    (portId: string, color: string) =>
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.stopPropagation();
      onBiDiPortMouseDown?.(e, node.id, portId, color);
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
          ? "cursor-grabbing border-accent-primary ring-2 ring-accent-primary/40 shadow-accent-primary/20"
          : "cursor-grab border-accent-primary/40 hover:border-accent-primary hover:shadow-lg"
      }`}
      title="Double-click to open settings"
    >
      {/* Compact header: icon + title + plain-English subtitle */}
      <div className="flex items-center gap-2.5 pl-4 pr-3 py-3">
        <div className="h-9 w-9 rounded-lg bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center shrink-0">
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary tracking-wide truncate">
            {title}
          </div>
          <div className="text-[10px] text-muted truncate">{description}</div>
        </div>
      </div>

      {/* Left Input Port — mouse-up connects, mouse-down detaches newest wire (LIFO) */}
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
        className="connection-handle absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-accent-primary hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-accent-primary/40"
      />

      {/* Right Output Port */}
      <div
        data-port-id={`${node.id}-output`}
        onMouseDown={handleOutputPortDown}
        title="Output connection"
        className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-accent-primary border-2 border-background hover:scale-125 hover:bg-accent-primary-hover transition-transform cursor-crosshair z-30 shadow-[0_0_10px_color-mix(in_oklab,var(--accent-primary)_70%,transparent)]"
      />

      {/* Bottom-Left Data & Context Port — emerald, pairs with Knowledge Base
          / Document Reader nodes. Bi-directional: mouse-up connects, mouse-down
          LIFO-detaches the newest wire. */}
      <div
        data-port-id={`${node.id}-data`}
        onMouseDown={handleBiDiPortDown("data", "var(--success)")}
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectTarget?.(node.id, "data");
        }}
        title="Data & context port (left) — connect Knowledge Base / Document Reader nodes here; drag out to detach the newest data wire (LIFO)"
        className="connection-handle absolute -bottom-2 left-[30%] -translate-x-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-success hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-success/50"
      />

      {/* Tiny label for the bottom-left port */}
      <span className="pointer-events-none select-none absolute -bottom-6 left-[30%] -translate-x-1/2 text-[9px] font-mono leading-none text-success/70 whitespace-nowrap">
        Database
      </span>

      {/* Bottom-Right Generation & Tools Port — sky, pairs with output
          generators like the Document Generator. Bi-directional as well. */}
      <div
        data-port-id={`${node.id}-gen`}
        onMouseDown={handleBiDiPortDown("gen", "var(--info)")}
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectTarget?.(node.id, "gen");
        }}
        title="Generation & tools port (right) — connect Document Generator / output tools here; drag out to detach the newest tool wire (LIFO)"
        className="connection-handle absolute -bottom-2 left-[70%] -translate-x-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-info hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-info/50"
      />

      {/* Tiny label for the bottom-right port */}
      <span className="pointer-events-none select-none absolute -bottom-6 left-[70%] -translate-x-1/2 text-[9px] font-mono leading-none text-info/70 whitespace-nowrap">
        Tool
      </span>
    </div>
  );
};

export default AINode;
