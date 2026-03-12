import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import { HelpTip } from "../components/HelpTip";
import { useAuth } from "../lib/auth";

type Card = { teamId: string; teamKey: string; teamName: string; agents: number; tools: number; routes: number };

type UsageSummary = {
  totalSimulations: number;
  simulationsLast24h: number;
  deniedEventsLast24h: number;
  auditEventsLast24h: number;
  writeToolAssignments: number;
  configuredToolCapacityPerMin: number;
};

type AgentUsage = {
  agentId: string;
  agentName: string;
  type: "SUPERVISOR" | "SPECIALIST" | "TICKET";
  teamKey: string;
  runs: number;
  avgConfidence: number;
};

type ToolConsumption = {
  toolId: string;
  toolName: string;
  type: string;
  policy: "read" | "write";
  teamKey: string;
  linkedAgents: number;
  assignments: number;
  writeAssignments: number;
  rateLimitPerMinute: number;
};

type DailyConsumption = { date: string; simulations: number; deniedEvents: number };
type LlmConsumption = { modelId: string; simulations: number; chats: number; total: number };
type McpToolConsumption = { type: string; tools: number; linkedAgents: number; assignments: number; writeAssignments: number; totalRateLimitPerMinute: number };

type DashboardResponse = {
  cards: Card[];
  usageSummary: UsageSummary;
  agentUsage: AgentUsage[];
  toolConsumption: ToolConsumption[];
  llmConsumption: LlmConsumption[];
  mcpToolConsumption: McpToolConsumption[];
  dailyConsumption: DailyConsumption[];
};

const emptySummary: UsageSummary = {
  totalSimulations: 0,
  simulationsLast24h: 0,
  deniedEventsLast24h: 0,
  auditEventsLast24h: 0,
  writeToolAssignments: 0,
  configuredToolCapacityPerMin: 0,
};

export function DashboardPage() {
  const { user } = useAuth();
  const [cards, setCards] = useState<Card[]>([]);
  const [summary, setSummary] = useState<UsageSummary>(emptySummary);
  const [agentUsage, setAgentUsage] = useState<AgentUsage[]>([]);
  const [toolConsumption, setToolConsumption] = useState<ToolConsumption[]>([]);
  const [llmConsumption, setLlmConsumption] = useState<LlmConsumption[]>([]);
  const [mcpToolConsumption, setMcpToolConsumption] = useState<McpToolConsumption[]>([]);
  const [dailyConsumption, setDailyConsumption] = useState<DailyConsumption[]>([]);
  const [importPayload, setImportPayload] = useState("");
  const [status, setStatus] = useState("");
  const [teamFilter, setTeamFilter] = useState("ALL");
  const [llmProviderFilter, setLlmProviderFilter] = useState("ALL");
  const [llmModelFilter, setLlmModelFilter] = useState("ALL");

  const load = async () => {
    const data = await apiGet<DashboardResponse>("/api/dashboard");
    setCards(data.cards);
    setSummary(data.usageSummary || emptySummary);
    setAgentUsage(data.agentUsage || []);
    setToolConsumption(data.toolConsumption || []);
    setLlmConsumption(data.llmConsumption || []);
    setMcpToolConsumption(data.mcpToolConsumption || []);
    setDailyConsumption(data.dailyConsumption || []);
  };

  useEffect(() => {
    void load();
  }, []);

  const importJson = async () => {
    await apiPost("/api/config/import", { format: "json", payload: importPayload });
    setStatus("Import completed.");
    await load();
  };

  const maxDaily = useMemo(() => Math.max(1, ...dailyConsumption.map((item) => item.simulations)), [dailyConsumption]);

  const llmModelParts = useMemo(
    () =>
      llmConsumption.map((item) => {
        const [provider, ...rest] = item.modelId.split(":");
        return { raw: item.modelId, provider: rest.length ? provider : "unknown", model: rest.length ? rest.join(":") : item.modelId };
      }),
    [llmConsumption],
  );

  const llmProviders = useMemo(
    () => Array.from(new Set(llmModelParts.map((item) => item.provider))).sort((a, b) => a.localeCompare(b)),
    [llmModelParts],
  );

  const llmModels = useMemo(() => {
    const scoped = llmModelParts.filter((item) => llmProviderFilter === "ALL" || item.provider === llmProviderFilter);
    return Array.from(new Set(scoped.map((item) => item.model))).sort((a, b) => a.localeCompare(b));
  }, [llmModelParts, llmProviderFilter]);

  const filteredCards = useMemo(
    () => cards.filter((card) => teamFilter === "ALL" || card.teamId === teamFilter),
    [cards, teamFilter],
  );

  const teamKeys = useMemo(() => new Set(filteredCards.map((card) => card.teamKey)), [filteredCards]);

  const filteredAgentUsage = useMemo(
    () => agentUsage.filter((item) => teamFilter === "ALL" || teamKeys.has(item.teamKey)),
    [agentUsage, teamFilter, teamKeys],
  );

  const filteredToolConsumption = useMemo(
    () => toolConsumption.filter((item) => teamFilter === "ALL" || teamKeys.has(item.teamKey)),
    [toolConsumption, teamFilter, teamKeys],
  );

  const filteredLlmConsumption = useMemo(
    () =>
      llmConsumption.filter((item) => {
        const [provider, ...rest] = item.modelId.split(":");
        const parsedProvider = rest.length ? provider : "unknown";
        const parsedModel = rest.length ? rest.join(":") : item.modelId;
        if (llmProviderFilter !== "ALL" && parsedProvider !== llmProviderFilter) return false;
        if (llmModelFilter !== "ALL" && parsedModel !== llmModelFilter) return false;
        return true;
      }),
    [llmConsumption, llmProviderFilter, llmModelFilter],
  );

  const filteredMcpToolConsumption = useMemo(
    () => mcpToolConsumption.filter((item) => filteredToolConsumption.some((tool) => tool.type === item.type)),
    [mcpToolConsumption, filteredToolConsumption],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-slate-100">Dashboard</h2>
        <Link to="/playground" className="btn-primary">Abrir Playground</Link>
      </div>
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-300">
        Os cards por time mostram recursos do proprio time (nao repetem itens globais), para evitar leitura inflada.
      </div>

      <div className="panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-300">Filtros de visibilidade</div>
        <div className="grid gap-2 md:grid-cols-3">
          {user?.role === "ADMIN" ? (
            <select className="input-dark" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
              <option value="ALL">Todos os times</option>
              {cards.map((card) => (
                <option key={card.teamId} value={card.teamId}>
                  {card.teamKey} - {card.teamName}
                </option>
              ))}
            </select>
          ) : (
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">Escopo de time definido pelo seu perfil.</div>
          )}
          <select className="input-dark" value={llmProviderFilter} onChange={(e) => { setLlmProviderFilter(e.target.value); setLlmModelFilter("ALL"); }}>
            <option value="ALL">Todos os providers LLM</option>
            {llmProviders.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
          <select className="input-dark" value={llmModelFilter} onChange={(e) => setLlmModelFilter(e.target.value)}>
            <option value="ALL">Todos os modelos LLM</option>
            {llmModels.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {filteredCards.map((card) => (
          <div key={card.teamId} className="panel p-4">
            <div className="text-xs uppercase tracking-wider text-indigo-300">{card.teamKey}</div>
            <div className="text-sm font-semibold text-slate-100">{card.teamName}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2"><div className="text-base font-bold text-slate-100">{card.agents}</div><div className="flex items-center justify-center gap-1 text-slate-400">Agents <HelpTip text="Quantidade de agentes pertencentes a este time." /></div></div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2"><div className="text-base font-bold text-slate-100">{card.tools}</div><div className="flex items-center justify-center gap-1 text-slate-400">Tools <HelpTip text="Quantidade de tools criadas neste time (escopo proprio)." /></div></div>
              <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2"><div className="text-base font-bold text-slate-100">{card.routes}</div><div className="flex items-center justify-center gap-1 text-slate-400">Routes <HelpTip text="Regras de roteamento com ownerTeamId deste time." /></div></div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Simulacoes Totais <HelpTip text="Quantidade total de execucoes do playground registradas em auditoria." /></div><div className="mt-1 text-2xl font-bold text-slate-100">{summary.totalSimulations}</div></div>
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Simulacoes (24h) <HelpTip text="Execucoes do playground nas ultimas 24 horas." /></div><div className="mt-1 text-2xl font-bold text-slate-100">{summary.simulationsLast24h}</div></div>
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Eventos de Policy Negados (24h) <HelpTip text="Acoes bloqueadas por RBAC/SoD ou validacao de seguranca nas ultimas 24h." /></div><div className="mt-1 text-2xl font-bold text-rose-300">{summary.deniedEventsLast24h}</div></div>
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Eventos de Auditoria (24h) <HelpTip text="Total de eventos escritos na trilha de auditoria nas ultimas 24h." /></div><div className="mt-1 text-2xl font-bold text-slate-100">{summary.auditEventsLast24h}</div></div>
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Assign de Tools Write <HelpTip text="Quantidade de atribuicoes de permissao write para ferramentas." /></div><div className="mt-1 text-2xl font-bold text-amber-300">{summary.writeToolAssignments}</div></div>
        <div className="panel p-4"><div className="flex items-center gap-1 text-xs text-slate-400">Capacidade Configurada (req/min) <HelpTip text="Soma do rate limit por minuto de todas as tools visiveis." /></div><div className="mt-1 text-2xl font-bold text-emerald-300">{summary.configuredToolCapacityPerMin}</div></div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Uso dos Agents</div>
          <div className="space-y-2 text-xs">
            {filteredAgentUsage.length ? filteredAgentUsage.map((item) => (
              <div key={item.agentId} className="rounded-lg border border-slate-700 bg-slate-900/35 p-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-100">{item.agentName}</div>
                  <div className="text-indigo-300">{item.runs} runs</div>
                </div>
                <div className="mt-1 text-slate-400">{item.type} | {item.teamKey} | confianca media {(item.avgConfidence * 100).toFixed(1)}%</div>
              </div>
            )) : <div className="text-slate-400">Sem dados de uso para o filtro aplicado.</div>}
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Consumo Diario (7 dias)</div>
          <div className="space-y-2 text-xs">
            {dailyConsumption.map((item) => (
              <div key={item.date}>
                <div className="mb-1 flex items-center justify-between text-slate-400"><span>{item.date.slice(5)}</span><span>{item.simulations} sim | {item.deniedEvents} denied</span></div>
                <div className="h-2 rounded bg-slate-800">
                  <div className="h-2 rounded bg-indigo-500" style={{ width: `${(item.simulations / maxDaily) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="mb-3 flex items-center gap-1 text-sm font-semibold text-slate-100">Consumo por LLM <HelpTip text="Uso agregado por modelo. Conta simulacoes e chats registrados na auditoria." /></div>
          <div className="space-y-2 text-xs">
            {filteredLlmConsumption.length ? filteredLlmConsumption.map((item) => (
              <div key={item.modelId} className="rounded-lg border border-slate-700 bg-slate-900/35 p-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-100">{item.modelId}</div>
                  <div className="text-indigo-300">{item.total} total</div>
                </div>
                <div className="mt-1 text-slate-400">simulacoes: {item.simulations} | chat: {item.chats}</div>
              </div>
            )) : <div className="text-slate-400">Sem dados de LLM para o filtro aplicado.</div>}
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex items-center gap-1 text-sm font-semibold text-slate-100">Consumo por MCP/Tool Type <HelpTip text="Agrupamento por tipo de integracao (ex.: jira, slack, http, internal)." /></div>
          <div className="space-y-2 text-xs">
            {filteredMcpToolConsumption.length ? filteredMcpToolConsumption.map((item) => (
              <div key={item.type} className="rounded-lg border border-slate-700 bg-slate-900/35 p-2">
                <div className="flex items-center justify-between">
                  <div className="font-semibold text-slate-100">{item.type}</div>
                  <div className="text-indigo-300">{item.assignments} assigns</div>
                </div>
                <div className="mt-1 text-slate-400">tools: {item.tools} | linked agents: {item.linkedAgents} | write assigns: {item.writeAssignments} | rate limit: {item.totalRateLimitPerMinute}/min</div>
              </div>
            )) : <div className="text-slate-400">Sem dados de MCP/Tool para o filtro aplicado.</div>}
          </div>
        </div>
      </div>

      <div className="panel p-4">
        <div className="mb-3 text-sm font-semibold text-slate-100">Consumo de Tools</div>
        <div className="overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-2">Tool</th>
                <th className="py-2">Team</th>
                <th className="py-2">Policy</th>
                <th className="py-2">Linked Agents</th>
                <th className="py-2">Assignments</th>
                <th className="py-2">Write Assign</th>
                <th className="py-2">Rate Limit</th>
              </tr>
            </thead>
            <tbody>
              {filteredToolConsumption.map((tool) => (
                <tr key={tool.toolId} className="border-t border-slate-700/70 text-slate-300">
                  <td className="py-2 font-semibold text-slate-100">{tool.toolName}</td>
                  <td className="py-2">{tool.teamKey}</td>
                  <td className="py-2">{tool.policy}</td>
                  <td className="py-2">{tool.linkedAgents}</td>
                  <td className="py-2">{tool.assignments}</td>
                  <td className="py-2">{tool.writeAssignments}</td>
                  <td className="py-2">{tool.rateLimitPerMinute}/min</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="text-sm font-semibold text-slate-200">Import Config JSON</h3>
        <textarea className="input-dark mt-2 h-36 font-mono text-xs" value={importPayload} onChange={(e) => setImportPayload(e.target.value)} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-ghost" onClick={() => void importJson()}>Import</button>
          {status ? <span className="text-xs text-emerald-300">{status}</span> : null}
        </div>
      </div>
    </div>
  );
}
