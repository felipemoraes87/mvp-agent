import type { ExecDashboardDataset, TeamSummary } from "./types";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

export function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function topCostModel(data: ExecDashboardDataset): { model: string; costUsd: number } {
  return data.models.reduce(
    (acc, item) => (item.costUsd > acc.costUsd ? { model: item.model, costUsd: item.costUsd } : acc),
    { model: data.models[0]?.model ?? "-", costUsd: data.models[0]?.costUsd ?? 0 },
  );
}

function highestLatencyRoute(data: ExecDashboardDataset): { route: string; p95LatencyMs: number } {
  return data.routes.reduce(
    (acc, item) => (item.p95LatencyMs > acc.p95LatencyMs ? { route: item.route, p95LatencyMs: item.p95LatencyMs } : acc),
    { route: data.routes[0]?.route ?? "-", p95LatencyMs: data.routes[0]?.p95LatencyMs ?? 0 },
  );
}

function hottestTeam(data: ExecDashboardDataset): TeamSummary {
  return data.teams.reduce((acc, item) => (item.runs > acc.runs ? item : acc), data.teams[0]);
}

function growthBetweenWindows(data: ExecDashboardDataset): number {
  if (data.daily.length < 8) return 0;
  const window = Math.max(3, Math.floor(data.daily.length / 6));
  const start = data.daily.slice(0, window).reduce((acc, day) => acc + day.runs, 0);
  const end = data.daily.slice(-window).reduce((acc, day) => acc + day.runs, 0);
  if (start === 0) return 0;
  return ((end - start) / start) * 100;
}

export function buildInsights(data: ExecDashboardDataset): string[] {
  const model = topCostModel(data);
  const route = highestLatencyRoute(data);
  const team = hottestTeam(data);
  const growth = growthBetweenWindows(data);
  const policyBlocked = data.errors.find((entry) => entry.category === "policy_blocked")?.count ?? 0;
  const policyShare = data.errors.length ? (policyBlocked / data.errors.reduce((acc, item) => acc + item.count, 0)) * 100 : 0;

  return [
    `${team.displayName} lidera o período com ${formatCompact(team.runs)} runs e ${formatUsd(team.costUsd)} de custo estimado.`,
    `${model.model} concentra ${formatPercent((model.costUsd / Math.max(1, data.totals.estimatedCostUsd)) * 100)} do custo total.`,
    `${route.route} apresenta maior latência p95 (${route.p95LatencyMs}ms) e merece otimização de fluxo.`,
    `Deflection rate médio ficou em ${formatPercent(data.totals.deflectionRatePct)} com CSAT ${data.totals.csat.toFixed(2)}/5.`,
    `Policy blocks representam ${formatPercent(policyShare)} dos erros e o volume de runs variou ${formatPercent(growth)} entre janelas.`,
  ];
}
