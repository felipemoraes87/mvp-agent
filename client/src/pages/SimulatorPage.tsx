import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../lib/api";
import type { Agent, RoutingRule, Team } from "../lib/types";
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
};

type AgnoAdvanced = {
  modelProvider: "ollama" | "openai";
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

export function SimulatorPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [message, setMessage] = useState("Need to revoke cloud admin access for contractor and open a ticket.");
  const [suggestedTeamId, setSuggestedTeamId] = useState("");
  const [contextTags, setContextTags] = useState("iam,cloud");
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

  const [advanced, setAdvanced] = useState<AgnoAdvanced>({
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
  });

  const loadRules = async () => {
    const [teamRes, ruleRes, agentRes] = await Promise.all([
      apiGet<{ teams: Team[] }>("/api/teams"),
      apiGet<{ rules: RoutingRule[] }>("/api/routing-rules"),
      apiGet<{ agents: Agent[] }>("/api/agents"),
    ]);
    setTeams(teamRes.teams);
    setRules(ruleRes.rules);
    setAgents(agentRes.agents);
    if (!ruleOwnerTeamId && teamRes.teams[0]) setRuleOwnerTeamId(teamRes.teams[0].id);
    if (!ruleTargetAgentId && agentRes.agents[0]) setRuleTargetAgentId(agentRes.agents[0].id);
    if (!chatAgentId && agentRes.agents[0]) setChatAgentId(agentRes.agents[0].id);
  };

  useEffect(() => {
    void loadRules();
  }, []);

  const run = async () => {
    setError("");
    try {
      const res = await apiPost<SimResponse>("/api/simulator/run", {
        message,
        suggestedTeamId: suggestedTeamId || undefined,
        contextTags: contextTags.split(",").map((item) => item.trim()).filter(Boolean),
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
      const response = await apiPost<{ reply: string; reasoningSummary?: string[] }>("/api/agno/chat", {
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
        Fluxo esperado: Global Supervisor acolhe e confirma entendimento {"->"} Specialist aprofunda e orienta {"->"} Ticket Agent so avanca com chamado quando a documentacao e dados obrigatorios estiverem completos.
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex items-center gap-1 text-xs text-slate-400">Mensagem de entrada <HelpTip text="Texto usado para classificar o caso e escolher time/agente." /></div>
        <textarea className="input-dark h-40" value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="grid gap-2 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Suggested team <HelpTip text="Opcional. Ajuda a priorizar um time, mas o roteador ainda pode escolher outro." /></div>
          <select className="input-dark" value={suggestedTeamId} onChange={(e) => setSuggestedTeamId(e.target.value)}>
            <option value="">Suggested team (optional)</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
          </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Context tags <HelpTip text="Tags auxiliares para reforcar contexto no roteamento. Use CSV." /></div>
          <input className="input-dark" placeholder="context tags csv" value={contextTags} onChange={(e) => setContextTags(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary" onClick={() => void run()}>Run Playground</button>
          <Link to="/graph" className="btn-ghost">Open Graph</Link>
        </div>
        {error ? <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">{error}</div> : null}
      </div>

      <div className="panel space-y-3 p-4">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-slate-100">Agno Advanced Settings <HelpTip text="Parametros enviados para o runtime Agno/Ollama durante simulacao e chat." /></h3>
        <div className="grid gap-2 md:grid-cols-4">
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">modelProvider <HelpTip text="Escolhe o backend de LLM. OpenAI exige OPENAI_API_KEY no agno_service." /></div>
            <select
              className="input-dark"
              value={advanced.modelProvider}
              onChange={(e) =>
                setAdvanced((s) => ({
                  ...s,
                  modelProvider: e.target.value as "ollama" | "openai",
                  modelId: e.target.value === "openai" ? "gpt-4o-mini" : "qwen2.5:3b",
                }))
              }
            >
              <option value="ollama">ollama (local)</option>
              <option value="openai">openai (API)</option>
            </select>
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">modelId <HelpTip text="ID do modelo no provider selecionado. Ex.: qwen2.5:3b (ollama), gpt-4o-mini (openai)." /></div>
            <input className="input-dark" value={advanced.modelId} onChange={(e) => setAdvanced((s) => ({ ...s, modelId: e.target.value }))} placeholder="model id" />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">temperature <HelpTip text="Controla variacao da resposta. Menor = mais deterministico." /></div>
            <input className="input-dark" type="number" step="0.1" min={0} max={2} value={advanced.temperature} onChange={(e) => setAdvanced((s) => ({ ...s, temperature: Number(e.target.value) || 0 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">maxTokens <HelpTip text="Limite maximo de tokens na resposta gerada." /></div>
            <input className="input-dark" type="number" min={64} max={8192} value={advanced.maxTokens} onChange={(e) => setAdvanced((s) => ({ ...s, maxTokens: Number(e.target.value) || 1024 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">historySessions <HelpTip text="Quantidade de interacoes anteriores adicionadas ao contexto." /></div>
            <input className="input-dark" type="number" min={1} max={20} value={advanced.historySessions} onChange={(e) => setAdvanced((s) => ({ ...s, historySessions: Number(e.target.value) || 3 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">reasoningMinSteps <HelpTip text="Passos minimos de raciocinio interno quando habilitado." /></div>
            <input className="input-dark" type="number" min={1} max={20} value={advanced.reasoningMinSteps} onChange={(e) => setAdvanced((s) => ({ ...s, reasoningMinSteps: Number(e.target.value) || 1 }))} />
          </div>
          <div>
            <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">reasoningMaxSteps <HelpTip text="Passos maximos de raciocinio interno quando habilitado." /></div>
            <input className="input-dark" type="number" min={1} max={40} value={advanced.reasoningMaxSteps} onChange={(e) => setAdvanced((s) => ({ ...s, reasoningMaxSteps: Number(e.target.value) || 6 }))} />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.reasoning} onChange={(e) => setAdvanced((s) => ({ ...s, reasoning: e.target.checked }))} />reasoning <HelpTip text="Ativa modo de raciocinio interno do modelo." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.addHistoryToContext} onChange={(e) => setAdvanced((s) => ({ ...s, addHistoryToContext: e.target.checked }))} />add_history_to_context <HelpTip text="Inclui historico de conversa no prompt." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.addStateToContext} onChange={(e) => setAdvanced((s) => ({ ...s, addStateToContext: e.target.checked }))} />add_session_state_to_context <HelpTip text="Inclui estado de sessao para continuidade entre chamadas." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.markdown} onChange={(e) => setAdvanced((s) => ({ ...s, markdown: e.target.checked }))} />markdown <HelpTip text="Permite resposta formatada em markdown." /></label>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={advanced.showToolCalls} onChange={(e) => setAdvanced((s) => ({ ...s, showToolCalls: e.target.checked }))} />show_tool_calls <HelpTip text="Exibe chamadas de tools no retorno quando suportado." /></label>
        </div>
      </div>

      {result ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="panel p-4 text-sm text-slate-300">
            <h3 className="mb-2 text-sm font-semibold text-slate-100">Outcome</h3>
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
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100">Agent Conversation Playground</h3>
          {result?.chosenAgent?.id ? (
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setChatAgentId(result.chosenAgent!.id)}>
              Use Routed Agent
            </button>
          ) : null}
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
            placeholder="Digite uma mensagem para simular conversa com o agente"
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void sendChat();
            }}
          />
          <button className="btn-primary md:col-span-1" disabled={chatBusy} onClick={() => void sendChat()}>{chatBusy ? "..." : "Send"}</button>
        </div>
        <div className="max-h-72 space-y-2 overflow-auto rounded-lg border border-slate-700 bg-slate-900/30 p-3 text-xs">
          {!chatMessages.length ? <div className="text-slate-400">Sem conversa ainda. Selecione um agente e envie a primeira mensagem.</div> : null}
          {chatMessages.map((m) => (
            <div key={m.id} className={`rounded-lg border px-3 py-2 ${m.role === "user" ? "border-slate-600 bg-slate-800 text-slate-200" : "border-indigo-500/40 bg-indigo-500/10 text-indigo-100"}`}>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{m.role === "user" ? "Voce" : "Agente"}</div>
              <div>{m.content}</div>
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
        <h3 className="flex items-center gap-1 text-sm font-semibold text-slate-100">Routing Rules <HelpTip text="Define para qual agente o backend deve encaminhar pedidos com base em keywords/tags." /></h3>
        <div className="rounded-lg border border-slate-700 bg-slate-900/40 p-2 text-xs text-slate-300">
          O que cria: uma regra de roteamento por time. Onde usa: em `POST /api/simulator/run`. Como aplica: se keywords/tags baterem e score minimo for atingido, o targetAgent recebe prioridade.
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
      </div>
    </div>
  );
}
