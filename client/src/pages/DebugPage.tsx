import { useState } from "react";
import { apiGet } from "../lib/api";

export function DebugPage() {
  const [serverHealth, setServerHealth] = useState<string>("");
  const [authMe, setAuthMe] = useState<string>("");
  const [dashboardMeta, setDashboardMeta] = useState<string>("");

  const runChecks = async () => {
    try {
      const [health, me, dashboard] = await Promise.all([
        apiGet<Record<string, unknown>>("/api/health"),
        apiGet<Record<string, unknown>>("/api/auth/me"),
        apiGet<Record<string, unknown>>("/api/dashboard"),
      ]);
      setServerHealth(JSON.stringify(health, null, 2));
      setAuthMe(JSON.stringify(me, null, 2));
      setDashboardMeta(JSON.stringify({
        summary: (dashboard as { summary?: unknown }).summary,
        cardsCount: Array.isArray((dashboard as { cards?: unknown[] }).cards) ? (dashboard as { cards?: unknown[] }).cards?.length : 0,
      }, null, 2));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Debug check failed";
      setServerHealth(msg);
      setAuthMe(msg);
      setDashboardMeta(msg);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Debug</h2>
        <p className="text-sm text-slate-400">Inspeção rápida de conectividade e sessão do portal.</p>
      </div>

      <div className="panel p-4">
        <button className="btn-primary" onClick={() => void runChecks()}>Run Debug Checks</button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">/api/health</div>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap">{serverHealth || "-"}</pre>
        </div>
        <div className="panel p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">/api/auth/me</div>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap">{authMe || "-"}</pre>
        </div>
        <div className="panel p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">/api/dashboard summary</div>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap">{dashboardMeta || "-"}</pre>
        </div>
      </div>
    </div>
  );
}
