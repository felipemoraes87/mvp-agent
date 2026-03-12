import { useEffect, useMemo, useState } from "react";
import { getExecDashboardMock } from "../../mocks/execDashboard.mock";
import type { AuditEvent, ExecDashboardDataset, ExecPeriod, TeamKey } from "./types";
import { buildInsights, formatCompact, formatPercent, formatUsd } from "./utils";
import { KpiCard } from "./components/KpiCard";
import { ChartContainer } from "./components/ChartContainer";
import { SimpleBarChart } from "./components/SimpleBarChart";
import { SimpleLineChart } from "./components/SimpleLineChart";
import { DataTable } from "./components/DataTable";

const PERIOD_OPTIONS: ExecPeriod[] = [7, 30, 90];
const AUDIT_PAGE_SIZE = 8;

function getTeamLabel(team: TeamKey): string {
  if (team === "D&R") return "Detection & Response";
  return team;
}

export function ExecDashboardPageContent() {
  const [period, setPeriod] = useState<ExecPeriod>(30);
  const [reloadTick, setReloadTick] = useState(0);
  const [dataset, setDataset] = useState<ExecDashboardDataset | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [teamFilter, setTeamFilter] = useState<"ALL" | TeamKey>("ALL");
  const [agentFilter, setAgentFilter] = useState("ALL");
  const [page, setPage] = useState(1);

  const applyPeriod = (nextPeriod: ExecPeriod) => {
    setLoading(true);
    setHasError(false);
    setTeamFilter("ALL");
    setAgentFilter("ALL");
    setPage(1);
    setPeriod(nextPeriod);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        setDataset(getExecDashboardMock(period));
        setLoading(false);
      } catch {
        setHasError(true);
        setLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(timer);
  }, [period, reloadTick]);

  const teams = dataset?.teams ?? [];
  const routes = dataset?.routes ?? [];
  const agents = dataset?.agents ?? [];
  const modelRows = dataset?.models ?? [];
  const insights = useMemo(() => (dataset ? buildInsights(dataset) : []), [dataset]);

  const availableAgents = useMemo(() => {
    if (!dataset) return [];
    return dataset.agents.filter((agent) => teamFilter === "ALL" || agent.team === teamFilter);
  }, [dataset, teamFilter]);

  const filteredAudit = useMemo(() => {
    if (!dataset) return [];
    return dataset.audit.filter((event) => {
      if (teamFilter !== "ALL" && event.team !== teamFilter) return false;
      if (agentFilter !== "ALL" && event.agent !== agentFilter) return false;
      return true;
    });
  }, [dataset, teamFilter, agentFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAudit.length / AUDIT_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedAudit = filteredAudit.slice((currentPage - 1) * AUDIT_PAGE_SIZE, currentPage * AUDIT_PAGE_SIZE);

  if (loading) {
    return (
      <div className="space-y-4" aria-live="polite" aria-busy="true">
        <div className="panel p-4">
          <div className="h-5 w-72 animate-pulse rounded bg-slate-700" />
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-lg bg-slate-800/70" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (hasError || !dataset) {
    return (
      <div className="panel p-5">
        <h2 className="text-lg font-semibold text-slate-100">Executive Dashboard indisponÃ­vel</h2>
        <p className="mt-2 text-sm text-slate-400">Não foi possível carregar os dados desse período.</p>
        <button className="btn-primary mt-4" onClick={() => setReloadTick((value) => value + 1)}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Executive Dashboard</h2>
            <p className="mt-1 text-xs text-slate-400">Visão executiva de runs, custos, performance e auditoria de agentes.</p>
          </div>
          <div className="flex items-center gap-2" role="group" aria-label="Selecionar perÃ­odo">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option}
                className={option === period ? "btn-primary" : "btn-ghost"}
                onClick={() => applyPeriod(option)}
                aria-pressed={option === period}
              >
                Ãšltimos {option} dias
              </button>
            ))}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">Premissa de custo: preço por 1k tokens de entrada/saída por modelo (ver seção IA/Modelos).</p>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <KpiCard label="Total de Runs" value={formatCompact(dataset.totals.totalRuns)} />
        <KpiCard label="Custo Estimado" value={formatUsd(dataset.totals.estimatedCostUsd)} />
        <KpiCard label="Tokens Estimados" value={formatCompact(dataset.totals.estimatedTokens)} />
        <KpiCard label="Tempo MÃ©dio / p95" value={`${dataset.totals.avgLatencyMs}ms / ${dataset.totals.p95LatencyMs}ms`} />
        <KpiCard label="Deflection Rate" value={formatPercent(dataset.totals.deflectionRatePct)} />
        <KpiCard label="Taxa de Erro" value={formatPercent(dataset.totals.errorRatePct)} help={`CSAT: ${dataset.totals.csat.toFixed(2)}/5`} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartContainer title="IA / Modelos utilizados" subtitle="Share de runs, custo e latÃªncia por modelo">
          <SimpleBarChart
            items={modelRows.map((item) => ({
              label: `${item.model} (${item.sharePct.toFixed(1)}%)`,
              value: item.runs,
              note: `${formatUsd(item.costUsd)} | erro ${item.errorRatePct.toFixed(1)}%`,
            }))}
          />
        </ChartContainer>
        <ChartContainer title="Tabela de modelos" subtitle="Breakdown de uso de LLMs">
          <DataTable
            rows={modelRows}
            rowKey={(row) => row.model}
            columns={[
              { key: "model", label: "Modelo", render: (row) => <span className="font-semibold text-slate-100">{row.model}</span> },
              { key: "runs", label: "Runs", render: (row) => row.runs.toLocaleString("en-US") },
              { key: "tokens", label: "Tokens", render: (row) => formatCompact(row.tokens) },
              { key: "cost", label: "Custo", render: (row) => formatUsd(row.costUsd) },
              { key: "latency", label: "MÃ©dia", render: (row) => `${row.avgLatencyMs}ms` },
            ]}
          />
        </ChartContainer>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-300">Times e Agentes</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {teams.map((team) => (
            <div key={team.team} className="panel p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-indigo-300">{team.displayName}</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{team.runs.toLocaleString("en-US")} runs</p>
              <p className="text-xs text-slate-400">{formatUsd(team.costUsd)} | {team.agents} agentes</p>
              <p className="mt-3 text-[11px] text-slate-500">Top rotas conversacionais: {team.topRoutes.join(" | ")}</p>
              <p className="mt-1 text-[11px] text-slate-500">Especialistas: {team.specialists.slice(0, 2).join(" | ")}</p>
            </div>
          ))}
        </div>
        <ChartContainer title="Tabela de agentes" subtitle="DistribuiÃ§Ã£o entre agentes gerais e especialistas">
          <DataTable
            rows={agents}
            rowKey={(row) => row.id}
            columns={[
              { key: "name", label: "Agente", render: (row) => <span className="font-semibold text-slate-100">{row.name}</span> },
              { key: "type", label: "Tipo", render: (row) => (row.type === "GENERAL" ? "geral" : "especialista") },
              { key: "team", label: "Time", render: (row) => getTeamLabel(row.team) },
              { key: "runs", label: "Runs", render: (row) => row.runs.toLocaleString("en-US") },
              { key: "cost", label: "Custo", render: (row) => formatUsd(row.costUsd) },
              { key: "error", label: "Erro", render: (row) => `${row.errorRatePct.toFixed(1)}%` },
            ]}
          />
        </ChartContainer>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartContainer title="Rotas conversacionais mais usadas" subtitle="Top 10 trilhas de handoff por volume de runs">
          <SimpleBarChart items={routes.map((route) => ({ label: route.route, value: route.runs, note: `${route.p95LatencyMs}ms p95` }))} colorClass="bg-sky-500" />
        </ChartContainer>
        <ChartContainer title="Top 10 intents" subtitle="Intents mais acionadas no perÃ­odo selecionado">
          <DataTable
            rows={dataset.intents}
            rowKey={(row) => row.intent}
            columns={[
              { key: "intent", label: "Intent", render: (row) => row.intent },
              { key: "runs", label: "Runs", render: (row) => row.runs.toLocaleString("en-US") },
            ]}
          />
        </ChartContainer>
      </section>

      <ChartContainer title="Tabela de rotas conversacionais" subtitle="Trilha de conversa, runs, custo, erro e latÃªncia p95">
        <DataTable
          rows={routes}
          rowKey={(row) => row.route}
          columns={[
            { key: "route", label: "Rota conversacional", render: (row) => <span className="font-semibold text-slate-100">{row.route}</span> },
            { key: "runs", label: "Runs", render: (row) => row.runs.toLocaleString("en-US") },
            { key: "cost", label: "Custo", render: (row) => formatUsd(row.costUsd) },
            { key: "error", label: "Erro", render: (row) => `${row.errorRatePct.toFixed(1)}%` },
            { key: "p95", label: "Latency p95", render: (row) => `${row.p95LatencyMs}ms` },
          ]}
        />
      </ChartContainer>

      <section className="grid gap-4 xl:grid-cols-2">
        <ChartContainer title="Custos ao longo do tempo" subtitle="EvoluÃ§Ã£o diÃ¡ria do custo estimado (USD)">
          <SimpleLineChart points={dataset.daily.map((day) => ({ label: day.date.slice(5), value: day.costUsd }))} />
        </ChartContainer>
        <ChartContainer title="Breakdown de custos" subtitle="Por time e por modelo">
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs text-slate-400">Custo por time</p>
              <SimpleBarChart
                items={dataset.costByTeam.map((item) => ({ label: getTeamLabel(item.team), value: Math.round(item.costUsd * 100), note: formatUsd(item.costUsd) }))}
                colorClass="bg-emerald-500"
              />
            </div>
            <div>
              <p className="mb-2 text-xs text-slate-400">Custo por modelo</p>
              <SimpleBarChart
                items={dataset.costByModel.map((item) => ({ label: item.model, value: Math.round(item.costUsd * 100), note: formatUsd(item.costUsd) }))}
                colorClass="bg-violet-500"
              />
            </div>
          </div>
        </ChartContainer>
      </section>

      <ChartContainer title="Auditoria (amostra)" subtitle="Filtro por time e agente com paginação">
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <select
            className="input-dark"
            aria-label="Filtrar auditoria por time"
            value={teamFilter}
            onChange={(event) => {
              const value = event.target.value;
              setTeamFilter(value === "ALL" ? "ALL" : (value as TeamKey));
              setAgentFilter("ALL");
              setPage(1);
            }}
          >
            <option value="ALL">Todos os times</option>
            {teams.map((team) => (
              <option key={team.team} value={team.team}>
                {team.displayName}
              </option>
            ))}
          </select>
          <select
            className="input-dark"
            aria-label="Filtrar auditoria por agente"
            value={agentFilter}
            onChange={(event) => {
              setAgentFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">Todos os agentes</option>
            {availableAgents.map((agent) => (
              <option key={agent.id} value={agent.name}>
                {agent.name}
              </option>
            ))}
          </select>
          <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
            PÃ¡gina {currentPage}/{totalPages} | {filteredAudit.length} eventos
          </div>
        </div>
        <DataTable
          rows={paginatedAudit}
          rowKey={(row: AuditEvent) => row.id}
          emptyMessage="Nenhum evento para esse filtro."
          columns={[
            { key: "time", label: "Time", render: (row) => getTeamLabel(row.team) },
            { key: "agent", label: "Agente", render: (row) => row.agent },
            { key: "user", label: "UsuÃ¡rio", render: (row) => row.user },
            { key: "action", label: "AÃ§Ã£o", render: (row) => row.action },
            { key: "route", label: "Rota conversacional", render: (row) => row.route },
            { key: "cost", label: "Custo", render: (row) => formatUsd(row.costUsd) },
            { key: "timestamp", label: "Timestamp", render: (row) => new Date(row.timestamp).toLocaleString("pt-BR") },
          ]}
        />
        <div className="mt-3 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage <= 1}>
            Anterior
          </button>
          <button className="btn-ghost" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={currentPage >= totalPages}>
            PrÃ³xima
          </button>
        </div>
      </ChartContainer>

      <ChartContainer title="Insights automáticos" subtitle="Resumo executivo derivado do dataset local">
        <ul className="space-y-2 text-sm text-slate-200">
          {insights.map((insight) => (
            <li key={insight} className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2">
              {insight}
            </li>
          ))}
        </ul>
      </ChartContainer>

      <ChartContainer title="Erro por categoria" subtitle="DistribuiÃ§Ã£o consolidada de falhas">
        <SimpleBarChart items={dataset.errors.map((item) => ({ label: item.category, value: item.count }))} colorClass="bg-rose-500" />
      </ChartContainer>
    </div>
  );
}

