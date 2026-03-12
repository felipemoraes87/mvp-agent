type SimpleBarChartProps = {
  items: Array<{ label: string; value: number; note?: string }>;
  colorClass?: string;
  maxItems?: number;
};

export function SimpleBarChart({ items, colorClass = "bg-indigo-500", maxItems }: SimpleBarChartProps) {
  const data = maxItems ? items.slice(0, maxItems) : items;
  const max = Math.max(1, ...data.map((item) => item.value));

  if (!data.length) {
    return <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-4 text-sm text-slate-400">Sem dados para exibir.</div>;
  }

  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-300">
            <span className="truncate">{item.label}</span>
            <span className="font-semibold text-slate-100">{item.value.toLocaleString("en-US")}</span>
          </div>
          <div className="h-2 rounded bg-slate-800">
            <div className={`h-2 rounded ${colorClass}`} style={{ width: `${Math.max(6, (item.value / max) * 100)}%` }} />
          </div>
          {item.note ? <p className="mt-1 text-[11px] text-slate-500">{item.note}</p> : null}
        </div>
      ))}
    </div>
  );
}
