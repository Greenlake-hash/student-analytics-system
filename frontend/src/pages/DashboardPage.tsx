import { useAuth } from "@/context/AuthContext";
import { useCourses, useMySubmissions, useVerificationQueue } from "@/hooks/useSubmissions";
import { Card, CardHeader } from "@/components/ui/Card";
import { MetricCard, MetricGrid } from "@/components/ui/MetricCard";
import { ClipboardCheck, BookOpen, Clock, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";

export function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  return user.role === "admin" ? <AdminDashboard /> : <StudentDashboard />;
}

function StudentDashboard() {
  const { user } = useAuth();
  const { data: courses } = useCourses();
  const { data: submissions, isLoading } = useMySubmissions();

  const statusCounts = (submissions ?? []).reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  const approved = statusCounts.approved ?? 0;
  const pending = (statusCounts.pending_verification ?? 0) + (statusCounts.submitted ?? 0);
  const rejected = statusCounts.rejected ?? 0;
  const firstName = user?.full_name.split(" ")[0] ?? "";

  return (
    <div className="grid gap-5">
      <header>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">Overview</p>
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Welcome back, {firstName}</h1>
      </header>

      <MetricGrid>
        <MetricCard
          label="Courses Available"
          value={courses?.length ?? "—"}
          detail="Across the catalog"
          icon={<BookOpen size={16} />}
        />
        <MetricCard
          label="Approved Submissions"
          value={isLoading ? "—" : approved}
          tone="good"
          detail="Counted toward grading"
          icon={<ClipboardCheck size={16} />}
        />
        <MetricCard
          label="Awaiting Review"
          value={isLoading ? "—" : pending}
          tone={pending > 0 ? "warn" : "neutral"}
          detail="Submitted, not yet approved"
          icon={<Clock size={16} />}
        />
        <MetricCard
          label="Needs Resubmission"
          value={isLoading ? "—" : rejected}
          tone={rejected > 0 ? "risk" : "neutral"}
          detail="Rejected by an admin"
          icon={<AlertTriangle size={16} />}
        />
      </MetricGrid>

      <Card>
        <CardHeader
          title="Get started"
          eyebrow="Next step"
          action={
            <Link
              to="/grade-lab"
              className="rounded-[var(--radius-sm)] bg-[var(--brand)] px-3.5 py-2 text-sm font-semibold text-[#05211f]"
            >
              Open Grade Lab
            </Link>
          }
        />
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          Submit assessment scores in the Grade Lab, then send them for verification. Once an admin
          approves your submissions and a course is frozen and recomputed, your relative grade, rank,
          and percentile appear under Analytics.
        </p>
      </Card>
    </div>
  );
}

function AdminDashboard() {
  const { data: queue, isLoading } = useVerificationQueue();
  const { data: courses } = useCourses();

  return (
    <div className="grid gap-5">
      <header>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">Admin Overview</p>
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Verification & grading control</h1>
      </header>

      <MetricGrid>
        <MetricCard
          label="Pending Verification"
          value={isLoading ? "—" : queue?.length ?? 0}
          tone={(queue?.length ?? 0) > 0 ? "warn" : "good"}
          detail="Submissions awaiting your review"
          icon={<Clock size={16} />}
        />
        <MetricCard label="Courses in Catalog" value={courses?.length ?? "—"} icon={<BookOpen size={16} />} />
      </MetricGrid>

      <Card>
        <CardHeader
          title="Verification queue preview"
          eyebrow="Latest"
          action={
            <Link to="/admin/verification" className="text-sm font-medium text-[var(--brand)]">
              View full queue →
            </Link>
          }
        />
        {isLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : !queue?.length ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line)] p-4 text-sm text-[var(--muted)]">
            Nothing pending — the verification queue is empty.
          </p>
        ) : (
          <div className="grid gap-2">
            {queue.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-2.5 text-sm"
              >
                <span className="font-mono-tabular text-[var(--muted)]">{item.id.slice(0, 8)}…</span>
                <span className="font-mono-tabular text-[var(--text)]">{item.score ?? "—"}</span>
                <span className="text-xs text-[var(--faint)]">{item.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
