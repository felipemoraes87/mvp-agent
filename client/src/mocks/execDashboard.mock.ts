import type {
  AgentMetric,
  AuditEvent,
  CostAssumption,
  DailyPoint,
  ErrorBreakdown,
  ExecDashboardDataset,
  ExecPeriod,
  IntentMetric,
  ModelUsage,
  RouteMetric,
  TeamKey,
  TeamSummary,
} from "../features/execDashboard/types";

type TeamDefinition = {
  team: TeamKey;
  displayName: string;
  agents: Array<{ id: string; name: string; type: "GENERAL" | "SPECIALIST" }>;
  weight: number;
};

const MODEL_ASSUMPTIONS: CostAssumption[] = [
  { model: "OpenAI GPT-4o", inputUsdPer1k: 0.010, outputUsdPer1k: 0.030 },
  { model: "OpenAI GPT-4.1-mini", inputUsdPer1k: 0.0010, outputUsdPer1k: 0.0040 },
  { model: "Claude 3.5 Sonnet", inputUsdPer1k: 0.0030, outputUsdPer1k: 0.0150 },
  { model: "Gemini 1.5 Pro", inputUsdPer1k: 0.0035, outputUsdPer1k: 0.0105 },
];

const TEAM_DEFINITIONS: TeamDefinition[] = [
  {
    team: "APPSEC",
    displayName: "AppSec",
    weight: 0.26,
    agents: [
      { id: "appsec-general", name: "Agente Geral AppSec", type: "GENERAL" },
      { id: "appsec-threat-modeling", name: "Especialista: Modelagem de Ameaças", type: "SPECIALIST" },
      { id: "appsec-code-remediation", name: "Especialista: Correção de Vulnerabilidade de Código", type: "SPECIALIST" },
    ],
  },
  {
    team: "IAM",
    displayName: "IAM",
    weight: 0.29,
    agents: [
      { id: "iam-general", name: "Agente Geral IAM", type: "GENERAL" },
      { id: "iam-gcp", name: "Especialista: GCP", type: "SPECIALIST" },
      { id: "iam-audit", name: "Especialista: Auditoria", type: "SPECIALIST" },
    ],
  },
  {
    team: "D&R",
    displayName: "Detection & Response",
    weight: 0.30,
    agents: [
      { id: "dr-general", name: "Agente Geral D&R", type: "GENERAL" },
      { id: "dr-use-case", name: "Especialista: Criação de Caso de Uso e Monitoramento", type: "SPECIALIST" },
      { id: "dr-incident", name: "Especialista: Investigação de Incidente", type: "SPECIALIST" },
    ],
  },
  {
    team: "CORPSEC",
    displayName: "CorpSec",
    weight: 0.15,
    agents: [
      { id: "corpsec-general", name: "Agente Geral CorpSec", type: "GENERAL" },
      { id: "corpsec-endpoints", name: "Especialista: Endpoints", type: "SPECIALIST" },
      { id: "corpsec-third-party", name: "Especialista: Avaliação de Solução de Terceiros", type: "SPECIALIST" },
    ],
  },
];

const ROUTE_BASE = [
  { route: "Global -> IAM -> Especialista GCP", weight: 0.2, p95Base: 5400 },
  { route: "Global -> D&R -> Especialista Investigação de Incidente", weight: 0.15, p95Base: 4900 },
  { route: "Global -> AppSec -> Especialista Modelagem de Ameaças", weight: 0.12, p95Base: 3600 },
  { route: "Global -> CorpSec -> Especialista Avaliação de Terceiros", weight: 0.11, p95Base: 3200 },
  { route: "Global -> IAM -> Especialista Auditoria", weight: 0.1, p95Base: 3000 },
  { route: "Global -> D&R -> Especialista Caso de Uso e Monitoramento", weight: 0.09, p95Base: 3500 },
  { route: "Global -> AppSec -> Especialista Correção de Vulnerabilidade", weight: 0.08, p95Base: 3800 },
  { route: "Global -> CorpSec -> Especialista Endpoints", weight: 0.06, p95Base: 2700 },
  { route: "Global -> IAM -> Agente Geral IAM", weight: 0.05, p95Base: 2500 },
  { route: "Global -> AppSec -> Agente Geral AppSec", weight: 0.04, p95Base: 2400 },
];

const INTENT_BASE = [
  "investigar incidente",
  "revisar acesso gcp",
  "aprovar mudança",
  "analisar trilha de auditoria",
  "modelar ameaça",
  "corrigir vulnerabilidade de código",
  "criar caso de uso deteccao",
  "avaliar risco de fornecedor",
  "endurecer endpoint",
  "gerar evidência de compliance",
];

const ERROR_WEIGHTS: Array<{ category: ErrorBreakdown["category"]; weight: number }> = [
  { category: "timeout", weight: 0.35 },
  { category: "tool_error", weight: 0.29 },
  { category: "policy_blocked", weight: 0.24 },
  { category: "auth_denied", weight: 0.12 },
];

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function getDateISO(daysAgo: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function generateDaily(period: ExecPeriod): DailyPoint[] {
  const baseRuns = period === 7 ? 250 : period === 30 ? 220 : 205;
  return Array.from({ length: period }, (_, idx) => {
    const day = period - idx - 1;
    const weekdayFactor = ((idx + 2) % 7) >= 5 ? 0.82 : 1.07;
    const trendFactor = 1 + idx / (period * 8);
    const runs = Math.round(baseRuns * weekdayFactor * trendFactor);
    const tokens = Math.round(runs * (1250 + ((idx * 37) % 320)));
    const costUsd = round(tokens / 1000 * 0.0058, 2);
    const avgLatencyMs = Math.round(1320 + ((idx * 53) % 420));
    const p95LatencyMs = Math.round(avgLatencyMs * 2.45 + ((idx * 71) % 330));
    const errors = Math.round(runs * (0.028 + (idx % 5) * 0.0023));
    const csat = round(4.22 + ((idx % 6) - 3) * 0.04, 2);
    const deflectionRate = round(71 + (idx % 9) * 0.9, 1);
    return {
      date: getDateISO(day),
      runs,
      tokens,
      costUsd,
      avgLatencyMs,
      p95LatencyMs,
      errors,
      csat,
      deflectionRate,
    };
  });
}

function buildModelUsage(totalRuns: number, totalTokens: number): ModelUsage[] {
  const distribution = [
    { model: "OpenAI GPT-4o", share: 0.34, tokenFactor: 1.28, errorRatePct: 3.1, avgLatencyMs: 1620 },
    { model: "OpenAI GPT-4.1-mini", share: 0.26, tokenFactor: 0.78, errorRatePct: 2.0, avgLatencyMs: 1180 },
    { model: "Claude 3.5 Sonnet", share: 0.21, tokenFactor: 1.05, errorRatePct: 2.7, avgLatencyMs: 1410 },
    { model: "Gemini 1.5 Pro", share: 0.19, tokenFactor: 1.13, errorRatePct: 2.4, avgLatencyMs: 1360 },
  ];

  return distribution.map((item) => {
    const modelRuns = Math.round(totalRuns * item.share);
    const modelTokens = Math.round(totalTokens * item.share * item.tokenFactor);
    const assumptions = MODEL_ASSUMPTIONS.find((entry) => entry.model === item.model);
    const outputTokens = modelTokens * 0.42;
    const inputTokens = modelTokens * 0.58;
    const costUsd = assumptions
      ? round((inputTokens / 1000) * assumptions.inputUsdPer1k + (outputTokens / 1000) * assumptions.outputUsdPer1k, 2)
      : 0;
    return {
      model: item.model,
      runs: modelRuns,
      tokens: modelTokens,
      costUsd,
      avgLatencyMs: item.avgLatencyMs,
      errorRatePct: item.errorRatePct,
      sharePct: round(item.share * 100, 1),
    };
  });
}

function buildTeams(totalRuns: number, totalCostUsd: number): TeamSummary[] {
  return TEAM_DEFINITIONS.map((item, index) => {
    const runs = Math.round(totalRuns * item.weight);
    const costUsd = round(totalCostUsd * (item.weight + index * 0.01), 2);
    const topRoutes = ROUTE_BASE.slice(index, index + 3).map((route) => route.route);
    const specialists = item.agents.filter((agent) => agent.type === "SPECIALIST").map((agent) => agent.name);
    return {
      team: item.team,
      displayName: item.displayName,
      runs,
      costUsd,
      topRoutes,
      specialists,
      agents: item.agents.length,
    };
  });
}

function buildAgentMetrics(teams: TeamSummary[]): AgentMetric[] {
  return TEAM_DEFINITIONS.flatMap((teamDef) => {
    const teamTotals = teams.find((team) => team.team === teamDef.team);
    const teamRuns = teamTotals?.runs ?? 0;
    const teamCost = teamTotals?.costUsd ?? 0;
    return teamDef.agents.map((agent, idx) => {
      const ratio = agent.type === "GENERAL" ? 0.44 : idx === 1 ? 0.33 : 0.23;
      const runs = Math.round(teamRuns * ratio);
      const costUsd = round(teamCost * ratio * (agent.type === "GENERAL" ? 0.88 : 1.08), 2);
      const errorRatePct = round(agent.type === "GENERAL" ? 2.1 + idx * 0.3 : 2.9 + idx * 0.4, 2);
      return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        team: teamDef.team,
        runs,
        costUsd,
        errorRatePct,
      };
    });
  });
}

function buildRoutes(totalRuns: number, totalCostUsd: number): RouteMetric[] {
  return ROUTE_BASE.map((item, idx) => {
    const runs = Math.round(totalRuns * item.weight);
    const costUsd = round(totalCostUsd * item.weight * (idx % 3 === 0 ? 1.15 : 0.94), 2);
    return {
      route: item.route,
      runs,
      costUsd,
      errorRatePct: round(2.1 + (idx % 4) * 0.7, 2),
      p95LatencyMs: item.p95Base + idx * 140,
    };
  });
}

function buildIntents(totalRuns: number): IntentMetric[] {
  return INTENT_BASE.map((intent, idx) => ({
    intent,
    runs: Math.max(20, Math.round(totalRuns * (0.16 - idx * 0.0115))),
  }));
}

function buildErrors(totalErrors: number): ErrorBreakdown[] {
  return ERROR_WEIGHTS.map((item) => ({
    category: item.category,
    count: Math.max(1, Math.round(totalErrors * item.weight)),
  }));
}

function buildAudit(period: ExecPeriod, routes: RouteMetric[], agents: AgentMetric[]): AuditEvent[] {
  const size = Math.max(36, Math.round(period * 1.6));
  const users = ["ana.silva", "bruno.matos", "clara.nunes", "diego.pereira", "erika.santos", "felipe.oliveira"];
  const actions = ["RUN_SIMULATION", "CHAT_AGENT", "ROUTE_DECISION", "TOOL_CALL", "POLICY_EVAL"];
  return Array.from({ length: size }, (_, idx) => {
    const route = routes[idx % routes.length];
    const agent = agents[idx % agents.length];
    const date = new Date();
    date.setMinutes(date.getMinutes() - idx * 37);
    return {
      id: `evt-${period}-${idx + 1}`,
      timestamp: date.toISOString(),
      team: agent.team,
      agent: agent.name,
      user: users[idx % users.length],
      action: actions[idx % actions.length],
      route: route.route,
      costUsd: round(route.costUsd / Math.max(1, route.runs) * (1 + (idx % 4) * 0.2), 4),
      latencyMs: route.p95LatencyMs - 700 + (idx % 5) * 160,
      status: idx % 12 === 0 ? "error" : "ok",
    };
  });
}

function buildDataset(period: ExecPeriod): ExecDashboardDataset {
  const daily = generateDaily(period);
  const totalRuns = daily.reduce((acc, item) => acc + item.runs, 0);
  const totalTokens = daily.reduce((acc, item) => acc + item.tokens, 0);
  const totalCostUsd = round(daily.reduce((acc, item) => acc + item.costUsd, 0), 2);
  const totalErrors = daily.reduce((acc, item) => acc + item.errors, 0);
  const avgLatency = Math.round(daily.reduce((acc, item) => acc + item.avgLatencyMs, 0) / daily.length);
  const p95Latency = Math.round(daily.reduce((acc, item) => acc + item.p95LatencyMs, 0) / daily.length);
  const avgDeflection = round(daily.reduce((acc, item) => acc + item.deflectionRate, 0) / daily.length, 1);
  const avgCsat = round(daily.reduce((acc, item) => acc + item.csat, 0) / daily.length, 2);

  const models = buildModelUsage(totalRuns, totalTokens);
  const teams = buildTeams(totalRuns, totalCostUsd);
  const agents = buildAgentMetrics(teams);
  const routes = buildRoutes(totalRuns, totalCostUsd);
  const intents = buildIntents(totalRuns);
  const errors = buildErrors(totalErrors);
  const audit = buildAudit(period, routes, agents);

  return {
    period,
    generatedAt: new Date().toISOString(),
    assumptions: MODEL_ASSUMPTIONS,
    totals: {
      totalRuns,
      estimatedCostUsd: totalCostUsd,
      estimatedTokens: totalTokens,
      avgLatencyMs: avgLatency,
      p95LatencyMs: p95Latency,
      deflectionRatePct: avgDeflection,
      errorRatePct: round((totalErrors / totalRuns) * 100, 2),
      csat: avgCsat,
    },
    daily,
    models,
    teams,
    agents,
    routes,
    intents,
    errors,
    audit,
    costByTeam: teams.map((team) => ({ team: team.team, costUsd: team.costUsd })),
    costByModel: models.map((model) => ({ model: model.model, costUsd: model.costUsd })),
  };
}

export const EXEC_DASHBOARD_MOCKS: Record<ExecPeriod, ExecDashboardDataset> = {
  7: buildDataset(7),
  30: buildDataset(30),
  90: buildDataset(90),
};

export function getExecDashboardMock(period: ExecPeriod): ExecDashboardDataset {
  return EXEC_DASHBOARD_MOCKS[period];
}
