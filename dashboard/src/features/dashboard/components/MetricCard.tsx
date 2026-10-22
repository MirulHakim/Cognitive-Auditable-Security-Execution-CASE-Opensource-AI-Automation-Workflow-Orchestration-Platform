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
    <div className="bg-surface border border-subtle rounded-xl p-5 flex items-center justify-between">
      <div>
        <p className="text-xs text-muted font-medium uppercase tracking-wider">
          {label}
        </p>
        <p className="text-2xl font-bold text-primary mt-1">{value}</p>
        {change && (
          <span className="text-xs text-success mt-1 inline-block">
            {change}
          </span>
        )}
      </div>
      <div className="p-3 bg-surface-sunken rounded-lg text-accent-primary border border-subtle">
        <Icon className="w-5 h-5" />
      </div>
    </div>
  );
};
