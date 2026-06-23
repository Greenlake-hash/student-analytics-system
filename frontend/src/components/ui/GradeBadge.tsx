import { cn } from "@/lib/utils";
import type { GradeLetter } from "@/lib/types";

const GRADE_COLOR_VAR: Record<string, string> = {
  AA: "--grade-aa",
  AB: "--grade-ab",
  BB: "--grade-bb",
  BC: "--grade-bc",
  CC: "--grade-cc",
  CD: "--grade-cd",
  DD: "--grade-dd",
  F: "--grade-f",
};

/**
 * Renders a letter grade using the shared --grade-* color ramp (see
 * index.css) so the same grade always reads the same color everywhere it
 * appears: this badge, histogram bars, bell curve fill.
 */
export function GradeBadge({ grade, size = "md" }: { grade: string | null; size?: "sm" | "md" }) {
  if (!grade) {
    return <span className="text-xs text-[var(--faint)]">—</span>;
  }
  const colorVar = GRADE_COLOR_VAR[grade] ?? "--muted";

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full border font-bold",
        size === "sm" ? "min-h-[22px] px-2 text-[11px]" : "min-h-[28px] px-2.5 text-xs",
      )}
      style={{
        color: `var(${colorVar})`,
        borderColor: `color-mix(in srgb, var(${colorVar}) 45%, var(--line))`,
        background: `color-mix(in srgb, var(${colorVar}) 14%, var(--surface-2))`,
      }}
    >
      {grade}
    </span>
  );
}

export function gradeColorVar(grade: GradeLetter | string): string {
  return `var(${GRADE_COLOR_VAR[grade] ?? "--muted"})`;
}
