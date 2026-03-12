export type ExecPeriod = 7 | 30 | 90;

export type AgentKind = "GENERAL" | "SPECIALIST";

export type ErrorCategory = "timeout" | "tool_error" | "policy_blocked" | "auth_denied";

export type TeamKey = "APPSEC" | "IAM" | "D&R" | "CORPSEC";

export type CostAssumption = {
  model: string;
  inputUsdPer1k: number;
  outputUsdPer1k: number;
};

export type DailyPoint = {
  date: string;
  runs: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errors: number;
  csat: number;
  deflectionRate: number;
};

export type ModelUsage = {
  model: string;
  runs: number;
  tokens: number;
  costUsd: number;
  avgLatencyMs: number;
  errorRatePct: number;
  sharePct: number;
};

export type TeamSummary = {
  team: TeamKey;
  displayName: string;
  runs: number;
  costUsd: number;
  topRoutes: string[];
  specialists: string[];
  agents: number;
};

export type AgentMetric = {
  id: string;
  name: string;
  type: AgentKind;
  team: TeamKey;
  runs: number;
  costUsd: number;
  errorRatePct: number;
};

export type RouteMetric = {
  route: string;
  runs: number;
  costUsd: number;
  errorRatePct: number;
  p95LatencyMs: number;
};

export type IntentMetric = {
  intent: string;
  runs: number;
};

export type ErrorBreakdown = {
  category: ErrorCategory;
  count: number;
};

export type AuditEvent = {
  id: string;
  timestamp: string;
  team: TeamKey;
  agent: string;
  user: string;
  action: string;
  route: string;
  costUsd: number;
  latencyMs: number;
  status: "ok" | "error";
};

export type ExecutiveKpis = {
  totalRuns: number;
  estimatedCostUsd: number;
  estimatedTokens: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  deflectionRatePct: number;
  errorRatePct: number;
  csat: number;
};

export type ExecDashboardDataset = {
  period: ExecPeriod;
  generatedAt: string;
  assumptions: CostAssumption[];
  totals: ExecutiveKpis;
  daily: DailyPoint[];
  models: ModelUsage[];
  teams: TeamSummary[];
  agents: AgentMetric[];
  routes: RouteMetric[];
  intents: IntentMetric[];
  errors: ErrorBreakdown[];
  audit: AuditEvent[];
  costByTeam: Array<{ team: TeamKey; costUsd: number }>;
  costByModel: Array<{ model: string; costUsd: number }>;
};
