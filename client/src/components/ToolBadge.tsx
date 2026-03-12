import type { Tool } from "../lib/types";

export function ToolBadge({ tool, compact = false }: { tool: Tool; compact?: boolean }) {
  const policyTone = tool.policy === "write" ? "text-amber-200 border-amber-400/40 bg-amber-500/10" : "text-sky-200 border-sky-400/40 bg-sky-500/10";

  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${policyTone}`}>
      <span className="font-semibold">{tool.name}</span>
      {!compact && tool.callName ? <span className="text-slate-300">{tool.callName}</span> : null}
      {!compact ? <span className="text-slate-300">{tool.type}</span> : null}
      <span className="rounded bg-slate-900/70 px-1.5 py-0.5 uppercase">{tool.policy}</span>
    </div>
  );
}

