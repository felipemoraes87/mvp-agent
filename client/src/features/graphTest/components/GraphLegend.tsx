export function GraphLegend() {
  const nodeTypes = [
    { label: "Team node", color: "bg-sky-400" },
    { label: "Agent node", color: "bg-violet-400" },
    { label: "Coordinator node", color: "bg-indigo-400" },
  ];
  const states = [
    { label: "healthy", color: "bg-emerald-400" },
    { label: "warning", color: "bg-amber-400" },
    { label: "error", color: "bg-rose-400" },
    { label: "inactive", color: "bg-slate-500" },
    { label: "unknown", color: "bg-slate-300" },
  ];

  return (
    <div className="panel p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Node types</div>
          <div className="mt-2 flex flex-wrap gap-3">
            {nodeTypes.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
                <span className={`h-3 w-3 rounded-full ${item.color}`} />
                {item.label}
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">States</div>
          <div className="mt-2 flex flex-wrap gap-3">
            {states.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-xs text-slate-300">
                <span className={`h-3 w-3 rounded-full ${item.color}`} />
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
