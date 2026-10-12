import React from "react";
import type { IconType } from "react-icons";

interface MetricCardProps {
  label: string;
  value: string | number;
  change?: string;
  icon: IconType;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  change,
  icon: Icon,
}) => {
  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-5 flex items-center justify-between">
      <div>
        <p className="text-xs text-slate-400 font-medium uppercase tracking-wider">
          {label}
        </p>
        <p className="text-2xl font-bold text-white mt-1">{value}</p>
        {change && (
          <span className="text-xs text-emerald-400 mt-1 inline-block">
            {change}
          </span>
        )}
      </div>
      <div className="p-3 bg-slate-900 rounded-lg text-cyan-400 border border-slate-800">
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
};
