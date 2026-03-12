import { useState } from "react";
import { apiGet, apiPost } from "../lib/api";

export function ConfigurationPage() {
  const [status, setStatus] = useState("");
  const [rawConfig, setRawConfig] = useState("");

  const exportConfig = async (format: "json" | "yaml") => {
    try {
      const data = await apiGet<Record<string, unknown>>(`/api/config/export?format=${format}`);
      const serialized = format === "json" ? JSON.stringify(data, null, 2) : String(data.payload || "");
      setRawConfig(serialized);
      const blob = new Blob([serialized], { type: format === "json" ? "application/json" : "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sec-agent-config.${format}`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus("Config exportada com sucesso.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao exportar configuração.");
    }
  };

  const importConfig = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { payload: unknown; signature: string; configVersionHash: string };
      await apiPost("/api/config/import", parsed);
      setStatus("Config importada com sucesso.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao importar configuração.");
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-slate-100">Configuration</h2>
        <p className="text-sm text-slate-400">Consolidação de configuração operacional (export/import assinado do backend).</p>
      </div>

      <div className="panel p-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => void exportConfig("json")}>Export JSON</button>
        <button className="btn-ghost" onClick={() => void exportConfig("yaml")}>Export YAML</button>
        <label className="btn-ghost cursor-pointer">
          Import JSON
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importConfig(file);
            }}
          />
        </label>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}

      <div className="panel p-4">
        <div className="mb-2 text-sm font-semibold text-slate-100">Last Export Preview</div>
        <textarea className="input-dark min-h-80 font-mono text-xs" readOnly value={rawConfig} placeholder="Export preview will appear here." />
      </div>
    </div>
  );
}
