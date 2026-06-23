import { useState } from "react";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

/**
 * Dev-mode sign-in: lets you act as any seeded user by email, since there's
 * no Firebase project yet (see backend/app/core/security.py's dev-auth
 * mode). This component only renders when VITE_FIREBASE_ENABLED=false --
 * see App.tsx. It is NOT a real login form and makes no attempt to look
 * like one; it's deliberately labeled as a dev tool so nobody mistakes it
 * for production auth.
 */

const SUGGESTED_USERS = [
  { email: "admin@spad.local", label: "Demo Admin", role: "admin" as const },
  { email: "student001@demo.local", label: "Demo Student 001", role: "student" as const },
  { email: "student002@demo.local", label: "Demo Student 002", role: "student" as const },
  { email: "student003@demo.local", label: "Demo Student 003", role: "student" as const },
];

export function DevSignIn() {
  const { signInAsDevUser } = useAuth();
  const [customEmail, setCustomEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn(email: string) {
    setIsSubmitting(true);
    setError(null);
    try {
      await signInAsDevUser(email);
    } catch {
      setError(`No user found with email "${email}". Run the seed script if you haven't yet.`);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] px-4">
      <div className="w-full max-w-md rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-8 shadow-[var(--shadow)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] text-[var(--brand)]">
            <GraduationCap size={22} />
          </div>
          <div>
            <h1 className="font-display text-lg font-semibold text-[var(--text)]">Student Analytics</h1>
            <p className="text-sm text-[var(--muted)]">Sign in to continue</p>
          </div>
        </div>

        <div className="mb-5 flex items-start gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] p-3 text-xs leading-relaxed text-[var(--muted)]">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--brand-2)]" />
          <span>
            Dev sign-in mode — no Firebase project is configured yet. Pick a seeded demo identity below.
            Real sign-in replaces this screen once <code className="font-mono-tabular text-[var(--text)]">FIREBASE_ENABLED=true</code>.
          </span>
        </div>

        <div className="space-y-2">
          {SUGGESTED_USERS.map((u) => (
            <button
              key={u.email}
              type="button"
              disabled={isSubmitting}
              onClick={() => handleSignIn(u.email)}
              className={cn(
                "flex w-full items-center justify-between rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3.5 py-3 text-left transition-colors hover:border-[var(--brand)] disabled:opacity-50",
              )}
            >
              <span>
                <span className="block text-sm font-medium text-[var(--text)]">{u.label}</span>
                <span className="block text-xs text-[var(--faint)]">{u.email}</span>
              </span>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  u.role === "admin"
                    ? "bg-[color-mix(in_srgb,var(--brand-2)_18%,transparent)] text-[var(--brand-2)]"
                    : "bg-[color-mix(in_srgb,var(--info)_18%,transparent)] text-[var(--info)]",
                )}
              >
                {u.role}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-5 border-t border-[var(--line)] pt-5">
          <label className="mb-1.5 block text-xs font-medium text-[var(--muted)]" htmlFor="custom-email">
            Or sign in as any other seeded email
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (customEmail.trim()) handleSignIn(customEmail.trim());
            }}
            className="flex gap-2"
          >
            <input
              id="custom-email"
              type="email"
              value={customEmail}
              onChange={(e) => setCustomEmail(e.target.value)}
              placeholder="student014@demo.local"
              className="min-h-[40px] flex-1 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--brand)]"
            />
            <button
              type="submit"
              disabled={isSubmitting || !customEmail.trim()}
              className="min-h-[40px] rounded-[var(--radius-sm)] bg-[var(--brand)] px-4 text-sm font-semibold text-[#05211f] disabled:opacity-50"
            >
              Go
            </button>
          </form>
          {error && <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>}
        </div>
      </div>
    </div>
  );
}
