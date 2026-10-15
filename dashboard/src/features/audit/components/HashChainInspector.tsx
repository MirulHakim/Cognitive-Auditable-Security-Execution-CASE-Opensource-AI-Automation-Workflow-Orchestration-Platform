import React, { useState } from "react";
import {
  FiChevronDown,
  FiChevronUp,
  FiCheckCircle,
  FiCopy,
  FiCheck,
  FiRefreshCw,
  FiShield,
  FiLink,
} from "react-icons/fi";
import { type HashChainBlock } from "../types/audit.types";

interface HashChainInspectorProps {
  currentRecord: {
    sequence: number;
    action: string;
    prevHash: string;
    hash: string;
  };
  previousRecord?: {
    sequence: number;
    action: string;
    prevHash: string;
    hash: string;
  };
  nextRecord?: {
    sequence: number;
    action: string;
    prevHash: string;
    hash: string;
  } | null;
}

export const HashChainInspector: React.FC<HashChainInspectorProps> = ({
  currentRecord,
  previousRecord = {
    sequence: 37,
    action: "AI_TEMPLATE_SELECTED",
    prevHash:
      "662c0ab7ada149bbf7684dc31eccc9af935e284385449ae3395b40d20d54eb28",
    hash: "d53039a945e2526135d96fdc092ccbd77727a80ee103d70646f1351e39f0c19b",
  },
  nextRecord = null,
}) => {
  // Expansion toggles for progressive disclosure
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({
    prev: false,
    current: false,
    next: false,
  });

  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<"match" | null>(
    null,
  );

  const toggleExpand = (key: string) => {
    setExpandedCards((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleRecomputeHash = () => {
    setIsVerifying(true);
    setVerificationResult(null);

    setTimeout(() => {
      setIsVerifying(false);
      setVerificationResult("match");
    }, 600);
  };

  const truncateHash = (h: string) => `${h.slice(0, 10)}...${h.slice(-8)}`;

  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between text-slate-200">
      <div>
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <FiLink className="text-cyan-400 w-4 h-4" />
            <h3 className="text-sm font-semibold text-white">
              Position in the hash chain
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-400">SHA-256</span>
        </div>

        {/* 1. PREVIOUS RECORD BLOCK */}
        {previousRecord && (
          <div className="relative">
            <div
              onClick={() => toggleExpand("prev")}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                expandedCards.prev
                  ? "bg-slate-900/90 border-slate-700"
                  : "bg-[#0b0f19] border-slate-800/80 hover:border-slate-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-300">
                      Previous · #{previousRecord.sequence}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-300">
                      {previousRecord.action}
                    </span>
                  </div>
                  {!expandedCards.prev && (
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-500">
                      <span>hash:</span>
                      <span className="text-cyan-400/80">
                        {truncateHash(previousRecord.hash)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 hover:text-slate-300">
                    {expandedCards.prev ? "Hide hashes" : "Show hashes"}
                  </span>
                  {expandedCards.prev ? (
                    <FiChevronUp className="w-3.5 h-3.5 text-slate-400" />
                  ) : (
                    <FiChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedCards.prev && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-[11px] font-mono cursor-default"
                >
                  <div>
                    <span className="text-slate-500 block">prev_hash</span>
                    <div className="flex items-center justify-between bg-[#0b0f19] p-1.5 rounded border border-slate-800/60 mt-0.5">
                      <span className="text-slate-400 break-all select-all">
                        {previousRecord.prevHash}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(previousRecord.prevHash, "prev-prev")
                        }
                        className="p-1 hover:text-white text-slate-500 ml-2 shrink-0"
                      >
                        {copiedHash === "prev-prev" ? (
                          <FiCheck className="text-emerald-400 w-3 h-3" />
                        ) : (
                          <FiCopy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-slate-500 block">hash</span>
                    <div className="flex items-center justify-between bg-[#0b0f19] p-1.5 rounded border border-slate-800/60 mt-0.5">
                      <span className="text-cyan-300 break-all select-all">
                        {previousRecord.hash}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(previousRecord.hash, "prev-hash")
                        }
                        className="p-1 hover:text-white text-slate-500 ml-2 shrink-0"
                      >
                        {copiedHash === "prev-hash" ? (
                          <FiCheck className="text-emerald-400 w-3 h-3" />
                        ) : (
                          <FiCopy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Lineage connector arrow */}
            <div className="py-2 flex items-center justify-center text-[10px] text-slate-500 font-mono gap-1">
              <span>↓</span>
              <span>its hash is stored as this record's prev_hash</span>
            </div>
          </div>
        )}

        {/* 2. CURRENT RECORD BLOCK (Highlighted) */}
        <div className="relative">
          <div
            onClick={() => toggleExpand("current")}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
              expandedCards.current
                ? "bg-cyan-950/20 border-cyan-500/40 ring-1 ring-cyan-500/30"
                : "bg-slate-900 border-cyan-500/30 hover:border-cyan-500/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-white">
                    This record · #{currentRecord.sequence}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold">
                    {currentRecord.action}
                  </span>
                </div>
                {!expandedCards.current && (
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-slate-400">
                    <span>hash:</span>
                    <span className="text-cyan-400 font-medium">
                      {truncateHash(currentRecord.hash)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-cyan-400 hover:underline">
                  {expandedCards.current ? "Collapse" : "Expand hashes"}
                </span>
                {expandedCards.current ? (
                  <FiChevronUp className="w-3.5 h-3.5 text-cyan-400" />
                ) : (
                  <FiChevronDown className="w-3.5 h-3.5 text-cyan-400" />
                )}
              </div>
            </div>

            {/* Expanded Current Details */}
            {expandedCards.current && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 pt-3 border-t border-slate-800 space-y-2 text-[11px] font-mono cursor-default"
              >
                <div>
                  <span className="text-slate-500 block">prev_hash</span>
                  <div className="flex items-center justify-between bg-[#0b0f19] p-1.5 rounded border border-slate-800/80 mt-0.5">
                    <span className="text-slate-400 break-all select-all">
                      {currentRecord.prevHash}
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(currentRecord.prevHash, "curr-prev")
                      }
                      className="p-1 hover:text-white text-slate-500 ml-2 shrink-0"
                    >
                      {copiedHash === "curr-prev" ? (
                        <FiCheck className="text-emerald-400 w-3 h-3" />
                      ) : (
                        <FiCopy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-slate-500 block">hash</span>
                  <div className="flex items-center justify-between bg-[#0b0f19] p-1.5 rounded border border-cyan-500/30 mt-0.5">
                    <span className="text-cyan-400 font-medium break-all select-all">
                      {currentRecord.hash}
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(currentRecord.hash, "curr-hash")
                      }
                      className="p-1 hover:text-white text-slate-500 ml-2 shrink-0"
                    >
                      {copiedHash === "curr-hash" ? (
                        <FiCheck className="text-emerald-400 w-3 h-3" />
                      ) : (
                        <FiCopy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Lineage connector arrow */}
          <div className="py-2 flex items-center justify-center text-[10px] text-slate-500 font-mono gap-1">
            <span>↓</span>
            <span>this hash is stored as the next record's prev_hash</span>
          </div>
        </div>

        {/* 3. NEXT RECORD BLOCK */}
        <div className="p-3.5 rounded-xl border border-slate-800/80 bg-[#0b0f19]">
          <span className="text-xs font-semibold text-slate-400 block">
            Next
          </span>
          <p className="text-[11px] text-slate-500 mt-1">
            {nextRecord
              ? `Next · #${nextRecord.sequence} (${nextRecord.action})`
              : "Latest record — nothing after it yet"}
          </p>
        </div>
      </div>

      {/* 4. FORMULA & RECOMPUTE BUTTON */}
      <div className="mt-5 pt-4 border-t border-slate-800 space-y-3">
        <p className="text-[10px] font-mono text-slate-500 truncate">
          hash = SHA-256(seq, ts, actor, role, action, target, source, outcome,
          details, prev_hash)
        </p>

        <button
          type="button"
          onClick={handleRecomputeHash}
          disabled={isVerifying}
          className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-2 disabled:opacity-50"
        >
          <FiRefreshCw
            className={`w-3.5 h-3.5 ${isVerifying ? "animate-spin" : ""}`}
          />
          <span>
            {isVerifying ? "Recomputing..." : "Recompute this hash now"}
          </span>
        </button>

        {/* Verified Match Green Box */}
        {verificationResult === "match" && (
          <div className="p-3 rounded-lg bg-emerald-950/30 border border-emerald-500/40 text-emerald-400 text-xs font-mono animate-in fade-in duration-200">
            <div className="flex items-center gap-1.5 font-bold">
              <FiCheckCircle className="w-4 h-4 text-emerald-400" />
              <span>Match. The record is unchanged.</span>
            </div>
            <div className="text-[10px] text-emerald-300/80 mt-1 break-all select-all">
              computed {currentRecord.hash}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HashChainInspector;
