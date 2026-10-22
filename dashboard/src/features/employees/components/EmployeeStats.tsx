import React from "react";
import { FiUsers, FiShield, FiUserCheck, FiEye } from "react-icons/fi";
import { type Employee } from "./EmployeeList";

interface EmployeeStatsProps {
  employees: Employee[];
}

export const EmployeeStats: React.FC<EmployeeStatsProps> = ({ employees }) => {
  const total = employees.length;
  const activeCount = employees.filter((e) => e.status === "active").length;
  const adminCount = employees.filter((e) => e.role === "admin").length;
  const staffCount = employees.filter((e) => e.role === "staff").length;
  const auditorCount = employees.filter((e) => e.role === "auditor").length;

  const stats = [
    {
      label: "Total Members",
      value: total,
      subtext: `${activeCount} active`,
      icon: FiUsers,
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      border: "border-cyan-500/20",
    },
    {
      label: "Administrators",
      value: adminCount,
      subtext: "Full cluster privileges",
      icon: FiShield,
      color: "text-rose-400",
      bg: "bg-rose-500/10",
      border: "border-rose-500/20",
    },
    {
      label: "Operational Staff",
      value: staffCount,
      subtext: "Workflow execution",
      icon: FiUserCheck,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      border: "border-emerald-500/20",
    },
    {
      label: "Security Auditors",
      value: auditorCount,
      subtext: "Read-only telemetry",
      icon: FiEye,
      color: "text-amber-400",
      bg: "bg-amber-500/10",
      border: "border-amber-500/20",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.label}
            className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 flex items-center justify-between shadow-sm"
          >
            <div>
              <p className="text-xs font-medium text-slate-400">{stat.label}</p>
              <h4 className="text-xl font-bold text-white mt-1">
                {stat.value}
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {stat.subtext}
              </p>
            </div>
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center border ${stat.bg} ${stat.border} ${stat.color}`}
            >
              <Icon className="w-5 h-5" />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default EmployeeStats;
