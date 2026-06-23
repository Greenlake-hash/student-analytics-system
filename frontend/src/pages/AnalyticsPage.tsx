import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCourses } from "@/hooks/useSubmissions";
import { useCourseAnalytics, useCourseAnalyticsRoster, useMyResult, useRecomputeCourse } from "@/hooks/useAnalytics";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard, MetricGrid } from "@/components/ui/MetricCard";
import { GradeBadge, gradeColorVar } from "@/components/ui/GradeBadge";
import { useAuth } from "@/context/AuthContext";
import { ApiError } from "@/lib/api-client";
import { GRADE_ORDER } from "@/lib/types";
import { RefreshCw } from "lucide-react";

export function AnalyticsPage() {
  const { data: courses } = useCourses();
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");
  const { user } = useAuth();

  const activeCourseId = selectedCourseId || courses?.[0]?.id;

  return (
    <div className="grid gap-5">
      <header>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">Analytics</p>
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Course analytics</h1>
      </header>

      <Card>
        <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="analytics-course-select">
          Course
        </label>
        <select
          id="analytics-course-select"
          value={activeCourseId ?? ""}
          onChange={(e) => setSelectedCourseId(e.target.value)}
          className="min-h-[44px] w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)]"
        >
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </Card>

      {activeCourseId && (
        <>
          {user?.role === "student" && <StudentAnalyticsView courseId={activeCourseId} />}
          {user?.role === "admin" && <AdminAnalyticsView courseId={activeCourseId} />}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Student view: aggregate stats + my result, no classmate identities
// ---------------------------------------------------------------------------

function StudentAnalyticsView({ courseId }: { courseId: string }) {
  const { data: analytics, isLoading, error } = useCourseAnalytics(courseId);
  const { data: myResult } = useMyResult(courseId);

  if (isLoading) return <p className="text-sm text-[var(--muted)]">Loading analytics…</p>;

  if (error instanceof ApiError && error.status === 404) {
    return (
      <Card>
        <p className="text-sm text-[var(--muted)]">
          Results haven't been computed for this course yet. Check back after your admin runs the recompute.
        </p>
      </Card>
    );
  }
  if (!analytics) return null;

  const { statistics: stats, grade_distribution, histogram } = analytics;

  return (
    <div className="grid gap-5">
      {/* My personal result — the student's own card at the top */}
      {myResult && (
        <Card>
          <CardHeader title="Your result" eyebrow="Personal" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <span className="text-xs text-[var(--muted)]">Grade</span>
              <GradeBadge grade={myResult.relative_grade} />
            </div>
            <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <span className="text-xs text-[var(--muted)]">Raw score</span>
              <strong className="font-mono-tabular text-lg text-[var(--text)]">
                {myResult.raw_score.toFixed(1)}%
              </strong>
            </div>
            <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <span className="text-xs text-[var(--muted)]">Rank</span>
              <strong className="font-mono-tabular text-lg text-[var(--text)]">#{myResult.rank}</strong>
            </div>
            <div className="grid gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <span className="text-xs text-[var(--muted)]">Percentile</span>
              <strong className="font-mono-tabular text-lg text-[var(--text)]">
                {myResult.percentile?.toFixed(0)}th
              </strong>
            </div>
          </div>
          {myResult.z_score !== null && (
            <p className="mt-3 text-xs text-[var(--faint)]">
              z-score: {myResult.z_score.toFixed(3)} &mdash; {zScoreContext(myResult.z_score)}
            </p>
          )}
        </Card>
      )}

      {/* Cohort aggregate stats */}
      <MetricGrid>
        <MetricCard label="Class mean" value={`${stats.mean?.toFixed(1) ?? "—"}%`} />
        <MetricCard label="Median" value={`${stats.median?.toFixed(1) ?? "—"}%`} />
        <MetricCard label="Std. deviation" value={stats.stdev?.toFixed(2) ?? "—"} />
        <MetricCard label="Students" value={stats.submission_count} />
      </MetricGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <ScoreHistogram histogram={histogram} />
        <GradeDistributionChart distribution={grade_distribution} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin view: same as student + roster table + recompute button
// ---------------------------------------------------------------------------

function AdminAnalyticsView({ courseId }: { courseId: string }) {
  const { data: analytics, isLoading, error, refetch } = useCourseAnalyticsRoster(courseId);
  const recompute = useRecomputeCourse();
  const [recomputeError, setRecomputeError] = useState<string | null>(null);

  async function handleRecompute() {
    setRecomputeError(null);
    try {
      await recompute.mutateAsync(courseId);
      await refetch();
    } catch (err) {
      setRecomputeError(err instanceof ApiError ? err.detail : "Recompute failed.");
    }
  }

  if (isLoading) return <p className="text-sm text-[var(--muted)]">Loading analytics…</p>;

  const notComputed = error instanceof ApiError && error.status === 404;

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleRecompute}
          disabled={recompute.isPending}
          className="flex min-h-[40px] items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-4 text-sm text-[var(--text)] hover:border-[var(--brand)] disabled:opacity-50"
        >
          <RefreshCw size={14} className={recompute.isPending ? "animate-spin" : ""} />
          {recompute.isPending ? "Computing…" : "Recompute results"}
        </button>
        {recomputeError && <p className="text-sm text-[var(--danger)]">{recomputeError}</p>}
      </div>

      {notComputed ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">
            No results computed yet. Click Recompute above — you'll need at least one student with approved
            submissions for this course.
          </p>
        </Card>
      ) : analytics ? (
        <>
          <MetricGrid>
            <MetricCard label="Class mean" value={`${analytics.statistics.mean?.toFixed(1) ?? "—"}%`} />
            <MetricCard label="Median" value={`${analytics.statistics.median?.toFixed(1) ?? "—"}%`} />
            <MetricCard label="Std. deviation" value={analytics.statistics.stdev?.toFixed(2) ?? "—"} />
            <MetricCard label="Students graded" value={analytics.statistics.submission_count} />
          </MetricGrid>

          <div className="grid gap-5 lg:grid-cols-2">
            <ScoreHistogram histogram={analytics.histogram} />
            <GradeDistributionChart distribution={analytics.grade_distribution} />
          </div>

          <StudentRosterTable results={analytics.results} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared chart components
// ---------------------------------------------------------------------------

function ScoreHistogram({
  histogram,
}: {
  histogram: Array<{ range_label: string; range_min: number; range_max: number; count: number }>;
}) {
  return (
    <Card>
      <CardHeader title="Score distribution" eyebrow="Bell curve histogram" />
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={histogram} margin={{ top: 4, right: 8, left: -16, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
          <XAxis
            dataKey="range_label"
            tick={{ fill: "var(--faint)", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis tick={{ fill: "var(--faint)", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "6px",
              fontSize: 12,
            }}
            cursor={{ fill: "color-mix(in srgb, var(--brand) 12%, transparent)" }}
          />
          <Bar dataKey="count" name="Students" radius={[3, 3, 0, 0]}>
            {histogram.map((entry) => {
              const pct = (entry.range_min + entry.range_max) / 2;
              const grade = percentageToApproxGrade(pct);
              return <Cell key={entry.range_label} fill={gradeColorVar(grade)} />;
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-2 text-[10px] text-[var(--faint)]">
        Bars are colored by the approximate grade zone — teal for AA/AB, blue for BB/BC, amber/red for lower tiers.
      </p>
    </Card>
  );
}

function GradeDistributionChart({
  distribution,
}: {
  distribution: Array<{ grade: string; count: number }>;
}) {
  const ordered = GRADE_ORDER.map((g) => ({
    grade: g,
    count: distribution.find((d) => d.grade === g)?.count ?? 0,
  }));

  return (
    <Card>
      <CardHeader title="Grade distribution" eyebrow="Relative grades" />
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={ordered.filter((d) => d.count > 0)}
            dataKey="count"
            nameKey="grade"
            cx="50%"
            cy="50%"
            outerRadius={80}
            strokeWidth={2}
            stroke="var(--surface)"
          >
            {ordered
              .filter((d) => d.count > 0)
              .map((entry) => (
                <Cell key={entry.grade} fill={gradeColorVar(entry.grade)} />
              ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "6px",
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-3 flex flex-wrap gap-2">
        {ordered
          .filter((d) => d.count > 0)
          .map((d) => (
            <span
              key={d.grade}
              className="flex items-center gap-1.5 text-xs text-[var(--muted)]"
            >
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ background: gradeColorVar(d.grade) }}
              />
              {d.grade}: {d.count}
            </span>
          ))}
      </div>
    </Card>
  );
}

function StudentRosterTable({
  results,
}: {
  results: Array<{
    student_id: string;
    raw_score: number;
    z_score: number | null;
    relative_grade: string | null;
    rank: number | null;
    percentile: number | null;
  }>;
}) {
  return (
    <Card>
      <CardHeader title="Student roster" eyebrow="Admin view — individual results" />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)]">
              {["Rank", "Student ID", "Score", "z-score", "Grade", "Percentile"].map((h) => (
                <th key={h} className="pb-2 pr-4 text-left text-xs font-semibold text-[var(--muted)]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.student_id} className="border-b border-[var(--line)] last:border-0">
                <td className="py-2.5 pr-4 font-mono-tabular text-[var(--muted)]">#{r.rank}</td>
                <td className="py-2.5 pr-4 font-mono-tabular text-xs text-[var(--faint)]">
                  {r.student_id.slice(0, 12)}…
                </td>
                <td className="py-2.5 pr-4 font-mono-tabular">{r.raw_score.toFixed(1)}%</td>
                <td className="py-2.5 pr-4 font-mono-tabular text-[var(--muted)]">
                  {r.z_score?.toFixed(3) ?? "—"}
                </td>
                <td className="py-2.5 pr-4">
                  <GradeBadge grade={r.relative_grade} size="sm" />
                </td>
                <td className="py-2.5 font-mono-tabular text-[var(--muted)]">
                  {r.percentile?.toFixed(0)}th
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function percentageToApproxGrade(pct: number): string {
  // Approximate mapping for coloring histogram bars, using typical absolute
  // percentage zones as a rough guide (the real grade boundaries in v2 are
  // z-score based, but we don't have a z-score for a histogram bucket midpoint).
  if (pct >= 80) return "AB";
  if (pct >= 65) return "BB";
  if (pct >= 55) return "BC";
  if (pct >= 45) return "CC";
  if (pct >= 35) return "CD";
  return "F";
}

function zScoreContext(z: number): string {
  if (z >= 1.5) return "well above the class average";
  if (z >= 0.5) return "above the class average";
  if (z >= -0.5) return "near the class average";
  if (z >= -1.5) return "below the class average";
  return "well below the class average";
}
