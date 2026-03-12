import { Handle, Position, type NodeProps } from "reactflow";

type AgentNodeData = {
  name: string;
  type: "SUPERVISOR" | "SPECIALIST" | "TICKET";
  teamLabel?: string;
};

const styles = {
  SUPERVISOR: {
    border: "#8b5cf6",
    bg: "rgba(139,92,246,0.16)",
    chip: "#a78bfa",
    icon: "#c4b5fd",
    label: "Supervisor",
  },
  SPECIALIST: {
    border: "#3b82f6",
    bg: "rgba(59,130,246,0.16)",
    chip: "#93c5fd",
    icon: "#93c5fd",
    label: "Specialist",
  },
  TICKET: {
    border: "#22c55e",
    bg: "rgba(34,197,94,0.16)",
    chip: "#86efac",
    icon: "#86efac",
    label: "Ticket",
  },
} as const;

function NodeIcon({ color, kind }: { color: string; kind: AgentNodeData["type"] }) {
  const path =
    kind === "SUPERVISOR"
      ? "M12 3L3 8l9 5 9-5-9-5zm0 7l-9-5v10l9 5 9-5V5l-9 5z"
      : kind === "TICKET"
      ? "M4 4h16v4H4V4zm0 6h16v10H4V10zm3 3v4h3v-4H7z"
      : "M12 2a10 10 0 100 20 10 10 0 000-20zm-2 6h4v2h-4V8zm0 4h7v2h-7v-2zm0 4h5v2h-5v-2z";

  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill={color} aria-hidden>
      <path d={path} />
    </svg>
  );
}

export function AgentNode({ data, selected }: NodeProps<AgentNodeData>) {
  const style = styles[data.type];
  const optionPorts: Array<{ id: string; label: string; left: string }> = [
    { id: "port-tools", label: "Tools", left: "12%" },
    { id: "port-knowledge", label: "Knowledge", left: "30%" },
    { id: "port-skills", label: "Skills", left: "50%" },
    { id: "port-permissions", label: "Permissions", left: "70%" },
    { id: "port-channels", label: "Channels", left: "88%" },
  ];

  return (
    <div
      className="relative min-w-[280px] rounded-xl border px-3 py-2 pb-9 shadow-md transition-all"
      style={{
        borderColor: selected ? style.border : "#334155",
        background: selected ? style.bg : "#1e293b",
        boxShadow: selected ? `0 0 0 1px ${style.border} inset` : "none",
      }}
    >
      <Handle id="in-main" type="target" position={Position.Left} style={{ background: style.border }} />
      <div className="mb-2 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "#0f172a", color: style.chip }}>
          <NodeIcon color={style.icon} kind={data.type} />
          {style.label}
        </span>
      </div>
      <div className="text-sm font-semibold text-slate-100">{data.name}</div>
      {data.teamLabel ? <div className="mt-1 text-xs text-slate-400">{data.teamLabel}</div> : null}
      <Handle id="out-main" type="source" position={Position.Right} style={{ background: style.border }} />

      {optionPorts.map((port) => (
        <div key={port.id} className="pointer-events-none absolute bottom-1 flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: port.left }}>
          <Handle
            id={port.id}
            type="source"
            position={Position.Bottom}
            style={{
              left: "50%",
              bottom: 22,
              width: 10,
              height: 10,
              borderRadius: 1,
              transform: "translateX(-50%) rotate(45deg)",
              background: selected ? style.border : "#818cf8",
              border: "1px solid rgba(15,23,42,0.8)",
              pointerEvents: "all",
            }}
          />
          <span className="text-[10px] text-slate-300">{port.label}</span>
        </div>
      ))}
    </div>
  );
}
