import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import type { Agent, AgentChatMeta, RoutingRule, Team } from "../lib/types";
import { HelpTip } from "../components/HelpTip";

type SimResponse = {
  chosenTeam: { id: string; key: string; name: string } | null;
  chosenAgent: { id: string; name: string; type: string } | null;
  confidence: number;
  justification: string[];
  top3: Array<{ agentId: string; agentName: string; score: number; reason: string }>;
  graphPath: string[];
  usedSources: Array<{ id: string; name: string; url: string }>;
};

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  content: string;
  reasoningSummary?: string[];
  meta?: AgentChatMeta;
};

type AgnoAdvanced = {
  modelProvider: "ollama" | "openrouter" | "vertexai";
  modelId: string;
  temperature: number;
  maxTokens: number;
  reasoning: boolean;
  reasoningMinSteps: number;
  reasoningMaxSteps: number;
  addHistoryToContext: boolean;
  historySessions: number;
  addStateToContext: boolean;
  markdown: boolean;
  showToolCalls: boolean;
};

type AgnoModelsResponse = {
  providers: Array<{
    id: "ollama" | "openrouter" | "vertexai";
    label: string;
    defaultModel: string;
    models: string[];
    source: "runtime" | "fallback";
  }>;
};

type ModelProviderId = AgnoAdvanced["modelProvider"];

type MessageBlock =
  | { type: "code"; content: string; language: string | null }
  | { type: "text"; content: string };

const FALLBACK_MODEL_OPTIONS: Record<ModelProviderId, string[]> = {
  ollama: ["qwen2.5:3b"],
  openrouter: ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"],
  vertexai: ["gemini-2.5-flash"],
};

const ADVANCED_STORAGE_KEY = "playground.advanced.v1";

const DEFAULT_ADVANCED: AgnoAdvanced = {
  modelProvider: "ollama",
  modelId: "qwen2.5:3b",
  temperature: 0.2,
  maxTokens: 512,
  reasoning: false,
  reasoningMinSteps: 1,
  reasoningMaxSteps: 6,
  addHistoryToContext: false,
  historySessions: 1,
  addStateToContext: false,
  markdown: true,
  showToolCalls: false,
};

function tryExtractWrappedReply(content: string): string {
  const text = content.trim();
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenceMatch ? fenceMatch[1].trim() : text;
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return content;
  try {
    const parsed = JSON.parse(candidate) as { reply?: unknown };
    return typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply : content;
  } catch {
    return content;
  }
}

function splitMessageBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const pattern = /```([a-z0-9_-]+)?\n?([\s\S]*?)```/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }
    blocks.push({
      type: "code",
      language: match[1] || null,
      content: match[2].trim(),
    });
    lastIndex = pattern.lastIndex;
    match = pattern.exec(content);
  }
  if (lastIndex < content.length) {
    blocks.push({ type: "text", content: content.slice(lastIndex) });
  }
  return blocks.filter((block) => block.content.trim());
}

function renderTextBlock(content: string) {
  return content
    .trim()
    .split(/\n{2,}/)
    .map((paragraph, idx) => {
      const lines = paragraph.split("\n").map((line) => line.trimEnd());
      const first = lines[0]?.trim() || "";
      if (first.startsWith("## ")) {
        return (
          <div key={`heading-${idx}`} className="space-y-2">
            <div className="text-sm font-semibold text-slate-100">{first.replace(/^##\s+/, "")}</div>
            {lines.slice(1).some((line) => line.trim()) ? (
              <div className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">{lines.slice(1).join("\n").trim()}</div>
            ) : null}
          </div>
        );
      }
      if (lines.every((line) => !line.trim() || line.trim().startsWith("- ") || /^\d+\.\s/.test(line.trim()))) {
        return (
          <div key={`list-${idx}`} className="space-y-1">
            {lines.filter((line) => line.trim()).map((line, lineIdx) => (
              <div key={`list-${idx}-${lineIdx}`} className="whitespace-pre-wrap break-words pl-3 text-xs leading-6 text-slate-200">
                {line.trim()}
              </div>
            ))}
          </div>
        );
      }
      return (
        <div key={`paragraph-${idx}`} className="whitespace-pre-wrap break-words text-xs leading-6 text-slate-200">
          {paragraph.trim()}
        </div>
      );
    });
}

function AgentMessageBody({ content }: { content: string }) {
  const normalized = tryExtractWrappedReply(content);
  const blocks = splitMessageBlocks(normalized);
  return (
    <div className="space-y-3">
      {blocks.map((block, idx) =>
        block.type === "code" ? (
          <div key={`code-${idx}`} className="overflow-x-auto rounded-md border border-slate-700 bg-slate-950/80">
            <div className="border-b border-slate-800 px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">{block.language || "text"}</div>
            <pre className="whitespace-pre-wrap break-words p-3 text-[11px] leading-6 text-emerald-100">{block.content}</pre>
          </div>
        ) : (
          <div key={`text-${idx}`} className="space-y-3">
            {renderTextBlock(block.content)}
          </div>
        ),
      )}
    </div>
  );
}

function readStoredAdvanced(): AgnoAdvanced | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ADVANCED_STORAGE_KEY);
    if (!raw) return null;
    return { ...DEFAULT_ADVANCED, ...(JSON.parse(raw) as Partial<AgnoAdvanced>) };
  } catch {
    return null;
  }
}

function inferProviderFromModelId(modelId?: string | null): ModelProviderId {
  const normalized = (modelId || "").trim().toLowerCase();
  if (!normalized) return "ollama";
  if (normalized.startsWith("gemini")) return "vertexai";
  if (normalized.startsWith("openai/") || normalized.startsWith("anthropic/") || normalized.startsWith("google/") || normalized.startsWith("meta-llama/")) return "openrouter";
  return "ollama";
}

function normalizeAdvanced(state: AgnoAdvanced, options: Record<ModelProviderId, string[]>): AgnoAdvanced {
  const providerModels = options[state.modelProvider] || [];
  if (!providerModels.length || providerModels.includes(state.modelId)) return state;
  return { ...state, modelId: providerModels[0] || state.modelId };
}

function buildAgentDefaultAdvanced(agent: Agent | null, options: Record<ModelProviderId, string[]>): AgnoAdvanced {
  if (!agent) return normalizeAdvanced(DEFAULT_ADVANCED, options);
  const provider = inferProviderFromModelId(agent.primaryModel);
  const providerModels = options[provider] || [];
  const modelId = agent.primaryModel?.trim() || providerModels[0] || DEFAULT_ADVANCED.modelId;
  return normalizeAdvanced(
    {
      ...DEFAULT_ADVANCED,
      modelProvider: provider,
      modelId,
      reasoning: Boolean(agent.reasoningEnabled),
      addHistoryToContext: agent.addHistoryContext ?? DEFAULT_ADVANCED.addHistoryToContext,
      historySessions: agent.historySessions ?? DEFAULT_ADVANCED.historySessions,
      addStateToContext: agent.addStateContext ?? DEFAULT_ADVANCED.addStateToContext,
      temperature: agent.temperature ?? DEFAULT_ADVANCED.temperature,
      maxTokens: agent.maxTokens ?? DEFAULT_ADVANCED.maxTokens,
    },
    options,
  );
}

export function SimulatorPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [message, setMessage] = useState("Need to revoke cloud admin access for contractor and open a ticket.");
  const [result, setResult] = useState<SimResponse | null>(null);
  const [error, setError] = useState("");

  const [ruleName, setRuleName] = useState("Quick rule");
  const [ruleOwnerTeamId, setRuleOwnerTeamId] = useState("");
  const [ruleTargetAgentId, setRuleTargetAgentId] = useState("");
  const [ruleKeywords, setRuleKeywords] = useState("iam,access,identity");
  const [chatAgentId, setChatAgentId] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatBusy, setChatBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showRoutingRules, setShowRoutingRules] = useState(false);
  const [modelOptions, setModelOptions] = useState<Record<ModelProviderId, string[]>>(FALLBACK_MODEL_OPTIONS);
  const [advancedOverrideEnabled, setAdvancedOverrideEnabled] = useState(() => Boolean(readStoredAdvanced()));
  const [advanced, setAdvanced] = useState<AgnoAdvanced>(() => readStoredAdvanced() || DEFAULT_ADVANCED);

  const updateAdvanced = (updater: (state: AgnoAdvanced) => AgnoAdvanced) => {
    setAdvanced((state) => {
      const next = updater(state);
      return normalizeAdvanced(next, modelOptions);
    });
    setAdvancedOverrideEnabled(true);
  };

  const loadRules = async () => {
    const [teamRes, ruleRes, agentRes, modelRes] = await Promise.all([
      apiGet<{ teams: Team[] }>("/api/teams"),
      apiGet<{ rules: RoutingRule[] }>("/api/routing-rules"),
      apiGet<{ agents: Agent[] }>("/api/agents"),
      apiGet<AgnoModelsResponse>("/api/agno/models").catch(() => null),
    ]);
    setTeams(teamRes.teams);
    setRules(ruleRes.rules);
    setAgents(agentRes.agents);
    if (modelRes?.providers?.length) {
      const nextOptions: Record<ModelProviderId, string[]> = {
        ollama: modelRes.providers.find((provider) => provider.id === "ollama")?.models || FALLBACK_MODEL_OPTIONS.ollama,
        openrouter: modelRes.providers.find((provider) => provider.id === "openrouter")?.models || FALLBACK_MODEL_OPTIONS.openrouter,
        vertexai: modelRes.providers.find((provider) => provider.id === "vertexai")?.models || FALLBACK_MODEL_OPTIONS.vertexai,
      };
      setModelOptions(nextOptions);
      setAdvanced((state) => normalizeAdvanced(state, nextOptions));
    }
    if (!ruleOwnerTeamId && teamRes.teams[0]) setRuleOwnerTeamId(teamRes.teams[0].id);
    if (!ruleTargetAgentId && agentRes.agents[0]) setRuleTargetAgentId(agentRes.agents[0].id);
    if (!chatAgentId && agentRes.agents[0]) setChatAgentId(agentRes.agents[0].id);
  };

  useEffect(() => {
    void loadRules();
  }, []);

  useEffect(() => {
    const selectedAgent = agents.find((agent) => agent.id === chatAgentId) || agents[0] || null;
    if (!advancedOverrideEnabled) {
      setAdvanced(buildAgentDefaultAdvanced(selectedAgent, modelOptions));
      return;
    }
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ADVANCED_STORAGE_KEY, JSON.stringify(advanced));
    }
  }, [advanced, advancedOverrideEnabled, agents, chatAgentId, modelOptions]);

  const selectedChatAgent = agents.find((agent) => agent.id === chatAgentId) || null;

  const clearAdvancedOverride = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ADVANCED_STORAGE_KEY);
    }
    setAdvancedOverrideEnabled(false);
    setAdvanced(buildAgentDefaultAdvanced(selectedChatAgent, modelOptions));
  };

  const run = async () => {
    setError("");
    try {
      const res = await apiPost<SimResponse>("/api/simulator/run", {
        message,
        advanced,
      });
      setResult(res);
      localStorage.setItem("playground.lastPath", JSON.stringify(res.graphPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Playground execution failed");
    }
  };

  const createRule = async () => {
    await apiPost("/api/routing-rules", {
      name: ruleName,
      ownerTeamId: ruleOwnerTeamId || null,
      targetAgentId: ruleTargetAgentId,
      fallbackAgentId: null,
      keywords: ruleKeywords.split(",").map((item) => item.trim()).filter(Boolean),
      tags: [],
      minScore: 0.2,
    });
    await loadRules();
  };

  const sendChat = async () => {
    const selectedAgent = agents.find((a) => a.id === chatAgentId);
    const text = chatInput.trim();
    if (!selectedAgent || !text || chatBusy) return;

    const userMsg: ChatMessage = { id: `${Date.now()}-u`, role: "user", content: text };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatBusy(true);
    try {
      const response = await apiPost<{ reply: string; reasoningSummary?: string[]; meta?: AgentChatMeta }>("/api/agno/chat", {
        message: text,
        agentId: selectedAgent.id,
        history: [...chatMessages, userMsg].map((m) => ({ role: m.role, content: m.content })),
        advanced,
      });
      const agentMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "agent",
        content: response.reply,
        reasoningSummary: response.reasoningSummary || [],
        meta: response.meta,
      };
      setChatMessages((prev) => [...prev, agentMsg]);
    } catch (err) {
      const agentMsg: ChatMessage = {
        id: `${Date.now()}-a`,
        role: "agent",
        content: err instanceof Error ? `Erro no Agno: ${err.message}` : "Erro no Agno",
        reasoningSummary: ["Nao foi possivel gerar o resumo da decisao nesta tentativa."],
      };
      setChatMessages((prev) => [...prev, agentMsg]);
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-100">Playground</h2>
      <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-3 text-xs text-slate-300">
        Use esta tela primeiro para testar agentes e ver como respondem. Ajustes de runtime e roteamento ficam recolhidos para nao poluir o fluxo principal.
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Chat com agente</h3>
          {result?.chosenAgent?.id ? (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setChatAgentId(result.chosenAgent!.id)}>
              Usar agente roteado
            </button>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-2 text-xs text-slate-300">
          Execucao atual: <span className="font-semibold text-slate-100">{advanced.modelProvider}</span> / <span className="font-semibold text-slate-100">{advanced.modelId}</span> | origem: <span className="font-semibold text-slate-100">{advancedOverrideEnabled ? "override local do Playground" : (selectedChatAgent ? `padrao do agente ${selectedChatAgent.name}` : "padrao global")}</span>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <select className="input-dark md:col-span-1" value={chatAgentId} onChange={(e) => setChatAgentId(e.target.value)}>
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name} ({agent.type})</option>
            ))}
          </select>
          <input
            className="input-dark md:col-span-2"
            value={chatInput}
            placeholder="Digite uma mensagem para testar o agente selecionado"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendChat();
            }}
          />
          <button className="btn-primary md:col-span-1" disabled={chatBusy} onClick={() => void sendChat()}>{chatBusy ? "..." : "Enviar"}</button>
        </div>
        <div className="max-h-[32rem] space-y-2 overflow-auto rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-xs">
          {!chatMessages.length ? <div className="text-slate-400">Sem conversa ainda. Selecione um agente e envie a primeira mensagem.</div> : null}
          {chatMessages.map((m) => (
            <div key={m.id} className={`rounded-lg border px-3 py-2 ${m.role === "user" ? "border-slate-600 bg-slate-800 text-slate-200" : "border-indigo-500/40 bg-indigo-500/10 text-indigo-100"}`}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{m.role === "user" ? "Voce" : "Agente"}</div>
              {m.role === "agent" ? <AgentMessageBody content={m.content} /> : <div className="whitespace-pre-wrap break-words text-xs leading-6">{m.content}</div>}
              {m.role === "agent" && m.meta?.degraded ? (
                <div className="mt-2 rounded border border-amber-400/30 bg-amber-500/10 p-2 text-[11px] text-amber-100">
                  Runtime em modo degradado. {m.meta.agnoError || "Falha no runtime Agno; resposta fallback usada."}
                </div>
              ) : null}
              {m.role === "agent" && m.reasoningSummary?.length ? (
                <details className="mt-2 rounded border border-indigo-400/30 bg-slate-900/40 p-2">
                  <summary className="cursor-pointer text-[11px] font-semibold text-indigo-200">Como chegou nessa resposta</summary>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] text-slate-300">
                    {m.reasoningSummary.map((item, idx) => (
                      <li key={`${m.id}-reason-${idx}`}>{item}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="panel space-y-3 p-4">
        <button className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-100" onClick={() => setShowAdvanced((state) => !state)}>
          <span className="flex items-center gap-1">Configuracao avancada do Agno <HelpTip text="Parametros enviados para o runtime Agno/Ollama durante simulacao e chat." /></span>
          <span className="text-xs text-slate-400">{showAdvanced ? "Ocultar" : "Mostrar"}</span>
        </button>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost px-2 py-1 text-xs" onClick={clearAdvancedOverride}>Usar padrao do agente</button>
          <div className="rounded-md border border-slate-700 bg-slate-900/35 px-2 py-1 text-[11px] text-slate-300">A configuracao avancada agora fica salva neste navegador.</div>
        </div>
        {showAdvanced ? <div className="grid gap-2 md:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">modelProvider <HelpTip text="Escolhe o backend de LLM. OpenRouter usa a API compativel com OpenAI e lista modelos da propria OpenRouter. Vertex AI usa credencial Google no agno_service." /></div>
            <select
              className="input-dark"
              value={advanced.modelProvider}
              onChange={(e) =>
                updateAdvanced((s) => ({
                  ...s,
                  modelProvider: e.target.value as ModelProviderId,
                  modelId: modelOptions[e.target.value as ModelProviderId]?.[0] || FALLBACK_MODEL_OPTIONS[e.target.value as ModelProviderId]?.[0] || s.modelId,
                }))
              }
            >
              <option value="ollama">ollama (local)</option>
              <option value="openrouter">openrouter (API)</option>
              <option value="vertexai">vertexai (Google Cloud)</option>
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">modelId <HelpTip text="Lista de modelos disponiveis para o provider selecionado, carregada do runtime Agno com fallback quando necessario." /></div>
            <select className="input-dark" value={advanced.modelId} onChange={(e) => updateAdvanced((s) => ({ ...s, modelId: e.target.value }))}>
              {(modelOptions[advanced.modelProvider] || [advanced.modelId]).map((modelId) => (
                <option key={modelId} value={modelId}>{modelId}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">temperature <HelpTip text="Controla variacao da resposta. Menor = mais deterministico." /></div>
            <input className="input-dark" type="number" step="0.1" min={0} max={2} value={advanced.temperature} onChange={(e) => updateAdvanced((s) => ({ ...s, temperature: Number(e.target.value) || 0 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">maxTokens <HelpTip text="Limite maximo de tokens na resposta gerada." /></div>
            <input className="input-dark" type="number" min={64} max={8192} value={advanced.maxTokens} onChange={(e) => updateAdvanced((s) => ({ ...s, maxTokens: Number(e.target.value) || 1024 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">historySessions <HelpTip text="Quantidade de interacoes anteriores adicionadas ao contexto." /></div>
            <input className="input-dark" type="number" min={1} max={20} value={advanced.historySessions} onChange={(e) => updateAdvanced((s) => ({ ...s, historySessions: Number(e.target.value) || 3 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">reasoningMinSteps <HelpTip text="Passos minimos de raciocinio interno quando habilitado." /></div>
            <input className="input-dark" type="number" min={1} max={20} value={advanced.reasoningMinSteps} onChange={(e) => updateAdvanced((s) => ({ ...s, reasoningMinSteps: Number(e.target.value) || 1 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">reasoningMaxSteps <HelpTip text="Passos maximos de raciocinio interno quando habilitado." /></div>
            <input className="input-dark" type="number" min={1} max={40} value={advanced.reasoningMaxSteps} onChange={(e) => updateAdvanced((s) => ({ ...s, reasoningMaxSteps: Number(e.target.value) || 6 }))} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.reasoning} onChange={(e) => updateAdvanced((s) => ({ ...s, reasoning: e.target.checked }))} />reasoning <HelpTip text="Ativa modo de raciocinio interno do modelo." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.addHistoryToContext} onChange={(e) => updateAdvanced((s) => ({ ...s, addHistoryToContext: e.target.checked }))} />add_history_to_context <HelpTip text="Inclui historico de conversa no prompt." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.addStateToContext} onChange={(e) => updateAdvanced((s) => ({ ...s, addStateToContext: e.target.checked }))} />add_session_state_to_context <HelpTip text="Inclui estado de sessao para continuidade entre chamadas." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.markdown} onChange={(e) => updateAdvanced((s) => ({ ...s, markdown: e.target.checked }))} />markdown <HelpTip text="Permite resposta formatada em markdown." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.showToolCalls} onChange={(e) => updateAdvanced((s) => ({ ...s, showToolCalls: e.target.checked }))} />show_tool_calls <HelpTip text="Exibe chamadas de tools no retorno quando suportado." /></label>
        </div> : null}
      </div>

      {result && showDiagnostics ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4 text-sm text-slate-300">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Diagnostico de roteamento</h3>
            <p>Team: <b className="text-slate-100">{result.chosenTeam?.name || "N/A"}</b></p>
            <p>Agent: <b className="text-slate-100">{result.chosenAgent?.name || "N/A"}</b></p>
            <p>Confidence: <b className="text-slate-100">{(result.confidence * 100).toFixed(1)}%</b></p>
            <div className="mt-2 text-xs text-slate-400">Justification</div>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-slate-300">{result.justification.map((item) => <li key={item}>{item}</li>)}</ul>
            <div className="mt-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 p-2 text-xs text-indigo-200">
              Highlight path on graph: {result.graphPath.join(" -> ")}
            </div>
          </div>

          <div className="panel p-4 text-sm text-slate-300">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Top 3 Ranking</h3>
            <div className="space-y-2">
              {result.top3.map((item) => (
                <div key={item.agentId} className="rounded-lg border border-slate-700 bg-slate-900/40 p-2 text-xs">
                  <div className="font-semibold text-slate-100">{item.agentName}</div>
                  <div>score: {item.score.toFixed(3)}</div>
                  <div className="text-slate-400">{item.reason}</div>
                </div>
              ))}
            </div>
            <h4 className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400">Sources</h4>
            <div className="mt-1 space-y-1 text-xs">
              {result.usedSources.length ? result.usedSources.map((source) => <div key={source.id} className="truncate">{source.name} - {source.url}</div>) : <div className="text-slate-400">None</div>}
            </div>
          </div>
        </div>
      ) : null}

      <div className="panel space-y-3 p-4">
        <div className="text-sm font-semibold text-slate-100">Teste rapido de roteamento</div>
        <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-2 text-xs text-slate-300">
          O roteamento usa apenas a mensagem e avalia regras, contexto e politicas no backend. Nao ha sugestao manual de time nesta execucao.
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400">Mensagem de entrada <HelpTip text="Texto usado para classificar o caso e escolher time/agente." /></div>
        <textarea className="input-dark h-40" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={() => void run()}>Executar</button>
          <button className="btn-ghost" onClick={() => setShowDiagnostics((state) => !state)}>{showDiagnostics ? "Ocultar diagnostico" : "Mostrar diagnostico"}</button>
          <Link to="/graph" className="btn-ghost">Abrir grafo</Link>
        </div>
        {error ? <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</div> : null}
      </div>

      <div className="panel space-y-3 p-4">
        <button className="flex w-full items-center justify-between text-left text-sm font-semibold text-slate-100" onClick={() => setShowRoutingRules((state) => !state)}>
          <span className="flex items-center gap-1">Regras de roteamento <HelpTip text="Define para qual agente o backend deve encaminhar pedidos com base em keywords/tags." /></span>
          <span className="text-xs text-slate-400">{showRoutingRules ? "Ocultar" : "Mostrar"}</span>
        </button>
        {showRoutingRules ? (
          <>
            <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2 text-xs text-slate-300">
              Use esta area apenas quando precisar testar roteamento manual. Para o fluxo comum, basta testar o agente no chat acima.
            </div>
            <div className="grid gap-2 md:grid-cols-4">
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">rule name <HelpTip text="Nome amigavel para identificar a regra." /></div>
                <input className="input-dark" value={ruleName} onChange={(e) => setRuleName(e.target.value)} placeholder="rule name" />
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">owner team <HelpTip text="Time dono da regra. Restringe escopo de governanca." /></div>
                <select className="input-dark" value={ruleOwnerTeamId} onChange={(e) => setRuleOwnerTeamId(e.target.value)}>{teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}</select>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">target agent <HelpTip text="Agente que deve receber prioridade quando a regra casar." /></div>
                <select className="input-dark" value={ruleTargetAgentId} onChange={(e) => setRuleTargetAgentId(e.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">keywords csv <HelpTip text="Palavras que ativam a regra. Separar por virgula." /></div>
                <input className="input-dark" value={ruleKeywords} onChange={(e) => setRuleKeywords(e.target.value)} placeholder="keywords csv" />
              </div>
              <button className="btn-ghost" onClick={() => void createRule()}>Create Rule</button>
            </div>
            <div className="space-y-1 text-xs text-slate-300">
              {rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-slate-700 bg-slate-900/30 p-2">
                  {rule.name} {"->"} {agents.find((agent) => agent.id === rule.targetAgentId)?.name || rule.targetAgentId} | keywords: {(rule.keywords || []).join(", ")}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
