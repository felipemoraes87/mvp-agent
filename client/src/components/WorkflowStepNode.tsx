import { Handle, Position, type NodeProps } from "reactflow";

type WorkflowStepNodeData = {
  stepNumber: number;
  title: string;
  detail: string;
  caption: string;
  kind: "trigger" | "analysis" | "decision" | "knowledge" | "action" | "finish";
  agentName?: string;
  integrations?: string[];
};

const styles = {
  trigger: {
    accent: "#22c55e",
    border: "#15803d",
    glow: "rgba(34,197,94,0.22)",
    badge: "Trigger",
  },
  analysis: {
    accent: "#38bdf8",
    border: "#0369a1",
    glow: "rgba(56,189,248,0.2)",
    badge: "Analysis",
  },
  decision: {
    accent: "#f59e0b",
    border: "#b45309",
    glow: "rgba(245,158,11,0.22)",
    badge: "Decision",
  },
  knowledge: {
    accent: "#a78bfa",
    border: "#6d28d9",
    glow: "rgba(167,139,250,0.22)",
    badge: "Knowledge",
  },
  action: {
    accent: "#fb7185",
    border: "#be123c",
    glow: "rgba(251,113,133,0.22)",
    badge: "Action",
  },
  finish: {
    accent: "#e2e8f0",
    border: "#475569",
    glow: "rgba(226,232,240,0.18)",
    badge: "Finish",
  },
} as const;

export function WorkflowStepNode({ data, selected }: NodeProps<WorkflowStepNodeData>) {
  const style = styles[data.kind];

  return (
    <div
      className="relative w-[260px] rounded-[24px] border bg-slate-950/95 p-4 shadow-2xl transition-all"
      style={{
        borderColor: selected ? style.accent : style.border,
        boxShadow: selected ? `0 0 0 1px ${style.accent}, 0 18px 40px ${style.glow}` : `0 16px 32px ${style.glow}`,
      }}
    >
      <Handle id="in-main" type="target" position={Position.Left} style={{ background: style.accent, width: 10, height: 10 }} />
      <Handle id="out-main" type="source" position={Position.Right} style={{ background: style.accent, width: 10, height: 10 }} />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{data.caption}</div>
          <div className="mt-2 text-base font-semibold text-slate-100">{data.title}</div>
        </div>
        <div className="rounded-2xl border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: style.border, color: style.accent }}>
          {data.stepNumber}
        </div>
      </div>

      <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs font-semibold" style={{ color: style.accent }}>
        {style.badge}
      </div>

      <div className="mt-3 text-sm leading-6 text-slate-300">{data.detail}</div>

      <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-900/75 px-3 py-2">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Agent</div>
        <div className="mt-1 text-sm font-semibold text-slate-100">{data.agentName || "IAM Orchestrator"}</div>
      </div>

      {data.integrations?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {data.integrations.map((integration) => (
            <span key={integration} className="rounded-full border border-slate-700 bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300">
              {integration}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
