import { useMemo, useState } from "react";
import { Send, CheckCircle2, Clock3, XCircle, FileEdit } from "lucide-react";
import { Card } from "@/components/ui/Card";
import {
  useAssessments,
  useCourses,
  useCreateSubmission,
  useMySubmissions,
  useRequestSubmissionUpdate,
  useSubmitForVerification,
} from "@/hooks/useSubmissions";
import { ApiError } from "@/lib/api-client";
import type { Submission, SubmissionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS_META: Record<SubmissionStatus, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  draft: { label: "Draft", icon: FileEdit, tone: "var(--faint)" },
  submitted: { label: "Submitted", icon: Clock3, tone: "var(--info)" },
  pending_verification: { label: "Pending review", icon: Clock3, tone: "var(--brand-2)" },
  approved: { label: "Approved", icon: CheckCircle2, tone: "#86efac" },
  rejected: { label: "Rejected — resubmit", icon: XCircle, tone: "#fca5a5" },
  published: { label: "Published", icon: CheckCircle2, tone: "var(--brand)" },
};

export function GradeLabPage() {
  const { data: courses, isLoading: coursesLoading } = useCourses();
  const [selectedCourseId, setSelectedCourseId] = useState<string>("");

  const activeCourseId = selectedCourseId || courses?.[0]?.id;
  const { data: assessments, isLoading: assessmentsLoading } = useAssessments(activeCourseId);
  const { data: submissions } = useMySubmissions();

  const submissionByAssessmentId = useMemo(() => {
    const map = new Map<string, Submission>();
    for (const s of submissions ?? []) map.set(s.assessment_id, s);
    return map;
  }, [submissions]);

  return (
    <div className="grid gap-5">
      <header>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">Grade Lab</p>
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Submit assessment scores</h1>
      </header>

      <Card>
        <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="course-select">
          Course
        </label>
        <select
          id="course-select"
          value={activeCourseId ?? ""}
          onChange={(e) => setSelectedCourseId(e.target.value)}
          disabled={coursesLoading}
          className="min-h-[44px] w-full max-w-md rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)]"
        >
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.code} — {c.name} (T{c.trimester})
            </option>
          ))}
        </select>
      </Card>

      {assessmentsLoading ? (
        <p className="text-sm text-[var(--muted)]">Loading assessments…</p>
      ) : !assessments?.length ? (
        <Card>
          <p className="text-sm text-[var(--muted)]">No assessments are configured for this course yet.</p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {assessments.map((assessment) => (
            <AssessmentCard
              key={assessment.id}
              assessment={assessment}
              submission={submissionByAssessmentId.get(assessment.id) ?? null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssessmentCard({
  assessment,
  submission,
}: {
  assessment: { id: string; name: string; max_marks: number; weight: number; best_of_group: string };
  submission: Submission | null;
}) {
  const [scoreInput, setScoreInput] = useState(submission?.score?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  const createSubmission = useCreateSubmission();
  const requestUpdate = useRequestSubmissionUpdate();
  const submitForVerification = useSubmitForVerification();

  const status = submission?.status;
  const canEdit = !status || status === "draft" || status === "rejected";
  const isBusy = createSubmission.isPending || requestUpdate.isPending || submitForVerification.isPending;

  async function handleSave() {
    setError(null);
    const score = Number(scoreInput);
    if (!Number.isFinite(score) || score < 0) {
      setError("Enter a valid, non-negative score.");
      return;
    }
    try {
      if (submission) {
        await requestUpdate.mutateAsync({ submissionId: submission.id, assessment_id: assessment.id, score });
      } else {
        await createSubmission.mutateAsync({ assessment_id: assessment.id, score });
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Try again.");
    }
  }

  async function handleSendForVerification() {
    if (!submission) return;
    setError(null);
    try {
      await submitForVerification.mutateAsync(submission.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Something went wrong. Try again.");
    }
  }

  const meta = status ? STATUS_META[status] : null;
  const StatusIcon = meta?.icon;

  return (
    <div className="grid gap-3 rounded-[var(--radius)] border border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <strong className="text-[15px] text-[var(--text)]">{assessment.name}</strong>
          <p className="text-xs text-[var(--faint)]">
            Max {assessment.max_marks} &middot; {assessment.weight}% weight &middot; {assessment.best_of_group}
          </p>
        </div>
        {meta && StatusIcon && (
          <span className="flex items-center gap-1 text-xs font-medium" style={{ color: meta.tone }}>
            <StatusIcon size={13} />
            {meta.label}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={assessment.max_marks}
          step={0.01}
          value={scoreInput}
          onChange={(e) => setScoreInput(e.target.value)}
          disabled={!canEdit || isBusy}
          placeholder={`0 – ${assessment.max_marks}`}
          className={cn(
            "min-h-[40px] flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)]",
            !canEdit && "opacity-60",
          )}
        />
        {canEdit && (
          <button
            type="button"
            onClick={handleSave}
            disabled={isBusy || !scoreInput}
            className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--brand)] px-3.5 text-sm font-semibold text-[#05211f] disabled:opacity-50"
          >
            {submission ? "Update" : "Save"}
          </button>
        )}
      </div>

      {status === "submitted" && (
        <button
          type="button"
          onClick={handleSendForVerification}
          disabled={isBusy}
          className="flex min-h-[36px] items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] text-sm text-[var(--text)] hover:border-[var(--brand)] disabled:opacity-50"
        >
          <Send size={14} />
          Send for verification
        </button>
      )}

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
