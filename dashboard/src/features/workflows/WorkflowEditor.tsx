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
  FiEdit2,
  FiZap,
  FiTrash2,
} from "react-icons/fi";
import { NODE_REGISTRY, type NodeDefinition } from "./constants/NodeRegistry";
import TriggerNode, {
  type CanvasNodeData,
} from "./components/editor/nodes/TriggerNode";
import AINode from "./components/editor/nodes/AINode";
import LogicNode from "./components/editor/nodes/LogicNode";
import ConnectorNode from "./components/editor/nodes/ConnectorNode";
import ApprovalNode from "./components/editor/nodes/ApprovalNode";
import DocumentNode from "./components/editor/nodes/DocumentNode";
import NodeCatalogModal from "./components/editor/NodeCatalog";
import NodeSettingsModal from "./components/editor/NodeSettingsModal";

export interface CanvasEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  /** Port id on the source node: "output" | "data-source" | "output-<index>" (branch)
   *  | "data" | "gen" (AI-agent bottom edge). */
  fromPort: string;
  /** Port id on the target node: "input" | "data-source" | "tool" | "data" | "gen". */
  toPort: string;
  color: string;
  /** Monotonic creation stamp — orders many-to-one wires for LIFO detachment. */
  timestamp: number;
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
  const [settingsNodeId, setSettingsNodeId] = useState<string | null>(null);

  // Editable workflow title (top-left of the subheader). Click the title to
  // rename inline — Enter/blur commits, Escape reverts.
  // TODO[BACKEND]: Hydrate this name from GET /api/workflows/:id when the
  // canvas opens, and persist renames via PATCH /api/workflows/:id { name }.
  const [workflowName, setWorkflowName] = useState<string>(
    workflowId ? `Workflow Canvas (${workflowId})` : "Untitled Pipeline",
  );
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState<string>(workflowName);

  const handleCommitRename = () => {
    const trimmed = renameDraft.trim();
    if (trimmed && trimmed !== workflowName) {
      setWorkflowName(trimmed);
      // TODO[BACKEND]: Persist the new title — PATCH
      // /api/workflows/:workflowId { name: trimmed }.
    }
    setRenameDraft(trimmed || workflowName);
    setIsRenaming(false);
  };

  // Monotonic creation stamps for wires: Date.now() can collide within a
  // single millisecond, so force strictly increasing values to keep
  // many-to-one (LIFO) ordering unambiguous.
  const lastEdgeStamp = useRef(0);
  const nextEdgeTimestamp = () => {
    const now = Date.now();
    lastEdgeStamp.current =
      now > lastEdgeStamp.current ? now : lastEdgeStamp.current + 1;
    return lastEdgeStamp.current;
  };

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
    /** Port id the wire is anchored to ("output", "output-<index>", "data-source", ...). */
    portType: string;
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
    portType: string,
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

  // LIFO wire detachment from a port: find every wire attached to this exact
  // port — as its TARGET (input-style) or as its SOURCE (bi-directional
  // tool/hub ports) — pick the most recently added one (Last-In), unplug it
  // from the established set, and carry its free end on the cursor.
  // Older wires on the same port stay connected untouched.
  const handleTargetPortMouseDown = (
    e: React.MouseEvent,
    targetNodeId: string,
    targetPort: string,
  ) => {
    e.stopPropagation();

    const attached = edges.filter(
      (edge) =>
        (edge.toNodeId === targetNodeId && edge.toPort === targetPort) ||
        (edge.fromNodeId === targetNodeId && edge.fromPort === targetPort),
    );
    if (attached.length === 0) return;

    // Timestamps are monotonic; `>=` keeps array insertion order as the
    // tiebreaker, so the newest wire always wins.
    const latest = attached.reduce((newest, edge) =>
      edge.timestamp >= newest.timestamp ? edge : newest,
    );

    // Unplug only that wire from the established set...
    setEdges((prev) => prev.filter((edge) => edge.id !== latest.id));

    // ...anchor whichever end was NOT grabbed. If the user grabbed the wire
    // at its target end (classic input-port detach), the source end anchors
    // and the free target end follows the cursor — identical to the old
    // behavior. If they grabbed a bi-directional tool port (wire's source
    // end), the target end anchors instead. Drop in empty space = wire stays
    // deleted; drop on a valid port = handleConnectTarget re-establishes it.
    const grabbedAsTarget =
      latest.toNodeId === targetNodeId && latest.toPort === targetPort;
    const anchorNodeId = grabbedAsTarget
      ? latest.fromNodeId
      : latest.toNodeId;
    const anchorPort = grabbedAsTarget ? latest.fromPort : latest.toPort;
    const start = getNodePortCoord(anchorNodeId, anchorPort);
    const coords = screenToCanvasCoords(e.clientX, e.clientY);
    setActiveWire({
      sourceNodeId: anchorNodeId,
      portType: anchorPort,
      startX: start.x,
      startY: start.y,
      currentX: coords.x,
      currentY: coords.y,
      color: latest.color,
    });
  };

  // Bi-directional port (Tool top-center ↔ AI-agent bottom `data`/`gen`):
  // - No wires attached → start a fresh wire from this port.
  // - Wires attached → LIFO-detach the newest one (either direction).
  const handleBiDiPortMouseDown = (
    e: React.MouseEvent,
    nodeId: string,
    portId: string,
    color: string,
  ) => {
    e.stopPropagation();

    const attached = edges.some(
      (edge) =>
        (edge.toNodeId === nodeId && edge.toPort === portId) ||
        (edge.fromNodeId === nodeId && edge.fromPort === portId),
    );

    if (attached) {
      handleTargetPortMouseDown(e, nodeId, portId);
      return;
    }

    const start = getNodePortCoord(nodeId, portId);
    handleStartConnection(nodeId, portId, start, color);
  };

  const handleConnectTarget = (
    targetNodeId: string,
    targetPort: string,
  ) => {
    if (!activeWire || activeWire.sourceNodeId === targetNodeId) return;

    const fromNodeId = activeWire.sourceNodeId;
    const fromPort = activeWire.portType;
    const color = activeWire.color;

    // Many-to-one: a target port may hold an ARRAY of incoming wires sharing
    // the same targetNodeId + targetPortId. Only an exact duplicate (same
    // source node AND port → same target port) is rejected.
    setEdges((prev) => {
      const duplicate = prev.some(
        (e) =>
          e.fromNodeId === fromNodeId &&
          e.fromPort === fromPort &&
          e.toNodeId === targetNodeId &&
          e.toPort === targetPort,
      );
      if (duplicate) return prev;

      const timestamp = nextEdgeTimestamp();
      return [
        ...prev,
        {
          id: `edge-${timestamp}`,
          fromNodeId,
          toNodeId: targetNodeId,
          fromPort,
          toPort: targetPort,
          color,
          timestamp,
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

  // ---- Touch support (mobile / tablet) ----------------------------------
  // Touches map onto the editor's mouse logic: a touch on empty canvas pans
  // the viewport; a touch on a node body drives that node's existing window
  // mouse listeners via synthetic events. Ports keep native tap behavior.
  const touchState = useRef<{
    mode: "pan" | "node";
    target: Element | null;
  } | null>(null);
  const lastNodeTap = useRef<{ el: Element | null; time: number }>({
    el: null,
    time: 0,
  });

  const dispatchMouse = (
    type: string,
    clientX: number,
    clientY: number,
    target: Element,
  ) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
      }),
    );
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      // Multi-touch: cancel panning (no pinch-zoom; zoom buttons exist).
      touchState.current = null;
      setIsPanning(false);
      return;
    }

    const touch = e.touches[0];
    const el = e.target as Element;
    const onCanvasSurface =
      el === canvasRef.current || el.id === "grid-surface";
    const onPort = Boolean(el.closest(".connection-handle"));

    if (onCanvasSurface) {
      touchState.current = { mode: "pan", target: null };
      setIsPanning(true);
      setStartPan({
        x: touch.clientX - position.x,
        y: touch.clientY - position.y,
      });
      return;
    }

    // A touch on a node body starts a node drag by feeding the node's
    // mouse-down handler; ports/buttons keep their native tap behavior.
    const nodeRoot = el.closest(
      '[title="Double-click to open settings"]',
    );
    if (!onPort && nodeRoot) {
      touchState.current = { mode: "node", target: nodeRoot };
      dispatchMouse("mousedown", touch.clientX, touch.clientY, el);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const state = touchState.current;
    if (!state || e.touches.length !== 1) return;
    const touch = e.touches[0];

    if (state.mode === "pan") {
      setPosition({
        x: touch.clientX - startPan.x,
        y: touch.clientY - startPan.y,
      });
      return;
    }

    // One synthetic mousemove feeds both listeners: the node's window
    // drag listener and the canvas React move handler (wire/pan bookkeeping).
    dispatchMouse(
      "mousemove",
      touch.clientX,
      touch.clientY,
      canvasRef.current ?? (e.target as Element),
    );
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const state = touchState.current;
    touchState.current = null;
    if (!state) return;

    const touch = e.changedTouches[0];

    if (state.mode === "node" && touch && state.target) {
      // Release over whatever is under the finger: a port reconnects the
      // carried wire, the trash zone deletes the node, empty space drops it.
      const dropTarget =
        document.elementFromPoint(touch.clientX, touch.clientY) ??
        canvasRef.current;
      if (dropTarget) {
        dispatchMouse("mouseup", touch.clientX, touch.clientY, dropTarget);
      }

      // Double-tap opens node settings (mirrors the desktop double-click).
      const now = Date.now();
      if (
        lastNodeTap.current.el === state.target &&
        now - lastNodeTap.current.time < 320
      ) {
        dispatchMouse("dblclick", touch.clientX, touch.clientY, state.target);
        lastNodeTap.current = { el: null, time: 0 };
      } else {
        lastNodeTap.current = { el: state.target, time: now };
      }
    }

    // Mirror handleMouseUpWithWire: end panning and drop any carried wire.
    handleMouseUpWithWire();
  };

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

  const handleOpenSettings = (nodeId: string) => setSettingsNodeId(nodeId);
  const handleCloseSettings = () => setSettingsNodeId(null);

  const settingsNode = settingsNodeId
    ? nodes.find((n) => n.id === settingsNodeId) ?? null
    : null;

  const handleUpdateNodeConfig = (
    id: string,
    patch: Record<string, unknown>,
  ) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, config: { ...n.config, ...patch } } : n,
      ),
    );
  };  const getNodePortCoord = (nodeId: string, portId: string) => {
    const n = nodes.find((item) => item.id === nodeId);
    if (!n) return { x: 0, y: 0 };

    // Pixel-perfect: read the live port element for ANY node family,
    // including dynamic branch ports like `output-2`.
    const portEl = canvasRef.current?.querySelector(
      `[data-port-id="${nodeId}-${portId}"]`,
    );
    if (portEl && canvasRef.current) {
      const portRect = portEl.getBoundingClientRect();
      const canvasRect = canvasRef.current.getBoundingClientRect();
      return {
        x:
          (portRect.left +
            portRect.width /2 -
            canvasRect.left -
            position.x) /
          scale,
        y:
          (portRect.top + portRect.height / 2 - canvasRect.top - position.y) /
          scale,
      };
    }

    // Layout fallbacks used before the first paint (element not mounted yet).
    const measuredWidth = nodeSizes[nodeId]?.width || 240;
    const measuredHeight = nodeSizes[nodeId]?.height || 60;
    if (n.type.startsWith("trigger-"))
      return { x: n.position.x + measuredWidth, y: n.position.y + 32 };
    if (n.type.startsWith("agent-")) {
      // Compact card: input/output at vertical center; bottom edge hosts two
      // bi-directional ports — `data` at 30% (emerald) and `gen` at 70% (sky).
      if (portId === "data")
        return {
          x: n.position.x + measuredWidth * 0.3,
          y: n.position.y + measuredHeight,
        };
      if (portId === "gen")
        return {
          x: n.position.x + measuredWidth * 0.7,
          y: n.position.y + measuredHeight,
        };
      // Legacy center fallback (pre-paint only; the rendered port no longer exists).
      if (portId === "tool")
        return {
          x: n.position.x + measuredWidth / 2,
          y: n.position.y + measuredHeight,
        };
      return {
        x: portId === "input" ? n.position.x : n.position.x + measuredWidth,
        y: n.position.y + measuredHeight / 2,
      };
    }
    if (n.type.startsWith("logic-")) {
      // Header ≈54px, then tinted branch rows: h-7 + gap-3 + 4px top pad
      // → row centers at +72 and +112. Input port centered at +30.
      if (portId === "input") return { x: n.position.x, y: n.position.y + 30 };
      const branchIndex = Number(portId.split("-")[1] ?? 0);
      return {
        x: n.position.x + measuredWidth,
        y: n.position.y + 72 + branchIndex * 40,
      };
    }
    if (n.type === "approval-human") {
      // Same branch-zone layout as the If/Else node.
      if (portId === "input")
        return { x: n.position.x, y: n.position.y + 30 };
      const row = portId === "output-rejected" ? 1 : 0;
      return {
        x: n.position.x + measuredWidth,
        y: n.position.y + 72 + row * 40,
      };
    }
    if (n.type === "document-generator") {
      // Tool node: single bi-directional port at top-center.
      return { x: n.position.x + measuredWidth / 2, y: n.position.y };
    }
    if (n.type.startsWith("connector-")) {
      if (portId === "tool")
        // Tool connectors (REST/Database): top-center bi-directional port.
        return { x: n.position.x + measuredWidth / 2, y: n.position.y };
      // Terminal connectors (Gmail/Telegram): input at vertical center.
      return { x: n.position.x, y: n.position.y + 30 };
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
      className="h-full w-full flex flex-col bg-background select-none overflow-hidden relative"
    >
      {/* Subheader */}
      <div className="h-14 bg-surface border-b border-subtle px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-2 rounded-lg text-muted hover:text-primary hover:bg-surface-hover transition-colors"
          >
            <FiArrowLeft className="w-4 h-4" />
          </button>
          <div className="h-4 w-px bg-surface-hover" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {/* Inline rename: click the title to edit, Enter/blur commits,
                  Escape reverts. */}
              {isRenaming ? (
                <input
                  type="text"
                  autoFocus
                  aria-label="Workflow name"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={handleCommitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCommitRename();
                    if (e.key === "Escape") {
                      setRenameDraft(workflowName);
                      setIsRenaming(false);
                    }
                  }}
                  className="text-xs font-semibold text-primary bg-surface-hover border border-accent-primary/50 rounded px-1.5 py-0.5 focus:outline-none w-[200px] max-w-[45vw]"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRenameDraft(workflowName);
                    setIsRenaming(true);
                  }}
                  title="Click to rename this workflow"
                  className="group flex items-center gap-1.5 min-w-0 rounded border border-transparent px-1.5 py-0.5 -ml-1.5 hover:border-subtle hover:bg-surface-hover/60 transition-colors"
                >
                  <span className="text-xs font-semibold text-primary truncate group-hover:text-accent-primary transition-colors">
                    {workflowName}
                  </span>
                  <FiEdit2 className="w-3 h-3 text-faint group-hover:text-accent-primary shrink-0" />
                </button>
              )}
              <span className="hidden sm:block px-1.5 py-0.5 rounded text-[10px] font-mono bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                Draft
              </span>
            </div>
            <p className="text-[10px] text-faint hidden sm:block">
              Auto-saved 2 minutes ago
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsCatalogOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors"
          >
            <FiPlus className="w-3.5 h-3.5 text-accent-primary" />
            <span className="hidden sm:inline">Add Node</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-strong bg-surface-hover/60 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors"
          >
            <FiPlay className="w-3.5 h-3.5 text-success" />
            <span className="hidden sm:inline">Test Run</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-sm shadow-accent-primary/40"
          >
            <FiSave className="w-3.5 h-3.5 stroke-[2.5]" />
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </div>

      {/* // UI-REGION: Canvas — custom node drawing surface (pan/zoom
          transform layer, SVG wire layer, placed nodes, trash zone, zoom
          controls). */}
      {/* Canvas */}
      <div
        ref={canvasRef}
        id="grid-surface"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveWithWire}
        onMouseUp={handleMouseUpWithWire}
        onMouseLeave={handleMouseUpWithWire}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          backgroundPosition: `${position.x}px ${position.y}px`,
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundImage: `radial-gradient(circle, var(--border-strong) 1px, transparent 1px)`,
        }}
        className={`flex-1 relative overflow-hidden bg-background touch-none ${
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
                    style={{ stroke: edge.color }}
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
                style={{ stroke: activeWire.color }}
                strokeWidth="2.5"
                strokeDasharray="4 4"
              />
            )}
          </svg>

          {/* Empty State */}
          {nodes.length === 0 && (
            <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
              <div className="border border-dashed border-subtle rounded-2xl p-8 bg-surface/80 backdrop-blur-sm text-center w-80 shadow-2xl">
                <div className="h-10 w-10 rounded-xl bg-accent-primary/10 border border-accent-primary/20 text-accent-primary flex items-center justify-center mx-auto mb-3">
                  <FiZap className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-semibold text-primary">
                  Empty Pipeline Canvas
                </h3>
                <p className="text-xs text-muted mt-1 mb-4 leading-relaxed">
                  Click or drag your first trigger node into the workspace to
                  begin.
                </p>
                <button
                  type="button"
                  onClick={() => setIsCatalogOpen(true)}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-accent-primary hover:bg-accent-primary-hover text-accent-contrast font-semibold text-xs transition-colors shadow-md shadow-accent-primary/40"
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
                  onUpdateConfig={handleUpdateNodeConfig}
                  onOpenSettings={handleOpenSettings}
                  onDragStart={handleNodeDragStart}
                  onDragMove={handleNodeDragMove}
                  onDragEnd={handleNodeDragEnd}
                />
                );
              }
              if (node.type.startsWith("agent-")) {
                return (                  <AINode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdateSize={handleUpdateNodeSize}
                    onUpdatePosition={handleUpdateNodePosition}
                    onStartConnection={handleStartConnection}
                    onConnectTarget={handleConnectTarget}
                    onTargetPortMouseDown={handleTargetPortMouseDown}
                    onBiDiPortMouseDown={handleBiDiPortMouseDown}
                    toCanvasCoords={screenToCanvasCoords}
                    onOpenSettings={handleOpenSettings}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              if (node.type.startsWith("logic-")) {
                return (
                <LogicNode
                  key={node.id}
                  node={node}
                  scale={scale}
                  onUpdateSize={handleUpdateNodeSize}
                  onUpdatePosition={handleUpdateNodePosition}
                  onUpdateConfig={handleUpdateNodeConfig}
                  onStartConnection={handleStartConnection}
                  onConnectTarget={handleConnectTarget}
                  onTargetPortMouseDown={handleTargetPortMouseDown}
                  toCanvasCoords={screenToCanvasCoords}
                  onOpenSettings={handleOpenSettings}
                  onDragStart={handleNodeDragStart}
                  onDragMove={handleNodeDragMove}
                  onDragEnd={handleNodeDragEnd}
                />
                );
              }
              if (node.type.startsWith("connector-")) {
                return (
                  <ConnectorNode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdateSize={handleUpdateNodeSize}
                    onUpdatePosition={handleUpdateNodePosition}
                    onUpdateConfig={handleUpdateNodeConfig}
                    onStartConnection={handleStartConnection}
                    onConnectTarget={handleConnectTarget}
                    onTargetPortMouseDown={handleTargetPortMouseDown}
                    onBiDiPortMouseDown={handleBiDiPortMouseDown}
                    toCanvasCoords={screenToCanvasCoords}
                    onOpenSettings={handleOpenSettings}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              if (node.type === "approval-human") {
                return (
                  <ApprovalNode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdateSize={handleUpdateNodeSize}
                    onUpdatePosition={handleUpdateNodePosition}
                    onUpdateConfig={handleUpdateNodeConfig}
                    onStartConnection={handleStartConnection}
                    onConnectTarget={handleConnectTarget}
                    onTargetPortMouseDown={handleTargetPortMouseDown}
                    toCanvasCoords={screenToCanvasCoords}
                    onOpenSettings={handleOpenSettings}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              if (node.type === "document-generator") {
                return (
                  <DocumentNode
                    key={node.id}
                    node={node}
                    scale={scale}
                    onUpdateSize={handleUpdateNodeSize}
                    onUpdatePosition={handleUpdateNodePosition}
                    onUpdateConfig={handleUpdateNodeConfig}
                    onStartConnection={handleStartConnection}
                    onConnectTarget={handleConnectTarget}
                    onTargetPortMouseDown={handleTargetPortMouseDown}
                    onBiDiPortMouseDown={handleBiDiPortMouseDown}
                    toCanvasCoords={screenToCanvasCoords}
                    onOpenSettings={handleOpenSettings}
                    onDragStart={handleNodeDragStart}
                    onDragMove={handleNodeDragMove}
                    onDragEnd={handleNodeDragEnd}
                  />
                );
              }
              return null;
            })}
          </div>

          {/* Wire-endpoint detachment now lives on the target ports themselves
              (LIFO grab) — see handleTargetPortMouseDown. */}
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
                ? "bg-danger/10 border-danger text-danger scale-105 ring-2 ring-danger/40"
                : "bg-surface border-strong text-secondary"
            }`}
          >
            <FiTrash2
              className={`w-4 h-4 shrink-0 transition-transform duration-200 ${
                isOverTrash
                  ? "scale-110 text-danger animate-bounce"
                  : "text-muted"
              }`}
            />
            <span className="text-xs font-semibold whitespace-nowrap">
              {isOverTrash ? "Release to Delete" : "Drag here to remove"}
            </span>
          </div>
        </div>

        {/* Viewport Zoom Controls */}
        <div className="absolute bottom-5 right-5 flex items-center gap-1 bg-surface/90 backdrop-blur border border-subtle rounded-lg p-1 shadow-lg z-20">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s + 0.1, 2.0))}
            className="p-2 text-muted hover:text-primary hover:bg-surface-hover rounded transition-colors"
          >
            <FiZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s - 0.1, 0.4))}
            className="p-2 text-muted hover:text-primary hover:bg-surface-hover rounded transition-colors"
          >
            <FiZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-muted px-1.5 min-w-[42px] text-center select-none">
            {Math.round(scale * 100)}%
          </span>
          <div className="h-3 w-px bg-surface-hover" />
          <button
            type="button"
            onClick={centerCanvas}
            className="px-2.5 py-1.5 text-[11px] text-muted hover:text-primary hover:bg-surface-hover rounded transition-colors"
          >
            Reset
          </button>
          <div className="h-3 w-px bg-surface-hover" />
          <button
            type="button"
            onClick={handleToggleFullscreen}
            className="p-2 text-muted hover:text-primary hover:bg-surface-hover rounded transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen Canvas"}
          >
            {isFullscreen ? (
              <FiMinimize2 className="w-3.5 h-3.5 text-accent-primary" />
            ) : (
              <FiMaximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* // UI-REGION: Sidebar — Node Library (draggable node palette modal) */}
      <NodeCatalogModal
        isOpen={isCatalogOpen}
        onClose={() => setIsCatalogOpen(false)}
        onSelectNode={handleSelectNode}
      />

      {/* // UI-REGION: Node Settings Drawer (double-click config panel) */}
      {settingsNode && (
        <NodeSettingsModal
          node={settingsNode}
          onClose={handleCloseSettings}
          onUpdateConfig={handleUpdateNodeConfig}
        />
      )}
    </div>
  );
};

export default WorkflowEditor;
