import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiGitBranch } from "react-icons/fi";
import {
  NODE_REGISTRY,
  type LogicConfig,
} from "../../../constants/NodeRegistry";
import type { CanvasNodeData } from "./TriggerNode";

interface LogicNodeProps {
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
}

export const LogicNode: React.FC<LogicNodeProps> = ({
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
        title: "Logic",
        description: "",
        icon: FiGitBranch,
      }
    );
  }, [node.type]);

  const config = (node.config ?? {}) as Partial<LogicConfig>;
  const branches =
    config.branches && config.branches.length > 0
      ? config.branches
      : ["True", "False"];
  const IconComponent = definition.icon;
  const description =
    definition.description ||
    "Checks a condition, then splits the path.";

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
  const handleOutputPortDown = (
    e: React.MouseEvent<HTMLDivElement>,
    portId: string,
  ) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    onStartConnection(
      node.id,
      portId,
      toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2),
      "var(--demo)",
    );
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
      className={`w-[236px] select-none relative rounded-xl border-2 bg-surface shadow-xl transition-colors duration-200 ${
        isDraggingNode
          ? "cursor-grabbing border-demo ring-2 ring-demo/40 shadow-demo/25"
          : "cursor-grab border-demo/40 hover:border-demo/70 hover:shadow-lg"
      }`}
      title="Double-click to open settings"
    >
      {/* Compact header: icon + title + plain-English subtitle */}
      <div className="flex items-center gap-2.5 pl-4 pr-3 pt-2.5 pb-2">
        <div className="h-9 w-9 rounded-lg bg-demo/10 border border-demo/20 text-demo flex items-center justify-center shrink-0">
          <IconComponent className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-primary tracking-wide truncate">
            {definition.title}
          </div>
          <div className="text-[10px] text-muted truncate">{description}</div>
        </div>
      </div>

      {/* Branch output zones — one tinted row per branch. Rows are spaced
          with gap-3; the port dot straddles the card border and stays
          vertically centered on its label. */}
      <div className="pb-3 pt-1 flex flex-col gap-3">
        {branches.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className={`relative flex items-center justify-end h-7 pr-4 rounded-md ${
              index === 0 ? "bg-demo/10" : "bg-demo/5"
            }`}
          >
            <span className="text-[10px] font-medium text-secondary mr-2 truncate">
              {label}
            </span>
            <div
              data-port-id={`${node.id}-output-${index}`}
              onMouseDown={(e) => handleOutputPortDown(e, `output-${index}`)}
              title={`Drag from "${label}" branch`}
              className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-demo border-2 border-background hover:scale-125 transition-transform cursor-crosshair z-30 shadow-md shadow-demo/50"
            />
          </div>
        ))}
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
        className="connection-handle absolute -left-2 top-[30px] -translate-y-1/2 w-4 h-4 rounded-full bg-surface-sunken border-2 border-demo hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-demo/50"
      />
    </div>
  );
};

export default LogicNode;
