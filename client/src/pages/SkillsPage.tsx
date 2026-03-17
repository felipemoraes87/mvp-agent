import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AgentWithLinks, Skill, Team } from "../lib/types";

type SkillTab = "overview" | "details" | "linkedAgents";
type SkillForm = Omit<Skill, "id" | "managedBy" | "runtimeSource"> & { linkedAgentIds: string[] };

const tabs: Array<{ id: SkillTab; label: string }> = [
  { id: "overview", label: "Biblioteca" },
  { id: "details", label: "Detalhes" },
  { id: "linkedAgents", label: "Uso" },
];

const empty: SkillForm = {
  name: "",
  description: "",
  prompt: "",
  runbookUrl: "",
  category: "operations",
  enabled: true,
  visibility: "private",
  ownerTeamId: null,
  linkedAgentIds: [],
};

function toForm(skill: Skill): SkillForm {
  return {
    name: skill.name,
    description: skill.description,
    prompt: skill.prompt,
    runbookUrl: skill.runbookUrl || "",
    category: skill.category,
    enabled: skill.enabled,
    visibility: skill.visibility,
    ownerTeamId: skill.ownerTeamId,
    linkedAgentIds: skill.linkedAgentIds || [],
  };
}

export function SkillsPage() { // NOSONAR
  const { user } = useAuth();
  const [tab, setTab] = useState<SkillTab>("overview");
  const [status, setStatus] = useState("");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<SkillForm>(empty);

  const load = async () => {
    const [agentRes, teamRes, skillRes] = await Promise.all([
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ teams: Team[] }>("/api/teams"),
      apiGet<{ skills: Skill[] }>("/api/skills"),
    ]);
    setAgents(agentRes.agents);
    setTeams(teamRes.teams);
    setSkills(skillRes.skills);
  };

  useEffect(() => {
    void load().catch(() => {
      setAgents([]);
      setTeams([]);
      setSkills([]);
    });
  }, []);

  const visibleSkills = useMemo(() => {
    if (!user) return skills;
    if (user.role === "ADMIN" || user.role === "OPERATOR") return skills;
    return skills.filter((skill) => skill.visibility === "shared" || skill.ownerTeamId === user.teamId);
  }, [skills, user]);

  useEffect(() => {
    setSelectedId((current) => (visibleSkills.some((skill) => skill.id === current) ? current : (visibleSkills[0]?.id || "")));
  }, [visibleSkills]);

  const selected = useMemo(() => visibleSkills.find((skill) => skill.id === selectedId) || null, [visibleSkills, selectedId]);

  useEffect(() => {
    if (!selected) {
      setForm(empty);
      return;
    }
    setForm(toForm(selected));
  }, [selected?.id]);

  const linkedAgentList = useMemo(() => agents.filter((agent) => form.linkedAgentIds.includes(agent.id)), [agents, form.linkedAgentIds]);

  const startCreate = () => {
    setSelectedId("");
    setForm({ ...empty, ownerTeamId: user?.teamId || teams[0]?.id || null });
    setTab("details");
  };

  const save = async () => {
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      prompt: form.prompt.trim(),
      runbookUrl: form.runbookUrl?.trim() || "",
      category: form.category,
      enabled: form.enabled,
      visibility: form.visibility,
      ownerTeamId: form.ownerTeamId,
      linkedAgentIds: form.linkedAgentIds,
      managedBy: selected?.managedBy || "portal",
      runtimeSource: selected?.runtimeSource || null,
    };

    if (!payload.name) {
      setStatus("Skill name is required.");
      return;
    }

    try {
      if (selected) {
        await apiPut(`/api/skills/${selected.id}`, payload);
        setStatus("Skill updated.");
      } else {
        await apiPost("/api/skills", payload);
        setStatus("Skill created.");
      }
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save skill.");
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete skill "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/skills/${selected.id}`);
      setStatus("Skill removed.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to delete skill.");
    }
  };

  const saveCustomization = async () => {
    if (!selected) return;
    try {
      await apiPut(`/api/skills/${selected.id}/customization`, {
        userCustomized: Boolean(form.userCustomized),
        customizationNote: form.customizationNote?.trim() || null,
      });
      setStatus(form.userCustomized ? "Protecao de customizacao salva." : "Protecao de customizacao removida.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed to save customization protection.");
    }
  };

  const setLinkedAgentChecked = (agentId: string, checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      linkedAgentIds: checked ? [...prev.linkedAgentIds, agentId] : prev.linkedAgentIds.filter((id) => id !== agentId),
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Skills</h2>
          <p className="text-sm text-slate-400">Biblioteca de capacidades reutilizaveis. Skills do runtime aparecem aqui como leitura; skills simples podem ser criadas pelo portal.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Reload</button>
          <button className="btn-primary" onClick={startCreate}>New Skill</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Skills</div>
          <div className="space-y-2">
            {visibleSkills.map((skill) => (
              <button
                key={skill.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === skill.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedId(skill.id)}
              >
                <div className="font-semibold text-slate-100">{skill.name}</div>
                <div className="text-xs text-slate-400">{skill.category} | {skill.enabled ? "enabled" : "disabled"} | {skill.managedBy}</div>
                {skill.userCustomized ? <div className="mt-2 text-[10px] uppercase tracking-wider text-amber-300">custom protegido</div> : null}
              </button>
            ))}
            {!visibleSkills.length ? <div className="text-xs text-slate-400">No skills created yet.</div> : null}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button key={item.id} className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => setTab(item.id)}>{item.label}</button>
            ))}
          </div>

          <div className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">Skill Settings</div>
              {selected && selected.managedBy !== "agno" ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeSelected()}>Delete</button> : null}
            </div>

            {tab === "overview" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Resumo funcional e abrangencia atual da skill.</div>
                {selected ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><div className="text-xs text-slate-400">Name</div><div className="text-sm text-slate-100">{selected.name}</div></div>
                    <div><div className="text-xs text-slate-400">Category</div><div className="text-sm text-slate-100">{selected.category}</div></div>
                    <div><div className="text-xs text-slate-400">Status</div><div className="text-sm text-slate-100">{selected.enabled ? "enabled" : "disabled"}</div></div>
                    <div><div className="text-xs text-slate-400">Visibility</div><div className="text-sm text-slate-100">{selected.visibility}</div></div>
                    <div><div className="text-xs text-slate-400">Linked Agents</div><div className="text-sm text-slate-100">{(selected.linkedAgentIds || []).length}</div></div>
                    <div><div className="text-xs text-slate-400">Managed By</div><div className="text-sm text-slate-100">{selected.managedBy}</div></div>
                    <div><div className="text-xs text-slate-400">Protegida</div><div className="text-sm text-slate-100">{selected.userCustomized ? "sim" : "nao"}</div></div>
                    <div className="md:col-span-2"><div className="text-xs text-slate-400">Runbook</div><div className="truncate text-sm text-slate-100">{selected.runbookUrl || "-"}</div></div>
                    <div className="md:col-span-3"><div className="text-xs text-slate-400">Prompt</div><div className="text-sm text-slate-100">{selected.prompt || "-"}</div></div>
                    <div className="md:col-span-3 rounded-md border border-amber-400/30 bg-amber-500/10 p-3">
                      <div className="text-sm font-semibold text-amber-100">Protecao contra catalog sync</div>
                      <div className="mt-1 text-xs text-amber-50/80">Quando habilitado, `catalog sync` preserva esta skill e nao sobrescreve seu prompt e metadados.</div>
                      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                        <input type="checkbox" checked={Boolean(form.userCustomized)} onChange={(e) => setForm((s) => ({ ...s, userCustomized: e.target.checked }))} />
                        Marcar como customizacao do usuario
                      </label>
                      <textarea className="input-dark mt-3 min-h-20" placeholder="Motivo opcional para preservar esta skill" value={form.customizationNote || ""} onChange={(e) => setForm((s) => ({ ...s, customizationNote: e.target.value }))} />
                      <div className="mt-3">
                        <button className="btn-ghost" onClick={() => void saveCustomization()}>Salvar protecao</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">Crie uma skill na aba Detalhes.</div>
                )}
              </div>
            ) : null}

            {tab === "details" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input-dark" placeholder="Skill name" value={form.name} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                <select className="input-dark" value={form.category} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value as SkillForm["category"] }))}>
                  <option value="operations">operations</option>
                  <option value="analysis">analysis</option>
                  <option value="compliance">compliance</option>
                  <option value="custom">custom</option>
                </select>
                <select className="input-dark" value={form.ownerTeamId || ""} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, ownerTeamId: e.target.value || null }))}>
                  <option value="">No owner team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <select className="input-dark" value={form.visibility} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as SkillForm["visibility"] }))}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <input className="input-dark md:col-span-2" placeholder="Runbook URL (optional)" value={form.runbookUrl || ""} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, runbookUrl: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-24" placeholder="Description" value={form.description} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
                <textarea className="input-dark md:col-span-2 min-h-32" placeholder="Prompt / operational instruction" value={form.prompt} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, prompt: e.target.value }))} />
                <label className="flex items-center gap-2 text-xs text-slate-300 md:col-span-2"><input type="checkbox" checked={form.enabled} disabled={selected?.managedBy === "agno"} onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))} />Enabled</label>
                <div className="md:col-span-2">
                  {selected?.managedBy === "agno" ? <div className="text-xs text-slate-400">Runtime skill gerenciada pelo Agno. Edite no runtime/catalog.</div> : <button className="btn-primary" onClick={() => void save()}>{selected ? "Save" : "Create"}</button>}
                </div>
              </div>
            ) : null}

            {tab === "linkedAgents" ? (
              <div className="space-y-3">
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Select linked agents</div>
                  <div className="grid gap-2 md:grid-cols-3">
                    {agents.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-2 text-xs text-slate-200">
                        <input
                          type="checkbox"
                          checked={form.linkedAgentIds.includes(agent.id)}
                          disabled={selected?.managedBy === "agno"}
                          onChange={(e) => setLinkedAgentChecked(agent.id, e.target.checked)}
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Current links</div>
                  {linkedAgentList.length ? (
                    <div className="grid gap-2 md:grid-cols-2">
                      {linkedAgentList.map((agent) => (
                        <div key={agent.id} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">{agent.name}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400">No linked agents.</div>
                  )}
                </div>
                {selected?.managedBy === "agno" ? <div className="text-xs text-slate-400">Runtime skill gerenciada pelo Agno. Vinculos devem ser sincronizados pelo catalogo runtime.</div> : <button className="btn-primary" onClick={() => void save()}>{selected ? "Save Links" : "Create Skill"}</button>}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
