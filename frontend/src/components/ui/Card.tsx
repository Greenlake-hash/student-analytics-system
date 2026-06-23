import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-5 shadow-[var(--shadow)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, eyebrow, action }: { title: string; eyebrow?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        {eyebrow && <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">{eyebrow}</p>}
        <h3 className="font-display text-base font-semibold text-[var(--text)]">{title}</h3>
      </div>
      {action}
    </div>
  );
}
