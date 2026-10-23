import React, { useState, useRef, useEffect, useMemo } from "react";
import { FiZap } from "react-icons/fi";
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
  onUpdateConfig?: (id: string, patch: Record<string, unknown>) => void;
  onStartConnection: (
    nodeId: string,
    portType: "output",
    startPos: { x: number; y: number },
    color: string,
  ) => void;
  onTargetPortMouseDown?: (
    e: React.MouseEvent,
    targetNodeId: string,
    targetPort: string,
  ) => void;
  /** Converts screen coordinates (e.g. from a port's getBoundingClientRect)
   *  into canvas/world coordinates using the editor's transform state. */
  toCanvasCoords?: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number };
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
  onOpenSettings?: (nodeId: string) => void;
}

// UI-REGION: Trigger Node — canvas card for trigger-* types (D-capsule
// layout, right-side output port). Presentational: drag + port wiring live
// here, workflow state is owned by WorkflowEditor.
export const TriggerNode: React.FC<TriggerNodeProps> = ({
  node,
  scale,
  onUpdateSize,
  onUpdatePosition,
  onStartConnection,
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

  // Port Cable Connection Handler — pixel-perfect snapping: read the port
  // dot's live screen rect and convert it into world coordinates.
  const handlePortMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const world = toCanvasCoords
      ? toCanvasCoords(rect.left + rect.width / 2, rect.top + rect.height / 2)
      : {
          x:
            node.position.x +
            (nodeRef.current ? nodeRef.current.offsetWidth : 260),
          y: node.position.y + 32,
        };
    onStartConnection(node.id, "output", world, "var(--warning)");
  };

  // Plain-English subtitle per trigger type (no technical payloads on canvas)
  const subtitle =
    node.type === "trigger-webhook"
      ? "Receives incoming webhooks"
      : node.type === "trigger-cron"
        ? node.config?.humanTime || "Runs on a schedule"
        : node.type === "trigger-email"
          ? "Listens for new emails"
          : node.type === "trigger-telegram"
            ? "Listens for bot messages"
            : "Listening for events";

  return (
    <div
      ref={nodeRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        position: "absolute",
      }}
      className={`w-max min-w-[240px] h-16 bg-surface border-2 border-warning/40 rounded-xl shadow-xl select-none flex items-center pl-3.5 pr-10 relative transition-colors duration-200 ${
        isDraggingNode
          ? "cursor-grabbing ring-2 ring-warning/50 shadow-warning/20"
          : "cursor-grab hover:border-warning/70 hover:shadow-lg"
      }`}
      title="Double-click to open settings"
    >
      {/* Icon Badge */}
      <div className="h-9 w-9 rounded-xl bg-warning/10 border border-warning/20 text-warning flex items-center justify-center shrink-0 mr-3">
        <IconComponent className="w-4 h-4" />
      </div>

      {/* Compact info: icon + title + plain-English subtitle */}
      <div className="flex flex-col justify-center min-w-0">
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-xs font-semibold text-primary tracking-wide">
            {title}
          </span>
          <span className="text-[9px] font-mono text-warning/90 bg-warning/10 px-1.5 py-0.5 rounded border border-warning/20 shrink-0">
            {badge}
          </span>
        </div>
        <span className="text-[10px] text-muted truncate whitespace-nowrap">
          {subtitle}
        </span>
      </div>

      {/* Output Port Dot — also a LIFO detach target for wires anchored here */}
      <div
        data-port-id={`${node.id}-output`}
        onMouseDown={(e) => {
          e.stopPropagation();
          if (onTargetPortMouseDown) {
            onTargetPortMouseDown(e, node.id, "output");
          } else {
            handlePortMouseDown(e);
          }
        }}
        onMouseUp={(e) => {
          e.stopPropagation();
        }}
        title="Output port — drag out to detach the newest wire (LIFO), or drag out to start a new wire"
        className="connection-handle absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-warning border-3 border-background hover:scale-125 hover:bg-warning transition-transform cursor-crosshair shadow-md shadow-warning/50 z-30"
      />
    </div>
  );
};

export default TriggerNode;
