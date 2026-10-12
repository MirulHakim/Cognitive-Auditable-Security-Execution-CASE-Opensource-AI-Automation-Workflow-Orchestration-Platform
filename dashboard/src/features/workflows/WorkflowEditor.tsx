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
} from "react-icons/fi";

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

  // Canvas Transform State (Pan & Zoom)
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

  // Center canvas coordinate system to the middle of the screen
  const centerCanvas = useCallback(() => {
    if (!canvasRef.current) return;
    const { clientWidth, clientHeight } = canvasRef.current;
    setPosition({
      x: clientWidth / 2,
      y: clientHeight / 2,
    });
    setScale(1);
  }, []);

  // Initial center on mount
  useEffect(() => {
    centerCanvas();
  }, [centerCanvas]);

  // Sync fullscreen state if user exits via ESC key
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Fullscreen toggle handler
  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      try {
        await containerRef.current.requestFullscreen();
      } catch (err) {
        console.error("Failed to enter fullscreen:", err);
      }
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    const delta = e.deltaY < 0 ? zoomFactor : -zoomFactor;
    setScale((prev) => Math.min(Math.max(0.4, prev + delta), 2.0));
  };

  // Start panning on left click or middle click
  const handleMouseDown = (e: React.MouseEvent) => {
    // Only drag when clicking the canvas surface or background
    if (
      e.target === canvasRef.current ||
      (e.target as HTMLElement).id === "grid-surface"
    ) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    setPosition({
      x: e.clientX - startPan.x,
      y: e.clientY - startPan.y,
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  return (
    <div
      ref={containerRef}
      className="h-full w-full flex flex-col bg-[#0b0f19] select-none overflow-hidden relative"
    >
      {/* Editor Subheader & Action Controls */}
      <div className="h-14 bg-[#0f172a] border-b border-slate-800 px-4 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="Back to Workflows"
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

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
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
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors shadow-sm shadow-cyan-400/20"
          >
            <FiSave className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>Save</span>
          </button>
        </div>
      </div>

      {/* Infinite Grid Canvas Workspace */}
      <div
        ref={canvasRef}
        id="grid-surface"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          backgroundPosition: `${position.x}px ${position.y}px`,
          backgroundSize: `${24 * scale}px ${24 * scale}px`,
          backgroundImage: `radial-gradient(circle, #334155 1px, transparent 1px)`,
        }}
        className={`flex-1 relative overflow-hidden bg-[#0b0f19] ${
          isPanning ? "cursor-grabbing" : "cursor-grab"
        }`}
      >
        {/* Transformable Canvas Object Space */}
        <div
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
          className="absolute top-0 left-0 pointer-events-none"
        >
          {/* Centered Node / Prompt Container */}
          <div className="absolute top-0 left-0 -translate-x-1/2 -translate-y-1/2 pointer-events-auto">
            <div className="border border-dashed border-slate-800 rounded-2xl p-8 bg-[#0f172a]/80 backdrop-blur-sm text-center w-80 shadow-2xl">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mx-auto mb-3">
                <FiZap className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-semibold text-white">
                Empty Pipeline Canvas
              </h3>
              <p className="text-xs text-slate-400 mt-1 mb-4 leading-relaxed">
                Begin constructing your workflow by dropping a trigger node or
                connecting AI agent components.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-semibold text-xs transition-colors shadow-md shadow-cyan-400/20"
              >
                <FiPlus className="w-4 h-4 stroke-[2.5]" />
                <span>Add First Node</span>
              </button>
            </div>
          </div>
        </div>

        {/* Floating Canvas Viewport Controls */}
        <div className="absolute bottom-5 right-5 flex items-center gap-1 bg-[#0f172a]/90 backdrop-blur border border-slate-800 rounded-lg p-1 shadow-lg z-20">
          <button
            type="button"
            onClick={() => setScale((s) => Math.min(s + 0.1, 2.0))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Zoom In"
          >
            <FiZoomIn className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setScale((s) => Math.max(s - 0.1, 0.4))}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Zoom Out"
          >
            <FiZoomOut className="w-4 h-4" />
          </button>

          <span className="text-[11px] font-mono text-slate-400 px-1.5 min-w-10.5 text-center select-none">
            {Math.round(scale * 100)}%
          </span>

          <div className="h-3 w-px bg-slate-800" />

          {/* Reset Zoom & Pan */}
          <button
            type="button"
            onClick={centerCanvas}
            className="px-2 py-1 text-[11px] text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"
            title="Reset View"
          >
            Reset
          </button>

          <div className="h-3 w-px bg-slate-800" />

          {/* Fullscreen Button */}
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
    </div>
  );
};

export default WorkflowEditor;
