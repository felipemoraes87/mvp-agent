import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";

type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  denied: boolean;
  reason: string | null;
  actorRole: string;
  createdAt: string;
};

export function LogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await apiGet<{ logs: AuditLog[] }>("/api/audit-logs");
      setLogs(res.logs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Logs</h2>
          <p className="text-sm text-slate-400">Audit trail do backend (ações de configuração, policy e operações).</p>
        </div>
        <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>

      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}
      {loading ? <div className="text-sm text-slate-400">Loading logs...</div> : null}

      <div className="panel p-4 overflow-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-2">When</th>
              <th className="py-2">Action</th>
              <th className="py-2">Entity</th>
              <th className="py-2">Role</th>
              <th className="py-2">Status</th>
              <th className="py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-slate-800/70 text-slate-200">
                <td className="py-2">{new Date(log.createdAt).toLocaleString()}</td>
                <td className="py-2 font-semibold">{log.action}</td>
                <td className="py-2">{log.entityType}</td>
                <td className="py-2">{log.actorRole}</td>
                <td className="py-2">{log.denied ? "DENIED" : "OK"}</td>
                <td className="py-2">{log.reason || "-"}</td>
              </tr>
            ))}
            {!logs.length && !loading ? (
              <tr>
                <td className="py-3 text-slate-400" colSpan={6}>No logs found.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
