import { useState } from "react";
import { Check, X } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { useApproveVerification, useRejectVerification, useVerificationQueue } from "@/hooks/useSubmissions";
import { ApiError } from "@/lib/api-client";

export function VerificationQueuePage() {
  const { data: queue, isLoading } = useVerificationQueue();

  return (
    <div className="grid gap-5">
      <header>
        <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--brand)]">Admin</p>
        <h1 className="font-display text-2xl font-semibold text-[var(--text)]">Verification queue</h1>
      </header>

      <Card>
        <CardHeader title="Pending submissions" eyebrow={`${queue?.length ?? 0} waiting`} />
        {isLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading…</p>
        ) : !queue?.length ? (
          <p className="rounded-[var(--radius-sm)] border border-dashed border-[var(--line)] p-6 text-center text-sm text-[var(--muted)]">
            Nothing to review right now.
          </p>
        ) : (
          <div className="grid gap-3">
            {queue.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function QueueRow({
  item,
}: {
  item: { id: string; score: number | null; status: string; latest_verification: { id: string } | null };
}) {
  const [notes, setNotes] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useApproveVerification();
  const reject = useRejectVerification();
  const verificationId = item.latest_verification?.id;
  const isBusy = approve.isPending || reject.isPending;

  async function handleApprove() {
    if (!verificationId) return;
    setError(null);
    try {
      await approve.mutateAsync({ verificationId, notes: notes || undefined });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Approval failed.");
    }
  }

  async function handleReject() {
    if (!verificationId) return;
    if (!notes.trim()) {
      setError("A rejection requires a note explaining what needs to change.");
      return;
    }
    setError(null);
    try {
      await reject.mutateAsync({ verificationId, notes });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : "Rejection failed.");
    }
  }

  return (
    <div className="grid gap-2.5 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-mono-tabular text-sm text-[var(--text)]">Submission {item.id.slice(0, 8)}…</span>
          <p className="font-mono-tabular text-2xl font-semibold text-[var(--text)]">{item.score ?? "—"}</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApprove}
            disabled={isBusy}
            className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-sm)] bg-[var(--ok)] px-3 text-sm font-semibold text-[#052e16] disabled:opacity-50"
          >
            <Check size={14} />
            Approve
          </button>
          <button
            type="button"
            onClick={() => setShowRejectInput((v) => !v)}
            disabled={isBusy}
            className="flex min-h-[36px] items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--danger)] bg-transparent px-3 text-sm font-semibold text-[var(--danger)] disabled:opacity-50"
          >
            <X size={14} />
            Reject
          </button>
        </div>
      </div>

      {showRejectInput && (
        <div className="flex gap-2">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Why is this being rejected? (required)"
            className="min-h-[38px] flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--danger)]"
          />
          <button
            type="button"
            onClick={handleReject}
            disabled={isBusy}
            className="min-h-[38px] rounded-[var(--radius-sm)] bg-[var(--danger)] px-3.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            Confirm
          </button>
        </div>
      )}

      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
