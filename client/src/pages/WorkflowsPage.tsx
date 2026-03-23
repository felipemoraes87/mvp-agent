import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AgentWithLinks, Team, Workflow } from "../lib/types";

type WorkflowTab = "overview" | "details" | "participants";
type WorkflowForm = Omit<Workflow, "id" | "managedBy" | "runtimeSource">;
type SetupCheck = {
  integrations: Array<{
    key: string;
    label: string;
    configured: boolean;
    available: boolean;
    missingFields: string[];
  }>;
  summary: string;
};

const tabs: Array<{ id: WorkflowTab; label: string }> = [
  { id: "overview", label: "Catalogo" },
  { id: "details", label: "Detalhes" },
  { id: "participants", label: "Participantes" },
];

const empty: WorkflowForm = {
  name: "",
  description: "",
  objective: "",
  preconditions: [],
  integrationKeys: [],
  participantAgentIds: [],
  steps: [],
  successCriteria: [],
  outputFormat: "",
  failureHandling: [],
  setupPoints: [],
  enabled: true,
  visibility: "private",
  ownerTeamId: null,
  userCustomized: false,
  customizationNote: null,
  customizationUpdatedAt: null,
};

function toForm(workflow: Workflow): WorkflowForm {
  return {
    name: workflow.name,
    description: workflow.description,
    objective: workflow.objective,
    preconditions: workflow.preconditions,
    integrationKeys: workflow.integrationKeys,
    participantAgentIds: workflow.participantAgentIds,
    steps: workflow.steps,
    successCriteria: workflow.successCriteria,
    outputFormat: workflow.outputFormat,
    failureHandling: workflow.failureHandling,
    setupPoints: workflow.setupPoints,
    enabled: workflow.enabled,
    visibility: workflow.visibility,
    ownerTeamId: workflow.ownerTeamId,
    userCustomized: Boolean(workflow.userCustomized),
    customizationNote: workflow.customizationNote || null,
    customizationUpdatedAt: workflow.customizationUpdatedAt || null,
  };
}

function toLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toText(value: string[]): string {
  return value.join("\n");
}

export function WorkflowsPage() { // NOSONAR
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<WorkflowTab>("overview");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<WorkflowForm>(empty);
  const [setupCheck, setSetupCheck] = useState<SetupCheck | null>(null);
  const [setupBusy, setSetupBusy] = useState(false);

  const load = async () => {
    const [agentRes, teamRes, workflowRes] = await Promise.all([
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ teams: Team[] }>("/api/teams"),
      apiGet<{ workflows: Workflow[] }>("/api/workflows"),
    ]);
    setAgents(agentRes.agents);
    setTeams(teamRes.teams);
    setWorkflows(workflowRes.workflows);
  };

  useEffect(() => {
    void load().catch((err) => setStatus(err instanceof Error ? err.message : "Falha ao carregar workflows."));
  }, []);

  const visibleWorkflows = useMemo(() => {
    const scoped = !user || user.role === "ADMIN" || user.role === "OPERATOR"
      ? workflows
      : workflows.filter((workflow) => workflow.visibility === "shared" || workflow.ownerTeamId === user.teamId);
    const query = search.trim().toLowerCase();
    if (!query) return scoped;
    return scoped.filter((workflow) =>
      [
        workflow.name,
        workflow.description,
        workflow.objective,
        workflow.outputFormat,
        ...workflow.integrationKeys,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [search, user, workflows]);

  useEffect(() => {
    setSelectedId((current) => (visibleWorkflows.some((workflow) => workflow.id === current) ? current : (visibleWorkflows[0]?.id || "")));
  }, [visibleWorkflows]);

  const selected = useMemo(() => visibleWorkflows.find((workflow) => workflow.id === selectedId) || workflows.find((workflow) => workflow.id === selectedId) || null, [selectedId, visibleWorkflows, workflows]);

  useEffect(() => {
    if (!selected) {
      setForm({ ...empty, ownerTeamId: user?.teamId || teams[0]?.id || null });
      setSetupCheck(null);
      return;
    }
    setForm(toForm(selected));
    setSetupCheck(null);
  }, [selected?.id, teams, user?.teamId]);

  const linkedAgents = useMemo(() => agents.filter((agent) => form.participantAgentIds.includes(agent.id)), [agents, form.participantAgentIds]);

  const startCreate = () => {
    setSelectedId("");
    setTab("details");
    setForm({ ...empty, ownerTeamId: user?.teamId || teams[0]?.id || null });
    setSetupCheck(null);
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      objective: form.objective.trim(),
      preconditions: form.preconditions,
      integrationKeys: form.integrationKeys,
      participantAgentIds: form.participantAgentIds,
      steps: form.steps,
      successCriteria: form.successCriteria,
      outputFormat: form.outputFormat.trim(),
      failureHandling: form.failureHandling,
      setupPoints: form.setupPoints,
      enabled: form.enabled,
      visibility: form.visibility,
      ownerTeamId: form.ownerTeamId,
    };
    if (!payload.name || !payload.description || !payload.objective || !payload.outputFormat) {
      setStatus("Nome, descricao, objetivo e formato de saida sao obrigatorios.");
      return;
    }
    try {
      if (selected) {
        await apiPut(`/api/workflows/${selected.id}`, payload);
        setStatus("Workflow atualizado.");
      } else {
        await apiPost("/api/workflows", payload);
        setStatus("Workflow criado.");
      }
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar workflow.");
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete workflow "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/workflows/${selected.id}`);
      setStatus("Workflow removido.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao remover workflow.");
    }
  };

  const saveCustomization = async () => {
    if (!selected) return;
    try {
      await apiPut(`/api/workflows/${selected.id}/customization`, {
        userCustomized: Boolean(form.userCustomized),
        customizationNote: form.customizationNote?.trim() || null,
      });
      setStatus(form.userCustomized ? "Protecao de customizacao salva." : "Protecao de customizacao removida.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar protecao.");
    }
  };

  const runWorkflow = () => {
    const workflow = selected ? selected : ({ ...form, id: "draft", managedBy: "portal", runtimeSource: null } as Workflow);
    navigate("/playground", {
      state: {
        workflowLaunch: {
          workflowId: workflow.id,
          workflowName: workflow.name,
          message: `Execute o workflow ${workflow.name}.\nObjetivo: ${workflow.objective}\nIntegracoes: ${workflow.integrationKeys.join(", ") || "nenhuma"}\nPassos: ${workflow.steps.join(" | ")}`,
        },
      },
    });
  };

  const validateSetup = async () => {
    if (!selected) return;
    try {
      setSetupBusy(true);
      const result = await apiPost<SetupCheck>(`/api/workflows/${selected.id}/setup-check`, {});
      setSetupCheck(result);
      setStatus("Validacao de setup executada.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao validar setup.");
    } finally {
      setSetupBusy(false);
    }
  };

  const setParticipantChecked = (agentId: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      participantAgentIds: checked ? [...prev.participantAgentIds, agentId] : prev.participantAgentIds.filter((id) => id !== agentId),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Workflows</h2>
          <p className="text-sm text-slate-400">Catalogo de workflows do portal e do runtime, com protecao para itens gerenciados pelo Agno.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Reload</button>
          <button className="btn-primary" onClick={startCreate}>New Workflow</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-100">Catalogo</div>
            <div className="text-[11px] text-slate-400">{visibleWorkflows.length}/{workflows.length}</div>
          </div>
          <input className="input-dark mb-3" placeholder="Buscar por nome, objetivo ou integracao..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="space-y-2">
            {visibleWorkflows.map((workflow) => (
              <button
                key={workflow.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === workflow.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedId(workflow.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-100">{workflow.name}</div>
                  <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">{workflow.managedBy}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{workflow.visibility} | {workflow.enabled ? "enabled" : "disabled"}</div>
              </button>
            ))}
            {!visibleWorkflows.length ? <div className="text-xs text-slate-400">Nenhum workflow encontrado.</div> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button key={item.id} className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-100">{selected ? selected.name : "Novo workflow"}</div>
                <div className="text-xs text-slate-400">{selected?.managedBy === "agno" ? "Workflow gerenciado pelo runtime." : "Workflow editavel no portal."}</div>
              </div>
              <div className="flex gap-2">
                {selected ? <button className="btn-ghost" onClick={runWorkflow}>Abrir no Playground</button> : null}
                {selected ? <button className="btn-ghost" disabled={setupBusy} onClick={() => void validateSetup()}>{setupBusy ? "Validando..." : "Validar setup"}</button> : null}
                {selected && selected.managedBy !== "agno" ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeSelected()}>Delete</button> : null}
              </div>
            </div>

            {tab === "overview" ? (
              <div className="space-y-4">
                {selected ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><div className="text-xs text-slate-400">Objetivo</div><div className="text-sm text-slate-100">{selected.objective}</div></div>
                      <div><div className="text-xs text-slate-400">Output</div><div className="text-sm text-slate-100">{selected.outputFormat}</div></div>
                      <div><div className="text-xs text-slate-400">Integracoes</div><div className="text-sm text-slate-100">{selected.integrationKeys.join(", ") || "-"}</div></div>
                      <div><div className="text-xs text-slate-400">Participantes</div><div className="text-sm text-slate-100">{selected.participantAgentIds.length}</div></div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3"><div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Pre-condicoes</div><div className="space-y-1 text-sm text-slate-200">{selected.preconditions.map((item) => <div key={item}>- {item}</div>) || "-"}</div></div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3"><div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Criterios de sucesso</div><div className="space-y-1 text-sm text-slate-200">{selected.successCriteria.map((item) => <div key={item}>- {item}</div>) || "-"}</div></div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3"><div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Falhas</div><div className="space-y-1 text-sm text-slate-200">{selected.failureHandling.map((item) => <div key={item}>- {item}</div>) || "-"}</div></div>
                      <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3"><div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Setup points</div><div className="space-y-1 text-sm text-slate-200">{selected.setupPoints.map((item) => <div key={item}>- {item}</div>) || "-"}</div></div>
                    </div>
                    <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                      <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Passos</div>
                      <div className="space-y-1 text-sm text-slate-200">{selected.steps.map((item, index) => <div key={`${index}-${item}`}>{index + 1}. {item}</div>)}</div>
                    </div>
                    {setupCheck ? (
                      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
                        <div className="text-sm font-semibold text-emerald-100">Setup Check</div>
                        <div className="mt-1 text-xs text-emerald-50/80">{setupCheck.summary}</div>
                        <div className="mt-3 space-y-2">
                          {setupCheck.integrations.map((item) => (
                            <div key={item.key} className="rounded-md border border-emerald-500/20 px-3 py-2 text-xs text-slate-100">
                              <div>{item.label} | configured={String(item.configured)} | available={String(item.available)}</div>
                              {item.missingFields.length ? <div className="mt-1 text-slate-300">Missing: {item.missingFields.join(", ")}</div> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-md border border-amber-400/30 bg-amber-500/10 p-3">
                      <div className="text-sm font-semibold text-amber-100">Protecao contra catalog sync</div>
                      <div className="mt-1 text-xs text-amber-50/80">Quando habilitado, o `catalog sync` preserva este workflow e nao sobrescreve seus metadados.</div>
                      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                        <input type="checkbox" checked={Boolean(form.userCustomized)} onChange={(e) => setForm((state) => ({ ...state, userCustomized: e.target.checked }))} />
                        Marcar como customizacao do usuario
                      </label>
                      <textarea className="input-dark mt-3 min-h-20" placeholder="Motivo opcional" value={form.customizationNote || ""} onChange={(e) => setForm((state) => ({ ...state, customizationNote: e.target.value }))} />
                      <div className="mt-3">
                        <button className="btn-ghost" onClick={() => void saveCustomization()}>Salvar protecao</button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-400">Selecione ou crie um workflow.</div>
                )}
              </div>
            ) : null}

            {tab === "details" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input-dark" placeholder="Workflow name" value={form.name} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} />
                <select className="input-dark" value={form.visibility} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((state) => ({ ...state, visibility: e.target.value as Workflow["visibility"] }))}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <select className="input-dark" value={form.ownerTeamId || ""} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((state) => ({ ...state, ownerTeamId: e.target.value || null }))}>
                  <option value="">No owner team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.enabled} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((state) => ({ ...state, enabled: e.target.checked }))} />Enabled</label>
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Description" disabled={selected?.managedBy === "agno"} value={form.description} onChange={(e) => setForm((state) => ({ ...state, description: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Objective" disabled={selected?.managedBy === "agno"} value={form.objective} onChange={(e) => setForm((state) => ({ ...state, objective: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Preconditions (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.preconditions)} onChange={(e) => setForm((state) => ({ ...state, preconditions: toLines(e.target.value) }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Integration keys (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.integrationKeys)} onChange={(e) => setForm((state) => ({ ...state, integrationKeys: toLines(e.target.value) }))} />
                <textarea className="input-dark md:col-span-2 min-h-24" placeholder="Steps (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.steps)} onChange={(e) => setForm((state) => ({ ...state, steps: toLines(e.target.value) }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Success criteria (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.successCriteria)} onChange={(e) => setForm((state) => ({ ...state, successCriteria: toLines(e.target.value) }))} />
                <input className="input-dark md:col-span-2" placeholder="Output format" disabled={selected?.managedBy === "agno"} value={form.outputFormat} onChange={(e) => setForm((state) => ({ ...state, outputFormat: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Failure handling (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.failureHandling)} onChange={(e) => setForm((state) => ({ ...state, failureHandling: toLines(e.target.value) }))} />
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Setup points (one per line)" disabled={selected?.managedBy === "agno"} value={toText(form.setupPoints)} onChange={(e) => setForm((state) => ({ ...state, setupPoints: toLines(e.target.value) }))} />
                <div className="md:col-span-2">
                  {selected?.managedBy === "agno" ? <div className="text-xs text-slate-400">Runtime workflow gerenciado pelo Agno. Edite no runtime/catalog.</div> : <button className="btn-primary" onClick={() => void save()}>{selected ? "Save" : "Create"}</button>}
                </div>
              </div>
            ) : null}

            {tab === "participants" ? (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Select participating agents</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={form.participantAgentIds.includes(agent.id)}
                          disabled={selected?.managedBy === "agno"}
                          onChange={(e) => setParticipantChecked(agent.id, e.target.checked)}
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Current participants</div>
                  {linkedAgents.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {linkedAgents.map((agent) => <div key={agent.id} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">{agent.name}</div>)}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">No participating agents.</div>
                  )}
                </div>
                {selected?.managedBy === "agno" ? <div className="text-xs text-slate-400">Participantes de workflow gerenciados pelo runtime.</div> : <button className="btn-primary" onClick={() => void save()}>{selected ? "Save Participants" : "Create Workflow"}</button>}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
