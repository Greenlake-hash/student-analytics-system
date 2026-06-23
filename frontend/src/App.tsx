import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { isFirebaseEnabled } from "@/lib/api-client";
import { DevSignIn } from "@/components/auth/DevSignIn";
import { AppShell } from "@/components/layout/AppShell";
import { DashboardPage } from "@/pages/DashboardPage";
import { GradeLabPage } from "@/pages/student/GradeLabPage";
import { AnalyticsPage } from "@/pages/AnalyticsPage";
import { VerificationQueuePage } from "@/pages/admin/VerificationQueuePage";

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center bg-[var(--bg)] text-sm text-[var(--muted)]">
      Loading…
    </div>
  );
}

function RequireRole({ role, children }: { role: "student" | "admin"; children: React.ReactNode }) {
  const { user } = useAuth();
  if (user && user.role !== role) {
    return (
      <div className="grid place-items-center rounded-[var(--radius)] border border-[var(--line)] bg-[var(--surface)] p-10 text-center">
        <p className="text-sm text-[var(--muted)]">
          This page is only available to {role === "admin" ? "admins" : "students"}.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingScreen />;

  if (!user) {
    if (isFirebaseEnabled) {
      // Real auth UI is a Phase 4 follow-up once a Firebase project
      // exists -- this app is built and tested entirely in dev-auth mode
      // for now (see migration plan Phase 1.4/4 notes).
      return (
        <div className="grid min-h-screen place-items-center bg-[var(--bg)] px-4 text-center text-sm text-[var(--muted)]">
          Firebase sign-in UI not yet implemented — set VITE_FIREBASE_ENABLED=false to use dev sign-in.
        </div>
      );
    }
    return <DevSignIn />;
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/grade-lab"
          element={
            <RequireRole role="student">
              <GradeLabPage />
            </RequireRole>
          }
        />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route
          path="/admin/verification"
          element={
            <RequireRole role="admin">
              <VerificationQueuePage />
            </RequireRole>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
