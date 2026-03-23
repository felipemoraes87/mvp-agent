import { useEffect, useMemo } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Sidebar } from "./Sidebar";

const routeTitles: Record<string, string> = {
  "/": "Dash",
  "/exec-dashboard": "Executive View",
  "/agents": "Agents",
  "/workflows": "Workflows",
  "/tools": "Tools",
  "/skills": "Skills",
  "/knowledge": "Knowledge Sources",
  "/channels": "Channels",
  "/playground": "PlayGround",
  "/graph": "Team Graph",
  "/graph-test": "Graph Test",
  "/configuration": "Configuration",
  "/debug": "Debug",
  "/logs": "Logs",
  "/docs": "Docs",
  "/access": "Access Mgmt",
};

type ThemeMode = "dark" | "light";

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("studio.theme");
  return saved === "light" ? "light" : "dark";
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useMemo(getInitialTheme, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const pageTitle = routeTitles[location.pathname] || location.pathname.replace("/", "");

  const toggleTheme = () => {
    const current = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
    const next: ThemeMode = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("studio.theme", next);
  };

  return (
    <div className="flex min-h-screen bg-transparent text-slate-100">
      <Sidebar role={user?.role} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-slate-700/70 bg-[var(--bg-elev)]/95 px-4 backdrop-blur">
          <div>
            <div className="text-sm font-semibold tracking-wide text-slate-100">Sec Agent Studio</div>
            <div className="text-[11px] text-slate-400">{pageTitle}</div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="hidden rounded-md border border-slate-700 bg-slate-900/60 px-2 py-1 text-slate-300 sm:inline">{user?.role}</span>
            <span className="hidden text-slate-400 md:inline">{user?.email}</span>
            <button className="btn-ghost" onClick={toggleTheme}>Theme</button>
            <button
              className="btn-primary"
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Logout
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
