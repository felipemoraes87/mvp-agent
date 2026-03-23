import type { GraphSummary } from "../types";

export function GraphMetrics({ summary }: { summary: GraphSummary }) {
  const cards = [
    { label: "Total Teams", value: summary.totalTeams, tone: "text-sky-200" },
    { label: "Total Agents", value: summary.totalAgents, tone: "text-slate-100" },
    { label: "Coordinators", value: summary.totalCoordinators, tone: "text-indigo-200" },
    { label: "Connections", value: summary.totalConnections, tone: "text-amber-200" },
    { label: "Teams ativos", value: summary.activeTeams, tone: "text-emerald-200" },
    { label: "Agents degraded", value: summary.degradedAgents, tone: "text-rose-200" },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {cards.map((card) => (
        <div key={card.label} className="panel p-4">
          <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{card.label}</div>
          <div className={`mt-2 text-2xl font-semibold ${card.tone}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}
