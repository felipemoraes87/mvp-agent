import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { AgentWithLinks, KnowledgeSource, Skill, Team, Tool } from "../lib/types";

type AgentTab = "summary" | "capabilities" | "behavior" | "governance";
type ModelProviderId = "ollama" | "openrouter" | "vertexai";
type AgnoModelsResponse = {
  providers: Array<{
    id: ModelProviderId;
    label: string;
    defaultModel: string;
    models: string[];
    source: "runtime" | "fallback";
  }>;
};

type AgentForm = {
  name: string;
  description: string;
  prompt: string;
  tagsCsv: string;
  type: "SUPERVISOR" | "SPECIALIST" | "TICKET";
  teamId: string;
  isGlobal: boolean;
  visibility: "private" | "shared";
  modelProvider: ModelProviderId;
  primaryModel: string;
  reasoningEnabled: boolean;
  addHistoryContext: boolean;
  knowledgeMode: "agentic" | "references" | "hybrid";
  runtimeConfigText: string;
  userCustomized: boolean;
  customizationNote: string;
};

const tabs: Array<{ id: AgentTab; label: string }> = [
  { id: "summary", label: "Resumo" },
  { id: "capabilities", label: "Capacidades" },
  { id: "behavior", label: "Comportamento" },
  { id: "governance", label: "Governanca" },
];

const FALLBACK_MODEL_OPTIONS: Record<ModelProviderId, string[]> = {
  ollama: ["qwen2.5:3b"],
  openrouter: ["openai/gpt-4o-mini", "openai/gpt-4.1-mini", "anthropic/claude-3.5-haiku", "google/gemini-2.0-flash-001"],
  vertexai: ["gemini-2.5-flash"],
};

function inferProviderFromModelId(modelId?: string | null): ModelProviderId {
  const normalized = (modelId || "").trim().toLowerCase();
  if (!normalized) return "ollama";
  if (normalized.startsWith("gemini")) return "vertexai";
  if (normalized.startsWith("openai/") || normalized.startsWith("anthropic/") || normalized.startsWith("google/") || normalized.startsWith("meta-llama/")) return "openrouter";
  return "ollama";
}

const emptyForm: AgentForm = {
  name: "",
  description: "",
  prompt: "",
  tagsCsv: "",
  type: "SPECIALIST",
  teamId: "",
  isGlobal: false,
  visibility: "private",
  modelProvider: "ollama",
  primaryModel: "",
  reasoningEnabled: false,
  addHistoryContext: true,
  knowledgeMode: "hybrid",
  runtimeConfigText: "",
  userCustomized: false,
  customizationNote: "",
};

function toForm(agent: AgentWithLinks): AgentForm {
  return {
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    tagsCsv: agent.tags.join(", "),
    type: agent.type,
    teamId: agent.teamId || "",
    isGlobal: agent.isGlobal,
    visibility: agent.visibility,
    modelProvider: inferProviderFromModelId(agent.primaryModel),
    primaryModel: agent.primaryModel || "",
    reasoningEnabled: Boolean(agent.reasoningEnabled),
    addHistoryContext: agent.addHistoryContext ?? true,
    knowledgeMode: agent.knowledgeMode || "hybrid",
    runtimeConfigText: agent.runtimeConfig ? JSON.stringify(agent.runtimeConfig, null, 2) : "",
    userCustomized: Boolean(agent.userCustomized),
    customizationNote: agent.customizationNote || "",
  };
}

function typeLabel(type: AgentWithLinks["type"]): string {
  if (type === "SUPERVISOR") return "Supervisor";
  if (type === "SPECIALIST") return "Especialista";
  return "Ticket";
}

export function AgentsPage() { // NOSONAR
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<AgentTab>("summary");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSource[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);
  const [modelOptions, setModelOptions] = useState<Record<ModelProviderId, string[]>>(FALLBACK_MODEL_OPTIONS);

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [agentRes, teamRes, toolRes, skillRes, knowledgeRes, modelRes] = await Promise.all([
        apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
        apiGet<{ teams: Team[] }>("/api/teams"),
        apiGet<{ tools: Tool[] }>("/api/tools"),
        apiGet<{ skills: Skill[] }>("/api/skills"),
        apiGet<{ knowledgeSources: KnowledgeSource[] }>("/api/knowledge-sources"),
        apiGet<AgnoModelsResponse>("/api/agno/models").catch(() => null),
      ]);
      setAgents(agentRes.agents);
      setTeams(teamRes.teams);
      setTools(toolRes.tools);
      setSkills(skillRes.skills);
      setKnowledgeSources(knowledgeRes.knowledgeSources);
      if (modelRes?.providers?.length) {
        setModelOptions({
          ollama: modelRes.providers.find((provider) => provider.id === "ollama")?.models || FALLBACK_MODEL_OPTIONS.ollama,
          openrouter: modelRes.providers.find((provider) => provider.id === "openrouter")?.models || FALLBACK_MODEL_OPTIONS.openrouter,
          vertexai: modelRes.providers.find((provider) => provider.id === "vertexai")?.models || FALLBACK_MODEL_OPTIONS.vertexai,
        });
      }
      const fallbackId = agentRes.agents[0]?.id || "";
      setSelectedAgentId((current) => (agentRes.agents.some((agent) => agent.id === current) ? current : fallbackId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar agentes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(() => agents.find((agent) => agent.id === selectedAgentId) || null, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selected) {
      setEditingId(null);
      setForm({ ...emptyForm, teamId: teams[0]?.id || "", primaryModel: FALLBACK_MODEL_OPTIONS.ollama[0] });
      return;
    }
    setEditingId(selected.id);
    setForm(toForm(selected));
  }, [selected?.id, teams]);

  const linkedToolIds = new Set((selected?.toolLinks || []).map((link) => link.toolId));
  const linkedSkillIds = new Set((selected?.skillLinks || []).map((link) => link.skillId));
  const linkedKnowledgeIds = new Set((selected?.knowledgeLinks || []).map((link) => link.knowledgeSourceId));

  const availableTools = tools.filter((tool) => !linkedToolIds.has(tool.id));
  const availableSkills = skills.filter((skill) => !linkedSkillIds.has(skill.id));
  const availableKnowledge = knowledgeSources.filter((item) => !linkedKnowledgeIds.has(item.id));

  const [selectedToolId, setSelectedToolId] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState("");
  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState("");

  const startCreate = () => {
    setSelectedAgentId("");
    setEditingId(null);
    setForm({ ...emptyForm, teamId: teams[0]?.id || "" });
    setTab("summary");
  };

  const saveAgent = async () => {
    let runtimeConfig: unknown = null;
    if (form.runtimeConfigText.trim()) {
      try {
        runtimeConfig = JSON.parse(form.runtimeConfigText);
      } catch {
        setStatus("runtimeConfig precisa ser JSON valido.");
        return;
      }
    }
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      tags: form.tagsCsv.split(",").map((item) => item.trim()).filter(Boolean),
      type: form.type,
      teamId: form.isGlobal ? null : form.teamId || null,
      isGlobal: form.isGlobal,
      visibility: form.visibility,
      emoji: null,
      avatarUrl: null,
      primaryModel: form.primaryModel.trim() || null,
      fallbackModels: null,
      reasoningEnabled: form.reasoningEnabled,
      temperature: null,
      maxTokens: null,
      addHistoryContext: form.addHistoryContext,
      historySessions: null,
      addStateContext: false,
      knowledgeMode: form.knowledgeMode,
      knowledgeMaxResults: null,
      knowledgeAddReferences: true,
      knowledgeContextFormat: "json",
      knowledgeFilters: {},
      runtimeConfig,
    };
    if (!payload.name || !payload.description || !payload.prompt) {
      setStatus("Nome, descricao e prompt sao obrigatorios.");
      return;
    }

    try {
      if (editingId) {
        await apiPut(`/api/agents/${editingId}`, payload);
        setStatus("Agente atualizado.");
      } else {
        await apiPost("/api/agents", payload);
        setStatus("Agente simples criado.");
      }
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar agente.");
    }
  };

  const saveCustomization = async () => {
    if (!selected) return;
    try {
      await apiPut(`/api/agents/${selected.id}/customization`, {
        userCustomized: form.userCustomized,
        customizationNote: form.customizationNote.trim() || null,
      });
      setStatus(form.userCustomized ? "Protecao de customizacao salva." : "Protecao de customizacao removida.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar protecao de customizacao.");
    }
  };

  const removeAgent = async () => {
    if (!selected) return;
    if (!window.confirm(`Arquivar/remover o agente "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/agents/${selected.id}`);
      setStatus("Agente removido.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao remover agente.");
    }
  };

  const assignTool = async () => {
    if (!selected || !selectedToolId) return;
    const tool = tools.find((item) => item.id === selectedToolId);
    if (!tool) return;
    try {
      await apiPost(`/api/agents/${selected.id}/tools`, {
        toolId: selectedToolId,
        canRead: true,
        canWrite: tool.policy === "write" && selected.type === "TICKET",
        justification: "Assigned from simplified agents page",
      });
      setSelectedToolId("");
      await load();
      setStatus("Ferramenta vinculada.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao vincular ferramenta.");
    }
  };

  const removeTool = async (toolId: string) => {
    if (!selected) return;
    await apiDelete(`/api/agents/${selected.id}/tools/${toolId}`);
    await load();
    setStatus("Ferramenta removida.");
  };

  const assignSkill = async () => {
    if (!selected || !selectedSkillId) return;
    try {
      await apiPost(`/api/agents/${selected.id}/skills`, { skillId: selectedSkillId });
      setSelectedSkillId("");
      await load();
      setStatus("Skill vinculada.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao vincular skill.");
    }
  };

  const removeSkill = async (skillId: string) => {
    if (!selected) return;
    await apiDelete(`/api/agents/${selected.id}/skills/${skillId}`);
    await load();
    setStatus("Skill removida.");
  };

  const assignKnowledge = async () => {
    if (!selected || !selectedKnowledgeId) return;
    try {
      await apiPost(`/api/agents/${selected.id}/knowledge`, { knowledgeSourceId: selectedKnowledgeId });
      setSelectedKnowledgeId("");
      await load();
      setStatus("Knowledge source vinculado.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao vincular knowledge source.");
    }
  };

  const removeKnowledge = async (knowledgeSourceId: string) => {
    if (!selected) return;
    await apiDelete(`/api/agents/${selected.id}/knowledge/${knowledgeSourceId}`);
    await load();
    setStatus("Knowledge source removido.");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Agentes</h2>
          <p className="text-sm text-slate-400">Crie agentes simples no portal. Agentes mais complexos devem ser mantidos no GitHub/runtime e apenas observados aqui.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Atualizar</button>
          <button className="btn-primary" onClick={startCreate}>Novo Agente Simples</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Catalogo</div>
          {loading ? <div className="text-xs text-slate-400">Carregando...</div> : null}
          <div className="space-y-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedAgentId === agent.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">{agent.name}</div>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{typeLabel(agent.type)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {(agent.isGlobal ? "GLOBAL" : teams.find((team) => team.id === agent.teamId)?.key || "team")} | {agent.visibility}
                </div>
                {agent.userCustomized ? <div className="mt-2 text-[10px] uppercase tracking-wider text-amber-300">custom protegido</div> : null}
              </button>
            ))}
            {!agents.length ? <div className="text-xs text-slate-400">Nenhum agente cadastrado.</div> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button key={item.id} className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => setTab(item.id)}>
                {item.label}
              </button>
            ))}
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">{editingId ? "Agente selecionado" : "Novo agente simples"}</div>
                <div className="text-xs text-slate-400">{editingId ? "Edicao orientada a formulario para operacao basica." : "Fluxo enxuto para analistas nao-dev."}</div>
              </div>
              {selected ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeAgent()}>Remover</button> : null}
            </div>

            {tab === "summary" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <input className="input-dark" placeholder="Nome do agente" value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} />
                <select className="input-dark" value={form.type} onChange={(e) => setForm((state) => ({ ...state, type: e.target.value as AgentForm["type"] }))}>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="SPECIALIST">Especialista</option>
                  <option value="TICKET">Ticket</option>
                </select>
                <textarea className="input-dark min-h-24 md:col-span-2" placeholder="Objetivo e responsabilidade do agente" value={form.description} onChange={(e) => setForm((state) => ({ ...state, description: e.target.value }))} />
                <textarea className="input-dark min-h-36 md:col-span-2" placeholder="Instrucoes principais do agente" value={form.prompt} onChange={(e) => setForm((state) => ({ ...state, prompt: e.target.value }))} />
                <input className="input-dark md:col-span-2" placeholder="Tags (csv)" value={form.tagsCsv} onChange={(e) => setForm((state) => ({ ...state, tagsCsv: e.target.value }))} />
                <div className="md:col-span-2">
                  <button className="btn-primary" onClick={() => void saveAgent()}>{editingId ? "Salvar Agente" : "Criar Agente"}</button>
                </div>
              </div>
            ) : null}

            {tab === "capabilities" ? (
              <div className="space-y-4">
                <div className="grid gap-3 lg:grid-cols-3">
                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Ferramentas</div>
                    <div className="space-y-2">
                      {(selected?.toolLinks || []).map((link) => (
                        <div key={link.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-2 py-2 text-xs text-slate-200">
                          <span>{link.tool.name}</span>
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void removeTool(link.toolId)}>Remover</button>
                        </div>
                      ))}
                      {!selected?.toolLinks?.length ? <div className="text-xs text-slate-400">Nenhuma ferramenta vinculada.</div> : null}
                      <select className="input-dark" value={selectedToolId} onChange={(e) => setSelectedToolId(e.target.value)}>
                        <option value="">Adicionar ferramenta</option>
                        {availableTools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
                      </select>
                      <button className="btn-primary w-full" disabled={!selectedToolId || !selected} onClick={() => void assignTool()}>Vincular</button>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Skills</div>
                    <div className="space-y-2">
                      {(selected?.skillLinks || []).map((link) => (
                        <div key={link.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-2 py-2 text-xs text-slate-200">
                          <span>{link.skill.name}</span>
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void removeSkill(link.skillId)}>Remover</button>
                        </div>
                      ))}
                      {!selected?.skillLinks?.length ? <div className="text-xs text-slate-400">Nenhuma skill vinculada.</div> : null}
                      <select className="input-dark" value={selectedSkillId} onChange={(e) => setSelectedSkillId(e.target.value)}>
                        <option value="">Adicionar skill</option>
                        {availableSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}
                      </select>
                      <button className="btn-primary w-full" disabled={!selectedSkillId || !selected} onClick={() => void assignSkill()}>Vincular</button>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Knowledge Sources</div>
                    <div className="space-y-2">
                      {(selected?.knowledgeLinks || []).map((link) => (
                        <div key={link.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-2 py-2 text-xs text-slate-200">
                          <span>{link.knowledgeSource.name}</span>
                          <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void removeKnowledge(link.knowledgeSourceId)}>Remover</button>
                        </div>
                      ))}
                      {!selected?.knowledgeLinks?.length ? <div className="text-xs text-slate-400">Nenhum knowledge source vinculado.</div> : null}
                      <select className="input-dark" value={selectedKnowledgeId} onChange={(e) => setSelectedKnowledgeId(e.target.value)}>
                        <option value="">Adicionar knowledge source</option>
                        {availableKnowledge.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                      <button className="btn-primary w-full" disabled={!selectedKnowledgeId || !selected} onClick={() => void assignKnowledge()}>Vincular</button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {tab === "behavior" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-slate-400">LLM provider</div>
                  <select
                    className="input-dark"
                    value={form.modelProvider}
                    onChange={(e) =>
                      setForm((state) => {
                        const provider = e.target.value as ModelProviderId;
                        return {
                          ...state,
                          modelProvider: provider,
                          primaryModel: modelOptions[provider]?.[0] || FALLBACK_MODEL_OPTIONS[provider][0] || "",
                        };
                      })
                    }
                  >
                    <option value="ollama">ollama</option>
                    <option value="openrouter">openrouter</option>
                    <option value="vertexai">vertexai</option>
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Model ID</div>
                  <select className="input-dark" value={form.primaryModel} onChange={(e) => setForm((state) => ({ ...state, primaryModel: e.target.value }))}>
                    {(modelOptions[form.modelProvider] || FALLBACK_MODEL_OPTIONS[form.modelProvider] || []).map((modelId) => (
                      <option key={modelId} value={modelId}>{modelId}</option>
                    ))}
                    {form.primaryModel && !(modelOptions[form.modelProvider] || []).includes(form.primaryModel) ? <option value={form.primaryModel}>{form.primaryModel}</option> : null}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Modo de knowledge</div>
                  <select className="input-dark" value={form.knowledgeMode} onChange={(e) => setForm((state) => ({ ...state, knowledgeMode: e.target.value as AgentForm["knowledgeMode"] }))}>
                    <option value="agentic">agentic</option>
                    <option value="references">references</option>
                    <option value="hybrid">hybrid</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.reasoningEnabled} onChange={(e) => setForm((state) => ({ ...state, reasoningEnabled: e.target.checked }))} />Habilitar reasoning</label>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.addHistoryContext} onChange={(e) => setForm((state) => ({ ...state, addHistoryContext: e.target.checked }))} />Adicionar historico ao contexto</label>
                <div className="md:col-span-2">
                  <div className="mb-1 text-xs text-slate-400">Runtime config (JSON)</div>
                  <textarea
                    className="input-dark min-h-72 font-mono text-xs"
                    placeholder='{"domainPlanner":{"enabled":true,"domain":"jumpcloud","tasks":[]}}'
                    value={form.runtimeConfigText}
                    onChange={(e) => setForm((state) => ({ ...state, runtimeConfigText: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 rounded-md border border-slate-700 bg-slate-900/35 p-3 text-xs text-slate-400">
                  A configuracao operacional do planner e dos consumos de MCP fica neste JSON do agente. O runtime usa esse bloco para interpretar e executar tarefas, em vez de depender de regras embutidas no codigo.
                </div>
                <div className="md:col-span-2">
                  <button className="btn-primary" onClick={() => void saveAgent()}>{editingId ? "Salvar comportamento" : "Criar agente"}</button>
                </div>
              </div>
            ) : null}

            {tab === "governance" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs text-slate-400">Time dono</div>
                  <select className="input-dark" value={form.teamId} disabled={form.isGlobal} onChange={(e) => setForm((state) => ({ ...state, teamId: e.target.value }))}>
                    <option value="">Sem time</option>
                    {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs text-slate-400">Visibilidade</div>
                  <select className="input-dark" value={form.visibility} onChange={(e) => setForm((state) => ({ ...state, visibility: e.target.value as AgentForm["visibility"] }))}>
                    <option value="private">private</option>
                    <option value="shared">shared</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2"><input type="checkbox" checked={form.isGlobal} onChange={(e) => setForm((state) => ({ ...state, isGlobal: e.target.checked }))} />Disponivel globalmente</label>
                {selected ? (
                  <div className="md:col-span-2 rounded-md border border-slate-700 bg-slate-900/35 p-3 text-xs text-slate-400">
                    Este agente esta sendo tratado como configuracao operacional do portal. Itens de runtime instalados aparecem em `Tools` e `Skills` com origem `Agno`.
                  </div>
                ) : null}
                {selected ? (
                  <div className="md:col-span-2 rounded-md border border-amber-400/30 bg-amber-500/10 p-3">
                    <div className="text-sm font-semibold text-amber-100">Protecao contra sobrescrita</div>
                    <div className="mt-1 text-xs text-amber-50/80">Quando habilitado, `context:apply` preserva este agente e evita sobrescrever suas configuracoes automaticamente.</div>
                    <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                      <input type="checkbox" checked={form.userCustomized} onChange={(e) => setForm((state) => ({ ...state, userCustomized: e.target.checked }))} />
                      Marcar como customizacao do usuario
                    </label>
                    <textarea className="input-dark mt-3 min-h-20" placeholder="Motivo opcional para preservar este agente" value={form.customizationNote} onChange={(e) => setForm((state) => ({ ...state, customizationNote: e.target.value }))} />
                    <div className="mt-3">
                      <button className="btn-ghost" onClick={() => void saveCustomization()}>Salvar protecao</button>
                    </div>
                  </div>
                ) : null}
                <div className="md:col-span-2">
                  <button className="btn-primary" onClick={() => void saveAgent()}>{editingId ? "Salvar governanca" : "Criar agente"}</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
