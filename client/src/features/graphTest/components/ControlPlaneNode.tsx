import { Handle, Position, type NodeProps } from "reactflow";
import { statusColor } from "../graphUtils";
import type { GraphNodeData } from "../types";

function NodeShell({ data, selected, tone }: { data: GraphNodeData; selected: boolean; tone: "team" | "agent" | "coordinator" }) {
  const accent =
    tone === "team" ? "#38bdf8" :
    tone === "coordinator" ? "#818cf8" : "#c084fc";
  const status = statusColor(data.status);

  return (
    <div
      className={`relative rounded-3xl border bg-slate-950/95 shadow-2xl transition-all ${tone === "team" ? "w-[320px] p-5" : "w-[250px] p-4"}`}
      style={{
        borderColor: selected ? accent : "#334155",
        boxShadow: selected ? `0 0 0 1px ${accent}, 0 18px 40px rgba(15,23,42,0.55)` : "0 16px 34px rgba(15,23,42,0.35)",
      }}
    >
      <Handle type="target" position={Position.Left} style={{ background: accent, width: 10, height: 10 }} />
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 10, height: 10 }} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: accent }}>{data.label}</div>
          <div className="mt-2 text-base font-semibold text-slate-100">{data.title}</div>
          {data.subtitle ? <div className="mt-1 text-xs text-slate-400">{data.subtitle}</div> : null}
        </div>
        <div className="rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: `${status}66`, color: status }}>
          {data.status}
        </div>
      </div>

      <div className="mt-3 text-sm leading-6 text-slate-300">{data.description}</div>

      {data.badges?.length ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.badges.map((badge) => (
            <span key={badge} className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300">
              {badge}
            </span>
          ))}
        </div>
      ) : null}

      {data.metrics?.length ? (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.metrics.map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{metric.label}</div>
              <div className="mt-1 text-sm font-semibold text-slate-100">{metric.value}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function TeamNode(props: NodeProps<GraphNodeData>) {
  return <NodeShell {...props} tone="team" />;
}

export function AgentNodeControl(props: NodeProps<GraphNodeData>) {
  return <NodeShell {...props} tone="agent" />;
}

export function CoordinatorNode(props: NodeProps<GraphNodeData>) {
  return <NodeShell {...props} tone="coordinator" />;
}
