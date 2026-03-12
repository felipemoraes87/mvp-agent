import { Handle, Position } from "reactflow";

export function ResourceNode({ data }: { data: { label: string; count: number; color: string } }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-xs shadow-md backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: data.color }} />
        <span className="font-semibold text-slate-100">{data.label}</span>
      </div>
      <div className="mt-1 text-[11px] text-slate-300">{data.count} linked</div>
      <Handle type="target" position={Position.Left} className="!h-1 !w-1 !border-0 !bg-transparent" />
      <Handle type="source" position={Position.Right} className="!h-1 !w-1 !border-0 !bg-transparent" />
    </div>
  );
}
