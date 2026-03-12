type KpiCardProps = {
  label: string;
  value: string;
  help?: string;
};

export function KpiCard({ label, value, help }: KpiCardProps) {
  return (
    <div className="panel-soft p-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
      {help ? <p className="mt-1 text-xs text-slate-500">{help}</p> : null}
    </div>
  );
}
