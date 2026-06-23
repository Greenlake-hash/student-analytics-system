import { type ReactNode, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  GraduationCap,
  LayoutDashboard,
  ClipboardList,
  BarChart3,
  ShieldCheck,
  Moon,
  Sun,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  roles: Array<"student" | "admin">;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, roles: ["student", "admin"] },
  { to: "/grade-lab", label: "Grade Lab", icon: ClipboardList, roles: ["student"] },
  { to: "/analytics", label: "Analytics", icon: BarChart3, roles: ["student", "admin"] },
  { to: "/admin/verification", label: "Verification Queue", icon: ShieldCheck, roles: ["admin"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("spad-v2-theme") as "dark" | "light") ?? "dark",
  );

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("spad-v2-theme", next);
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => !user || item.roles.includes(user.role));

  return (
    <div className="grid min-h-screen grid-cols-1 md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col border-r border-[var(--line)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] p-5 backdrop-blur-xl md:sticky md:top-0 md:h-screen">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] text-[var(--brand)]">
            <GraduationCap size={20} />
          </div>
          <div className="min-w-0">
            <strong className="block truncate text-sm text-[var(--text)]">Student Analytics</strong>
            <small className="block truncate text-xs text-[var(--muted)]">BSc DSAI &middot; v2</small>
          </div>
        </div>

        <nav className="mt-8 grid gap-1.5">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn(
                  "flex min-h-[42px] items-center gap-2.5 rounded-[var(--radius-sm)] border border-transparent px-3 text-sm text-[var(--muted)] transition-colors",
                  isActive
                    ? "border-[var(--line)] bg-[var(--surface-2)] text-[var(--text)] shadow-[inset_3px_0_0_var(--brand)]"
                    : "hover:bg-[var(--surface-2)] hover:text-[var(--text)]",
                )
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto grid gap-2.5 pt-6">
          {user && (
            <div className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5 text-xs text-[var(--muted)]">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--ok)] shadow-[0_0_0_4px_rgba(34,197,94,0.14)]" />
              <span className="min-w-0 flex-1 truncate">
                <span className="block truncate font-medium text-[var(--text)]">{user.full_name}</span>
                <span className="block truncate capitalize">{user.role}</span>
              </span>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="shrink-0 text-[var(--faint)] hover:text-[var(--danger)]"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex min-h-[38px] items-center justify-center gap-2 rounded-[var(--radius-sm)] border border-[var(--line)] bg-[var(--surface-2)] text-sm text-[var(--muted)] hover:text-[var(--text)]"
          >
            {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
        </div>
      </aside>

      <main className="min-w-0 p-5 md:p-7">{children}</main>
    </div>
  );
}
