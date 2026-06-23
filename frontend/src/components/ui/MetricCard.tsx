import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  detail,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  tone?: "neutral" | "good" | "warn" | "risk";
  icon?: ReactNode;
}) {
  const toneColor = {
    neutral: "var(--text)",
    good: "#86efac",
    warn: "#fbbf24",
    risk: "#fca5a5",
  }[tone];

  return (
    <div className="grid min-h-[124px] content-between gap-2.5 rounded-[var(--radius)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-4.5 shadow-[var(--shadow)] transition-transform hover:-translate-y-0.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] text-[var(--muted)]">{label}</span>
        {icon && <span className="text-[var(--faint)]">{icon}</span>}
      </div>
      <strong className="font-mono-tabular text-[28px] leading-none" style={{ color: toneColor }}>
        {value}
      </strong>
      {detail && <small className="text-xs leading-snug text-[var(--faint)]">{detail}</small>}
    </div>
  );
}

export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3.5 lg:grid-cols-4", className)}>{children}</div>;
}
