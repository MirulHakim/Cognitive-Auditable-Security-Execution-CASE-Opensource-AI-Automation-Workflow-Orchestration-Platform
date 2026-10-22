import React, { useState, useEffect, useMemo } from "react";
import { FiCpu, FiDatabase } from "react-icons/fi";
import { NODE_REGISTRY } from "../../../constants/NodeRegistry";

export interface CanvasNodeData {
  id: string;
  type: string;
  position: { x: number; y: number };
  config?: Record<string, any>;
}

interface AINodeProps {
  node: CanvasNodeData;
  scale: number;
  onUpdatePosition: (id: string, newPos: { x: number; y: number }) => void;
  onStartConnection: (
    nodeId: string,
    portType: "input" | "output" | "data-source",
    startPos: { x: number; y: number },
    color: string,
  ) => void;
  onConnectTarget?: (
    targetNodeId: string,
    targetPort: "input" | "data-source",
  ) => void;
  onDragStart?: (nodeId: string) => void;
  onDragMove?: (clientX: number, clientY: number) => void;
  onDragEnd?: (nodeId: string, clientX: number, clientY: number) => void;
}

export const AINode: React.FC<AINodeProps> = ({
  node,
  scale,
  onUpdatePosition,
  onStartConnection,
  onConnectTarget,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const definition = useMemo(() => {
    return (
      NODE_REGISTRY.find((item) => item.type === node.type) || {
        title: "AI Agent",
        badge: "MODEL",
        icon: FiCpu,
      }
    );
  }, [node.type]);

  const IconComponent = definition.icon;
  const title = definition.title;
  const modelName = node.config?.model || "gpt-4o";
  const dataSource = node.config?.dataSource || "No Data Source";

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

  const handleOutputPortDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartConnection(
      node.id,
      "output",
      { x: node.position.x + 208, y: node.position.y + 95 },
      "#22d3ee",
    );
  };

  const handleDataSourcePortDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartConnection(
      node.id,
      "data-source",
      { x: node.position.x + 110, y: node.position.y + 182 },
      "#34d399",
    );
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
        position: "absolute",
        width: "220px",
        height: "190px",
      }}
      className={`group select-none relative ${
        isDraggingNode ? "cursor-grabbing" : "cursor-grab"
      }`}
    >
      {/* Bottom Floating Ambient Glow - Only active when DRAGGING */}
      <div
        className={`absolute -bottom-2 left-1/2 -translate-x-1/2 w-28 h-7 rounded-full pointer-events-none blur-md transition-opacity duration-150 ${
          isDraggingNode
            ? "bg-cyan-400/40 opacity-100 scale-105"
            : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Hexagon SVG Frame */}
      <svg
        className={`absolute inset-0 w-[220px] h-[190px] overflow-visible pointer-events-none z-10 transition-all duration-150 ${
          isDraggingNode ? "drop-shadow-[0_0_14px_rgba(34,211,238,0.45)]" : ""
        }`}
        viewBox="0 0 220 190"
      >
        {/* Primary Hexagon: On hover only the border stroke lights up; glow is reserved for drag */}
        <polygon
          points="55,8 165,8 208,95 165,182 55,182 12,95"
          className={`fill-[#0f172a] transition-[stroke,stroke-width] duration-150 ${
            isDraggingNode
              ? "stroke-cyan-400 stroke-[2.5]"
              : "stroke-cyan-500/40 stroke-2 group-hover:stroke-cyan-400 group-hover:stroke-[2.5]"
          }`}
        />

        {/* Inner subtle rim */}
        <polygon
          points="60,16 160,16 198,95 160,174 60,174 22,95"
          className="fill-none stroke-cyan-500/10 stroke-1"
        />
      </svg>

      {/* Hexagon Inner Details */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 pointer-events-none z-20">
        <div className="h-8 w-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-1 shadow-sm shadow-cyan-500/20 group-hover:border-cyan-400/40 transition-colors">
          <IconComponent className="w-4 h-4" />
        </div>

        <span className="text-xs font-semibold text-white tracking-wide truncate max-w-[120px]">
          {title}
        </span>

        <span className="text-[9px] font-mono text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded border border-cyan-500/20 mt-0.5">
          {modelName}
        </span>

        <div className="flex items-center gap-1 mt-1.5 text-[10px] text-slate-400 font-mono">
          <FiDatabase className="w-2.5 h-2.5 text-cyan-400 shrink-0" />
          <span className="truncate max-w-[100px]">{dataSource}</span>
        </div>
      </div>

      {/* Left Input Port */}
      <div
        data-port-id={`${node.id}-input`}
        onMouseUp={(e) => {
          e.stopPropagation();
          onConnectTarget?.(node.id, "input");
        }}
        title="Connect input here"
        style={{ left: "12px", top: "95px" }}
        className="connection-handle absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-slate-900 border-2 border-cyan-400 hover:scale-125 transition-transform cursor-pointer z-30 shadow-md shadow-cyan-400/40"
      />

      {/* Right Output Port */}
      <div
        data-port-id={`${node.id}-output`}
        onMouseDown={handleOutputPortDown}
        title="Output connection"
        style={{ left: "208px", top: "95px" }}
        className="connection-handle absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-cyan-400 border-2 border-[#0b0f19] hover:scale-125 hover:bg-cyan-300 transition-transform cursor-crosshair z-30 shadow-[0_0_10px_rgba(34,211,238,0.7)]"
      />

      {/* Bottom Data Source Port */}
      <div
        data-port-id={`${node.id}-data-source`}
        onMouseDown={handleDataSourcePortDown}
        title="Connect Data Source"
        style={{ left: "110px", top: "182px" }}
        className="connection-handle absolute -translate-x-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-400 border-2 border-[#0b0f19] hover:scale-125 hover:bg-emerald-300 transition-transform cursor-crosshair z-30 shadow-[0_0_10px_rgba(52,211,153,0.7)]"
      />
    </div>
  );
};

export default AINode;
