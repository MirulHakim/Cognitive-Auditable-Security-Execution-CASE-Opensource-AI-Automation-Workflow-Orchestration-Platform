import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  FiArrowLeft,
  FiPlay,
  FiSave,
  FiPlus,
  FiZoomIn,
  FiZoomOut,
  FiMaximize2,
  FiMinimize2,
  FiZap,
  FiTrash2,
} from "react-icons/fi";
import { NODE_REGISTRY, type NodeDefinition } from "./constants/NodeRegistry";
import TriggerNode, {
  type CanvasNodeData,
} from "./components/editor/nodes/TriggerNode";
import AINode from "./components/editor/nodes/AINode";
import NodeCatalogModal from "./components/editor/NodeCatalog";

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  fromPort: "output" | "data-source";
  toPort: "input" | "data-source";
  color: string;
}

interface WorkflowEditorProps {
  workflowId?: string | null;
  onBack: () => void;
}

export const WorkflowEditor: React.FC<WorkflowEditorProps> = ({
  workflowId,
  onBack,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);

  const [isCatalogOpen, setIsCatalogOpen] = useState(false);
  const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);

  // Canvas Transform State
  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({
    x: 0,
    y: 0,
  });
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Active Connection Wire
  const [activeWire, setActiveWire] = useState<{
    sourceNodeId: string;
    portType: "output" | "data-source" | "input";
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
    color: string;
  } | null>(null);

  // Dragging to Trash States
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [isOverTrash, setIsOverTrash] = useState<boolean>(false);
  const [nodeSizes, setNodeSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});

  const handleUpdateNodeSize = useCallback(
    (id: string, width: number, height: number) => {
      setNodeSizes((prev) => {
        if (prev[id]?.width === width && prev[id]?.height === height)
          return prev;
        return { ...prev, [id]: { width, height } };
      });
    },
    [],
  );

  const checkHoveringTrash = (clientX: number, clientY: number) => {
    if (!trashRef.current) return false;
    const rect = trashRef.current.getBoundingClientRect();
    return (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    );
  };

  const handleNodeDragStart = (nodeId: string) => setDraggingNodeId(nodeId);
  const handleNodeDragMove = (clientX: number, clientY: number) =>
    setIsOverTrash(checkHoveringTrash(clientX, clientY));

  const handleNodeDragEnd = (
    nodeId: string,
    clientX: number,
    clientY: number,
  ) => {
    if (checkHoveringTrash(clientX, clientY)) {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) =>
        prev.filter((e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId),
      );
    }
    setDraggingNodeId(null);
    setIsOverTrash(false);
  };

  const screenToCanvasCoords = (clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - position.x) / scale,
      y: (clientY - rect.top - position.y) / scale,
    };
  };

  const handleStartConnection = (
    sourceNodeId: string,
    portType: "output" | "data-source" | "input",
    startPos: { x: number; y: number },
    color: string,
  ) => {
    setActiveWire({
      sourceNodeId,
      portType,
      startX: startPos.x,
      startY: startPos.y,
      currentX: startPos.x,
      currentY: startPos.y,
      color,
    });
  };

  // Detach edge: starts dragging from source node again
  const handleDetachEdge = (
    e: React.MouseEvent,
    edge: CanvasEdge,
    startPos: { x: number; y: number },
  ) => {
    e.stopPropagation();
    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    setEdges((prev) => prev.filter((item) => item.id !== edge.id));
    setActiveWire({
      sourceNodeId: edge.fromNodeId,
      portType: edge.fromPort,
      startX: startPos.x,
      startY: startPos.y,
      currentX: coords.x,
      currentY: coords.y,
      color: edge.color,
    });
  };

  const handleConnectTarget = (
    targetNodeId: string,
    targetPort: "input" | "data-source",
  ) => {
    if (!activeWire || activeWire.sourceNodeId === targetNodeId) return;

    // Check if an edge already exists to replace or avoid duplicates
    setEdges((prev) => {
      const filtered = prev.filter(
        (e) => !(e.toNodeId === targetNodeId && e.toPort === targetPort),
      );
      return [
        ...filtered,
        {
          id: `edge-${Date.now()}`,
          fromNodeId: activeWire.sourceNodeId,
          toNodeId: targetNodeId,
          fromPort: activeWire.portType as "output" | "data-source",
          toPort: targetPort,
          color: activeWire.color,
        },
      ];
    });
    setActiveWire(null);
  };

  const handleMouseMoveWithWire = (e: React.MouseEvent) => {
    if (isPanning) {
      setPosition({ x: e.clientX - startPan.x, y: e.clientY - startPan.y });
      return;
    }
    if (activeWire) {
      const coords = screenToCanvasCoords(e.clientX, e.clientY);
      setActiveWire((prev) =>
        prev ? { ...prev, currentX: coords.x, currentY: coords.y } : null,
      );
    }
  };

  const handleMouseUpWithWire = () => {
    setIsPanning(false);
    if (activeWire) setActiveWire(null);
  };

  const centerCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const { clientWidth, clientHeight } = canvasRef.current;
    setPosition({ x: clientWidth / 2, y: clientHeight / 2 });
    setScale(1);
  }, []);

  useEffect(() => {
    centerCanvas();
  }, [centerCanvas]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const handleWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = 0.05;
      const delta = e.deltaY < 0 ? zoomFactor : -zoomFactor;
      setScale((prev) => Math.min(Math.max(0.4, prev + delta), 2.0));
    };
    canvasEl.addEventListener("wheel", handleWheelNative, { passive: false });
    return () => canvasEl.removeEventListener("wheel", handleWheelNative);
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (
      e.target === canvasRef.current ||
      (e.target as HTMLElement).id === "grid-surface"
    ) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const createNode = (type: string, pos: { x: number; y: number }) => {
    const registryEntry = NODE_REGISTRY.find((item) => item.type === type);
    const newNode: CanvasNodeData = {
      id: `node-${Date.now()}`,
      type,
      position: pos,
      config: registryEntry?.defaultConfig
        ? { ...registryEntry.defaultConfig }
        : {},
    };
    setNodes((prev) => [...prev, newNode]);
    setIsCatalogOpen(false);
  };

  const handleSelectNode = (nodeDef: NodeDefinition) => {
    if (!canvasRef.current) return;
    const { clientWidth, clientHeight } = canvasRef.current;
    const worldCenter = {
      x: (clientWidth / 2 - position.x) / scale - 100,
      y: (clientHeight / 2 - position.y) / scale - 50,
    };
    createNode(nodeDef.type, worldCenter);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rawData = e.dataTransfer.getData("application/json");
    if (!rawData) return;
    try {
      const nodeDef: NodeDefinition = JSON.parse(rawData);
      const dropCoords = screenToCanvasCoords(e.clientX, e.clientY);
      createNode(nodeDef.type, { x: dropCoords.x - 30, y: dropCoords.y - 30 });
    } catch (err) {
      console.error("Failed to parse dropped node:", err);
    }
  };

  const handleUpdateNodePosition = (
    id: string,
    newPos: { x: number; y: number },
  ) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, position: newPos } : n)),
    );
  };

  const getNodePortCoord = (
    nodeId: string,
    portType: "output" | "input" | "data-source",
  ) => {
    const n = nodes.find((item) => item.id === nodeId);
    if (!n) return { x: 0, y: 0 };

    if (n.type.startsWith("trigger-")) {
      const portEl = canvasRef.current?.querySelector(
        `[data-port-id="${nodeId}-output"]`,
      );
      if (portEl && canvasRef.current) {
        const portRect = portEl.getBoundingClientRect();
        const canvasRect = canvasRef.current.getBoundingClientRect();
        return {
          x:
            (portRect.left +
              portRect.width / 2 -
              canvasRect.left -
              position.x) /
            scale,
          y:
            (portRect.top + portRect.height / 2 - canvasRect.top - position.y) /
            scale,
        };
      }
      const measuredWidth = nodeSizes[nodeId]?.width || 260;
      return { x: n.position.x + measuredWidth, y: n.position.y + 32 };
    }

    if (n.type.startsWith("agent-")) {
      const portEl = canvasRef.current?.querySelector(
        `[data-port-id="${nodeId}-${portType}"]`,
      );
      if (portEl && canvasRef.current) {
        const portRect = portEl.getBoundingClientRect();
        const canvasRect = canvasRef.current.getBoundingClientRect();
        return {
          x:
            (portRect.left +
              portRect.width / 2 -
              canvasRect.left -
              position.x) /
            scale,
          y:
            (portRect.top + portRect.height / 2 - canvasRect.top - position.y) /
            scale,
        };
      }
      if (portType === "input")
        return { x: n.position.x + 12, y: n.position.y + 95 };
      if (portType === "output")
        return { x: n.position.x + 208, y: n.position.y + 95 };
      if (portType === "data-source")
        return { x: n.position.x + 110, y: n.position.y + 182 };
    }

    return { x: n.position.x, y: n.position.y };
  };

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;

    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    }
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col bg-[#0b0f19] select-none overflow-hidden relative"
    >
      {/* Subheader */}
      <div className="h-14 bg-[#0f172a] border-b border-slate-800 px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <FiArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-slate-800" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white">
                {workflowId
                  ? `Workflow Canvas (${workflowId})`
                  : "Untitled Pipeline"}
              </span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Draft
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Auto-saved 2 minutes ago
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCatalogOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors"
          >
            <FiPlus className="w-3.5 h-3.5 text-cyan-400" />
            <span>Add Node</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/60 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors"
          >
            <FiPlay className="w-3.5 h-3.5 text-emerald-400" />
            <span>Test Run</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors shadow-sm shadow-cyan-400/20"
          >
            <FiSave className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        id="grid-surface"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveWithWire}
        onMouseUp={handleMouseUpWithWire}
        onMouseLeave={handleMouseUpWithWire}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          backgroundPosition: `${position.x}px ${position.y}px`,
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundImage: `radial-gradient(circle, #334155 1px, transparent 1px)`,
        }}
        className={`flex-1 relative overflow-hidden bg-[#0b0f19] ${
          isPanning
            ? "cursor-grabbing"
            : activeWire
              ? "cursor-crosshair"
              : "cursor-grab"
        }`}
      >
        <div
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
          className="absolute top-0 left-0 pointer-events-none"
        >
          {/* SVG Connector Layer - Locked at z-0 so lines pass BEHIND all cards */}
          <svg className="absolute top-0 left-0 overflow-visible w-1 h-1 pointer-events-none z-0">
            {/* 1. Established Connections */}
            {edges.map((edge) => {
              const start = getNodePortCoord(edge.fromNodeId, edge.fromPort);
              const end = getNodePortCoord(edge.toNodeId, edge.toPort);

              const dx = Math.max(end.x - start.x, 30);
              const curvature = 0.5;
              const cp1x = start.x + dx * curvature;
              const cp1y = start.y;
              const cp2x = end.x - dx * curvature;
              const cp2y = end.y;

              return (
                <g key={edge.id} className="group/wire pointer-events-auto">
                  {/* Invisible wider hit-area */}
                  <path
                    d={`M ${start.x} ${start.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${end.x} ${end.y}`}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                    className="cursor-pointer"
                  />

                  {/* Visible Cable */}
                  <path
                    d={`M ${start.x} ${start.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${end.x} ${end.y}`}
                    fill="none"
                    stroke={edge.color}
                    strokeWidth="2.5"
                    className="opacity-90 group-hover/wire:opacity-100 group-hover/wire:brightness-125"
                  />
                </g>
              );
            })}

            {/* 2. Live Dragged Connection Line */}
            {activeWire && (
              <path
                d={
                  activeWire.portType === "data-source"
                    ? `M ${activeWire.startX} ${activeWire.startY} C ${activeWire.startX} ${
                        activeWire.startY +
                        Math.abs(activeWire.currentY - activeWire.startY) *
                          0.5 +
                        40
                      }, ${activeWire.currentX} ${
                        activeWire.currentY -
                        Math.abs(activeWire.currentY - activeWire.startY) *
                          0.5 -
                        40
                      }, ${activeWire.currentX} ${activeWire.currentY}`
                    : `M ${activeWire.startX} ${activeWire.startY} C ${
                        activeWire.startX +
                        Math.abs(activeWire.currentX - activeWire.startX) *
                          0.5 +
                        40
                      } ${activeWire.startY}, ${
                        activeWire.currentX -
                        Math.abs(activeWire.currentX - activeWire.startX) *
                          0.5 -
                        40
                      } ${activeWire.currentY}, ${activeWire.currentX} ${activeWire.currentY}`
                }
                fill="none"
                stroke={activeWire.color}
                strokeWidth="2.5"
                strokeDasharray="4 4"
              />
            )}
          </svg>

          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
              <div className="border border-dashed border-slate-800 rounded-2xl p-8 bg-[#0f172a]/80 backdrop-blur-sm text-center w-80 shadow-2xl">
                <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto mb-3">
                  <FiZap className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-white">
                  Empty Pipeline Canvas
                </h3>
                <p className="text-xs text-slate-400 mt-1 mb-4 leading-relaxed">
                  Click or drag your first trigger node into the workspace to
                  begin.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCatalogOpen(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors shadow-md shadow-cyan-400/20"
                >
                  <FiPlus className="w-4 h-4 stroke-[2.5]" />
                  <span>Add First Node</span>
                </button>
              </div>
            </div>
          )}

          {/* Placed Nodes Layer */}
          <div className="relative z-20 pointer-events-auto">
            {nodes.map((node) => {
              if (node.type.startsWith("trigger-")) {
                return (
                  <TriggerNode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdatePosition={handleUpdateNodePosition}
                    onStartConnection={handleStartConnection}
                    onUpdateSize={handleUpdateNodeSize}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              if (node.type.startsWith("agent-")) {
                return (
                  <AINode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdatePosition={handleUpdateNodePosition}
                    onStartConnection={handleStartConnection}
                    onConnectTarget={handleConnectTarget}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              return null;
            })}
          </div>

          {/* Re-drag Handles Layer */}
          <div className="absolute top-0 left-0 pointer-events-none z-30">
            {edges.map((edge) => {
              const start = getNodePortCoord(edge.fromNodeId, edge.fromPort);
              const end = getNodePortCoord(edge.toNodeId, edge.toPort);

              return (
                <div
                  key={`handle-${edge.id}`}
                  style={{
                    left: `${end.x}px`,
                    top: `${end.y}px`,
                    transform: "translate(-50%, -50%)",
                  }}
                  className="absolute pointer-events-auto cursor-grab active:cursor-grabbing group/handle"
                  onMouseDown={(e) => handleDetachEdge(e, edge, start)}
                  title="Drag to disconnect or reconnect"
                >
                  <div
                    style={{ backgroundColor: edge.color }}
                    className="w-4 h-4 rounded-full border-2 border-[#0b0f19] hover:scale-125 transition-transform shadow-md shadow-cyan-500/50"
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Floating Drop-To-Delete Trash Zone */}
        <div
          ref={trashRef}
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 pointer-events-none ${
            draggingNodeId
              ? "opacity-100 translate-y-0 scale-100"
              : "opacity-0 translate-y-8 scale-95"
          }`}
        >
          <div
            className={`flex items-center gap-2.5 px-5 py-2.5 rounded-full border shadow-2xl transition-all duration-200 ${
              isOverTrash
                ? "bg-rose-950 border-rose-500 text-rose-200 scale-105 ring-2 ring-rose-500/40"
                : "bg-[#0f172a] border-slate-700 text-slate-300"
            }`}
          >
            <FiTrash2
              className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                isOverTrash
                  ? "scale-110 text-rose-400 animate-bounce"
                  : "text-slate-400"
              }`}
            />
            <span className="text-xs font-semibold whitespace-nowrap">
              {isOverTrash ? "Release to Delete" : "Drag here to remove"}
            </span>
          </div>
        </div>

        {/* Viewport Zoom Controls */}
        <div className="absolute bottom-5 right-5 flex items-center gap-1 bg-[#0f172a]/90 backdrop-blur border border-slate-800 rounded-lg p-1 shadow-lg z-20">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s + 0.1, 2.0))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <FiZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s - 0.1, 0.4))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            <FiZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-slate-400 px-1.5 min-w-[42px] text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <div className="h-3 w-px bg-slate-800" />
          <button
            type="button"
            onClick={centerCanvas}
            className="px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
          >
            Reset
          </button>
          <div className="h-3 w-px bg-slate-800" />
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Canvas"}
          >
            {isFullscreen ? (
              <FiMinimize2 className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <FiMaximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      <NodeCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectNode={handleSelectNode}
      />
    </div>
  );
};

export default WorkflowEditor;
