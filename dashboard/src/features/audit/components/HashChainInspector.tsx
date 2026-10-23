import React, { useState } from "react";
import {
  FiChevronDown,
  FiChevronUp,
  FiCheckCircle,
  FiCopy,
  FiCheck,
  FiRefreshCw,
  FiLink,
} from "react-icons/fi";

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
    <div className="bg-surface border border-subtle rounded-xl p-5 shadow-sm flex flex-col justify-between text-secondary">
      <div>
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-subtle">
          <div className="flex items-center gap-2">
            <FiLink className="text-accent-primary w-4 h-4" />
            <h3 className="text-sm font-semibold text-primary">
              Position in the hash chain
            </h3>
          </div>
          <span className="text-[11px] font-mono text-muted">SHA-256</span>
        </div>

        {/* 1. PREVIOUS RECORD BLOCK */}
        {previousRecord && (
          <div className="relative">
            <div
              onClick={() => toggleExpand("prev")}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                expandedCards.prev
                  ? "bg-surface-sunken/90 border-strong"
                  : "bg-background border-subtle/80 hover:border-strong"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-secondary">
                      Previous · #{previousRecord.sequence}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-hover border border-strong text-secondary">
                      {previousRecord.action}
                    </span>
                  </div>
                  {!expandedCards.prev && (
                    <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-faint">
                      <span>hash:</span>
                      <span className="text-accent-primary/80">
                        {truncateHash(previousRecord.hash)}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-faint hover:text-secondary">
                    {expandedCards.prev ? "Hide hashes" : "Show hashes"}
                  </span>
                  {expandedCards.prev ? (
                    <FiChevronUp className="w-3.5 h-3.5 text-muted" />
                  ) : (
                    <FiChevronDown className="w-3.5 h-3.5 text-muted" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedCards.prev && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-3 pt-3 border-t border-subtle space-y-2 text-[11px] font-mono cursor-default"
                >
                  <div>
                    <span className="text-faint block">prev_hash</span>
                    <div className="flex items-center justify-between bg-background p-1.5 rounded border border-subtle/60 mt-0.5">
                      <span className="text-muted break-all select-all">
                        {previousRecord.prevHash}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(previousRecord.prevHash, "prev-prev")
                        }
                        className="p-1 hover:text-primary text-faint ml-2 shrink-0"
                      >
                        {copiedHash === "prev-prev" ? (
                          <FiCheck className="text-success w-3 h-3" />
                        ) : (
                          <FiCopy className="w-3 h-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="text-faint block">hash</span>
                    <div className="flex items-center justify-between bg-background p-1.5 rounded border border-subtle/60 mt-0.5">
                      <span className="text-accent-primary break-all select-all">
                        {previousRecord.hash}
                      </span>
                      <button
                        onClick={() =>
                          copyToClipboard(previousRecord.hash, "prev-hash")
                        }
                        className="p-1 hover:text-primary text-faint ml-2 shrink-0"
                      >
                        {copiedHash === "prev-hash" ? (
                          <FiCheck className="text-success w-3 h-3" />
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
            <div className="py-2 flex items-center justify-center text-[10px] text-faint font-mono gap-1">
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
                ? "bg-accent-primary/20 border-accent-primary/40 ring-1 ring-accent-primary/30"
                : "bg-surface-sunken border-accent-primary/30 hover:border-accent-primary/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-primary">
                    This record · #{currentRecord.sequence}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/20 font-semibold">
                    {currentRecord.action}
                  </span>
                </div>
                {!expandedCards.current && (
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono text-muted">
                    <span>hash:</span>
                    <span className="text-accent-primary font-medium">
                      {truncateHash(currentRecord.hash)}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] text-accent-primary hover:underline">
                  {expandedCards.current ? "Collapse" : "Expand hashes"}
                </span>
                {expandedCards.current ? (
                  <FiChevronUp className="w-3.5 h-3.5 text-accent-primary" />
                ) : (
                  <FiChevronDown className="w-3.5 h-3.5 text-accent-primary" />
                )}
              </div>
            </div>

            {/* Expanded Current Details */}
            {expandedCards.current && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="mt-3 pt-3 border-t border-subtle space-y-2 text-[11px] font-mono cursor-default"
              >
                <div>
                  <span className="text-faint block">prev_hash</span>
                  <div className="flex items-center justify-between bg-background p-1.5 rounded border border-subtle/80 mt-0.5">
                    <span className="text-muted break-all select-all">
                      {currentRecord.prevHash}
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(currentRecord.prevHash, "curr-prev")
                      }
                      className="p-1 hover:text-primary text-faint ml-2 shrink-0"
                    >
                      {copiedHash === "curr-prev" ? (
                        <FiCheck className="text-success w-3 h-3" />
                      ) : (
                        <FiCopy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <span className="text-faint block">hash</span>
                  <div className="flex items-center justify-between bg-background p-1.5 rounded border border-accent-primary/30 mt-0.5">
                    <span className="text-accent-primary font-medium break-all select-all">
                      {currentRecord.hash}
                    </span>
                    <button
                      onClick={() =>
                        copyToClipboard(currentRecord.hash, "curr-hash")
                      }
                      className="p-1 hover:text-primary text-faint ml-2 shrink-0"
                    >
                      {copiedHash === "curr-hash" ? (
                        <FiCheck className="text-success w-3 h-3" />
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
          <div className="py-2 flex items-center justify-center text-[10px] text-faint font-mono gap-1">
            <span>↓</span>
            <span>this hash is stored as the next record's prev_hash</span>
          </div>
        </div>

        {/* 3. NEXT RECORD BLOCK */}
        <div className="p-3.5 rounded-xl border border-subtle/80 bg-background">
          <span className="text-xs font-semibold text-muted block">
            Next
          </span>
          <p className="text-[11px] text-faint mt-1">
            {nextRecord
              ? `Next · #${nextRecord.sequence} (${nextRecord.action})`
              : "Latest record — nothing after it yet"}
          </p>
        </div>
      </div>

      {/* 4. FORMULA & RECOMPUTE BUTTON */}
      <div className="mt-5 pt-4 border-t border-subtle space-y-3">
        <p className="text-[10px] font-mono text-faint truncate">
          hash = SHA-256(seq, ts, actor, role, action, target, source, outcome,
          details, prev_hash)
        </p>

        {/* // TODO[BACKEND]: "Recompute this hash now" must trigger a real
            SHA-256 computation over the current record's payload
            (seq, ts, actor, role, action, target, source, outcome, details,
            prev_hash) — e.g. POST /api/audit/verify/:id — and compare the
            freshly computed digest against the stored prev_hash to detect tampering, instead of the mocked in-memory match/fail result. */}
        <button
          type="button"
          onClick={handleRecomputeHash}
          disabled={isVerifying}
          className="px-3 py-1.5 rounded-lg border border-strong bg-surface-hover/80 hover:bg-surface-hover text-xs font-medium text-secondary transition-colors flex items-center gap-2 disabled:opacity-50"
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
          <div className="p-3 rounded-lg bg-success/10 border border-success/40 text-success text-xs font-mono animate-in fade-in duration-200">
            <div className="flex items-center gap-1.5 font-bold">
              <FiCheckCircle className="w-4 h-4 text-success" />
              <span>Match. The record is unchanged.</span>
            </div>
            <div className="text-[10px] text-success/80 mt-1 break-all select-all">
              computed {currentRecord.hash}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HashChainInspector;
