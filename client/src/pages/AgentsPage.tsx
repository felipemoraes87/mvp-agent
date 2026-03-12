import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { AgentWithLinks, Team, Tool } from "../lib/types";

type TabId = "settings" | "overview" | "advanced" | "files" | "tools" | "skills" | "channels" | "cron";

type AgentForm = {
  name: string;
  description: string;
  prompt: string;
  emoji: string;
  avatarUrl: string;
  tagsCsv: string;
  type: "SUPERVISOR" | "SPECIALIST" | "TICKET";
  isGlobal: boolean;
  visibility: "private" | "shared";
  teamId: string;
};

type SkillConfig = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
};

type ChannelConfig = {
  id: string;
  name: string;
  target: string;
  enabled: boolean;
  routeHint: string;
};

type CronConfig = {
  id: string;
  name: string;
  expression: string;
  action: string;
  enabled: boolean;
  lastRun: string;
  status: "success" | "error" | "idle";
};

type AgentPreferences = {
  primaryModel: string;
  fallbackModels: string;
  reasoningEnabled: boolean;
  temperature: number | "";
  maxTokens: number | "";
  addHistoryContext: boolean;
  historySessions: number | "";
  addStateContext: boolean;
  knowledgeMode: "agentic" | "references" | "hybrid";
  knowledgeMaxResults: number | "";
  knowledgeAddReferences: boolean;
  knowledgeContextFormat: "json" | "yaml";
  knowledgeFiltersJson: string;
};

const tabs: Array<{ id: TabId; label: string }> = [
  { id: "settings", label: "Settings" },
  { id: "overview", label: "Overview" },
  { id: "advanced", label: "Advanced" },
  { id: "files", label: "Files" },
  { id: "tools", label: "Tools" },
  { id: "skills", label: "Skills" },
  { id: "channels", label: "Channels" },
  { id: "cron", label: "Cron Jobs" },
];

const emptyAgentForm: AgentForm = {
  name: "",
  description: "",
  prompt: "",
  emoji: "",
  avatarUrl: "",
  tagsCsv: "",
  type: "SUPERVISOR",
  isGlobal: false,
  visibility: "private",
  teamId: "",
};

const fileNames = ["AGENTS.md", "SOUL.md", "TOOLS.md", "IDENTITY.md", "USER.md", "HEARTBEAT.md", "MEMORY.md"];

function typeLabel(type: AgentWithLinks["type"]) {
  if (type === "SUPERVISOR") return "General";
  if (type === "SPECIALIST") return "Specialist";
  return "Ticket";
}

function avatarFallback(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toAgentForm(agent: AgentWithLinks): AgentForm {
  return {
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    emoji: agent.emoji || "",
    avatarUrl: agent.avatarUrl || "",
    tagsCsv: agent.tags.join(", "),
    type: agent.type,
    isGlobal: agent.isGlobal,
    visibility: agent.visibility,
    teamId: agent.teamId || "",
  };
}

function skillsKey(agentId: string) {
  return `studio.agent.skills.${agentId}`;
}

function channelsKey(agentId: string) {
  return `studio.agent.channels.${agentId}`;
}

function cronKey(agentId: string) {
  return `studio.agent.cron.${agentId}`;
}

function defaultAgentPreferences(): AgentPreferences {
  return {
    primaryModel: "inherit default",
    fallbackModels: "",
    reasoningEnabled: false,
    temperature: 0.2,
    maxTokens: 1200,
    addHistoryContext: true,
    historySessions: 6,
    addStateContext: false,
    knowledgeMode: "hybrid",
    knowledgeMaxResults: 8,
    knowledgeAddReferences: true,
    knowledgeContextFormat: "json",
    knowledgeFiltersJson: "{}",
  };
}

function loadPreferences(agent: AgentWithLinks): AgentPreferences {
  const defaults = defaultAgentPreferences();
  return {
    primaryModel: agent.primaryModel || defaults.primaryModel,
    fallbackModels: agent.fallbackModels || defaults.fallbackModels,
    reasoningEnabled: Boolean(agent.reasoningEnabled),
    temperature: agent.temperature ?? defaults.temperature,
    maxTokens: agent.maxTokens ?? defaults.maxTokens,
    addHistoryContext: agent.addHistoryContext ?? defaults.addHistoryContext,
    historySessions: agent.historySessions ?? defaults.historySessions,
    addStateContext: Boolean(agent.addStateContext),
    knowledgeMode: agent.knowledgeMode || defaults.knowledgeMode,
    knowledgeMaxResults: agent.knowledgeMaxResults ?? defaults.knowledgeMaxResults,
    knowledgeAddReferences: agent.knowledgeAddReferences ?? true,
    knowledgeContextFormat: agent.knowledgeContextFormat || defaults.knowledgeContextFormat,
    knowledgeFiltersJson: JSON.stringify(agent.knowledgeFilters || {}, null, 2),
  };
}

function loadSkills(agent: AgentWithLinks): SkillConfig[] {
  const defaults: SkillConfig[] = [
    { id: "triage", name: "Incident Triage", description: "Classify incident context and next step.", enabled: true },
    { id: "policy", name: "Policy Mapping", description: "Map controls to actionable checks.", enabled: true },
    { id: "handoff", name: "Handoff Planner", description: "Prepare route to specialist/ticket.", enabled: true },
  ];
  try {
    const raw = localStorage.getItem(skillsKey(agent.id));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as SkillConfig[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaults;
  } catch {
    return defaults;
  }
}

function loadChannels(agent: AgentWithLinks): ChannelConfig[] {
  const defaults: ChannelConfig[] = [
    { id: `${agent.id}-slack`, name: "Slack", target: "channel:security-ops", enabled: true, routeHint: "alerts, incidents" },
    { id: `${agent.id}-api`, name: "API", target: "/api/agno/chat", enabled: true, routeHint: "internal clients" },
    { id: `${agent.id}-webhook`, name: "Webhook", target: "https://example/webhook", enabled: false, routeHint: "external ingestion" },
  ];
  try {
    const raw = localStorage.getItem(channelsKey(agent.id));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as ChannelConfig[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaults;
  } catch {
    return defaults;
  }
}

function loadCron(agent: AgentWithLinks): CronConfig[] {
  const defaults: CronConfig[] = [
    {
      id: `${agent.id}-daily-check`,
      name: "Daily Health Check",
      expression: "0 8 * * *",
      action: "run agent health summary",
      enabled: true,
      lastRun: "-",
      status: "idle",
    },
  ];
  try {
    const raw = localStorage.getItem(cronKey(agent.id));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as CronConfig[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaults;
  } catch {
    return defaults;
  }
}

export function AgentsPage() { // NOSONAR
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<TabId>("overview");

  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyAgentForm);

  const [selectedFile, setSelectedFile] = useState(fileNames[0]);
  const [prefs, setPrefs] = useState<AgentPreferences>(defaultAgentPreferences);
  const [skills, setSkills] = useState<SkillConfig[]>([]);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [cronJobs, setCronJobs] = useState<CronConfig[]>([]);

  const onAvatarFileSelected = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      if (!result.startsWith("data:image/")) {
        setStatus("Invalid image file.");
        return;
      }
      setForm((s) => ({ ...s, avatarUrl: result }));
    };
    reader.onerror = () => setStatus("Failed reading image file.");
    reader.readAsDataURL(file);
  };

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [a, t, tl] = await Promise.all([
        apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
        apiGet<{ teams: Team[] }>("/api/teams"),
        apiGet<{ tools: Tool[] }>("/api/tools"),
      ]);
      setAgents(a.agents);
      setTeams(t.teams);
      setTools(tl.tools);
      const fallbackId = a.agents[0]?.id || "";
      setSelectedAgentId((current) => (a.agents.some((x) => x.id === current) ? current : fallbackId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed loading agents.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(() => agents.find((a) => a.id === selectedAgentId) || null, [agents, selectedAgentId]);
  const selectedTeam = selected ? teams.find((t) => t.id === selected.teamId) : null;

  useEffect(() => {
    if (!selected) return;
    setEditingId(selected.id);
    setForm(toAgentForm(selected));
    setSelectedFile("AGENTS.md");
    setPrefs(loadPreferences(selected));
    setSkills(loadSkills(selected));
    setChannels(loadChannels(selected));
    setCronJobs(loadCron(selected));
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(skillsKey(selected.id), JSON.stringify(skills));
  }, [skills, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(channelsKey(selected.id), JSON.stringify(channels));
  }, [channels, selected?.id]);

  useEffect(() => {
    if (!selected) return;
    localStorage.setItem(cronKey(selected.id), JSON.stringify(cronJobs));
  }, [cronJobs, selected?.id]);

  const startCreate = () => {
    setShowForm(true);
    setEditingId(null);
    setForm({ ...emptyAgentForm, teamId: teams[0]?.id || "" });
    setPrefs(defaultAgentPreferences());
  };

  const saveAgent = async () => {
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        prompt: form.prompt.trim(),
        emoji: form.emoji.trim() || null,
        avatarUrl: form.avatarUrl.trim() || null,
        primaryModel: prefs.primaryModel === "inherit default" ? null : prefs.primaryModel,
        fallbackModels: prefs.fallbackModels.trim() || null,
        reasoningEnabled: prefs.reasoningEnabled,
        temperature: prefs.temperature === "" ? null : Number(prefs.temperature),
        maxTokens: prefs.maxTokens === "" ? null : Number(prefs.maxTokens),
        addHistoryContext: prefs.addHistoryContext,
        historySessions: prefs.historySessions === "" ? null : Number(prefs.historySessions),
        addStateContext: prefs.addStateContext,
        knowledgeMode: prefs.knowledgeMode,
        knowledgeMaxResults: prefs.knowledgeMaxResults === "" ? null : Number(prefs.knowledgeMaxResults),
        knowledgeAddReferences: prefs.knowledgeAddReferences,
        knowledgeContextFormat: prefs.knowledgeContextFormat,
        knowledgeFilters: (() => {
          try {
            return JSON.parse(prefs.knowledgeFiltersJson || "{}");
          } catch {
            return {};
          }
        })(),
        tags: form.tagsCsv.split(",").map((x) => x.trim()).filter(Boolean),
        type: form.type,
        isGlobal: form.isGlobal,
        visibility: form.visibility,
        teamId: form.isGlobal ? null : form.teamId || null,
      };
      if (editingId) await apiPut(`/api/agents/${editingId}`, payload);
      else await apiPost("/api/agents", payload);
      setShowForm(false);
      setForm(emptyAgentForm);
      await load();
      setStatus(editingId ? "Agent updated." : "Agent created.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed saving agent.");
    }
  };

  const removeAgent = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete agent "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/agents/${selected.id}`);
      await load();
      setStatus("Agent removed.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed removing agent.");
    }
  };

  const assignTool = async (toolId: string) => {
    if (!selected) return;
    const tool = tools.find((t) => t.id === toolId);
    if (!tool) return;
    try {
      await apiPost(`/api/agents/${selected.id}/tools`, {
        toolId,
        canRead: true,
        canWrite: tool.policy === "write" && selected.type === "TICKET",
        justification: "Assigned from agents tools tab",
      });
      await load();
      setStatus("Tool linked.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed linking tool.");
    }
  };

  const removeTool = async (toolId: string) => {
    if (!selected) return;
    const toolName = selected.toolLinks?.find((link) => link.toolId === toolId)?.tool.name || "this tool";
    if (!window.confirm(`Remove "${toolName}" from agent "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/agents/${selected.id}/tools/${toolId}`);
      await load();
      setStatus("Tool unlinked.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed unlinking tool.");
    }
  };

  const setSkillEnabled = (skillId: string, enabled: boolean) => {
    setSkills((prev) => prev.map((skill) => (skill.id === skillId ? { ...skill, enabled } : skill)));
  };

  const setChannelEnabled = (channelId: string, enabled: boolean) => {
    setChannels((prev) => prev.map((channel) => (channel.id === channelId ? { ...channel, enabled } : channel)));
  };

  const setChannelField = (channelId: string, field: "target" | "routeHint", value: string) => {
    setChannels((prev) =>
      prev.map((channel) => (channel.id === channelId ? { ...channel, [field]: value } : channel)),
    );
  };

  const setCronField = (jobId: string, field: "name" | "expression" | "action", value: string) => {
    setCronJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, [field]: value } : job)));
  };

  const setCronEnabled = (jobId: string, enabled: boolean) => {
    setCronJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, enabled } : job)));
  };

  const fileContent = useMemo(() => {
    if (!selected) return "";
    const identity = `# ${selected.name}\nType: ${typeLabel(selected.type)}\nScope: ${selected.visibility} (${selected.isGlobal ? "global" : selectedTeam?.name || "team"})`;
    const toolsList = (selected.toolLinks || []).map((link) => `- ${link.tool.name} (read:${link.canRead}, write:${link.canWrite})`).join("\n") || "No tools linked.";
    const mapping: Record<string, string> = {
      "AGENTS.md": selected.prompt,
      "SOUL.md": selected.description || "Agent mission and operating behavior.",
      "TOOLS.md": toolsList,
      "IDENTITY.md": identity,
      "USER.md": selected.tags.join(", ") || "No user tags mapped.",
      "HEARTBEAT.md": "No heartbeat instructions configured.",
      "MEMORY.md": "No persisted memory for this agent.",
    };
    return mapping[selectedFile] || "";
  }, [selected, selectedFile, selectedTeam?.name]);

  const availableTools = useMemo(() => {
    if (!selected) return [];
    const linked = new Set((selected.toolLinks || []).map((l) => l.toolId));
    return tools.filter((t) => !linked.has(t.id));
  }, [tools, selected]);

  const advancedDefaults = useMemo(() => defaultAgentPreferences(), []);
  const advancedProfileCustomized =
    prefs.primaryModel !== advancedDefaults.primaryModel ||
    prefs.fallbackModels.trim() !== advancedDefaults.fallbackModels ||
    prefs.reasoningEnabled !== advancedDefaults.reasoningEnabled ||
    prefs.temperature !== advancedDefaults.temperature ||
    prefs.maxTokens !== advancedDefaults.maxTokens ||
    prefs.addHistoryContext !== advancedDefaults.addHistoryContext ||
    prefs.historySessions !== advancedDefaults.historySessions ||
    prefs.addStateContext !== advancedDefaults.addStateContext ||
    prefs.knowledgeMode !== advancedDefaults.knowledgeMode ||
    prefs.knowledgeMaxResults !== advancedDefaults.knowledgeMaxResults ||
    prefs.knowledgeAddReferences !== advancedDefaults.knowledgeAddReferences ||
    prefs.knowledgeContextFormat !== advancedDefaults.knowledgeContextFormat ||
    prefs.knowledgeFiltersJson.trim() !== advancedDefaults.knowledgeFiltersJson;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Agents</h2>
          <p className="text-sm text-slate-400">Manage agent workspaces, tools, and identities.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
          <button className="btn-primary" onClick={startCreate}>New Agent</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

      {showForm ? (
        <div className="panel p-4">
          <div className="mb-2 text-sm font-semibold text-slate-100">{editingId ? "Edit Agent" : "Create Agent"}</div>
          <div className="grid gap-2 md:grid-cols-2">
            <input className="input-dark" placeholder="name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
            <select className="input-dark" value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value as AgentForm["type"] }))}>
              <option value="SUPERVISOR">General</option>
              <option value="SPECIALIST">Specialist</option>
              <option value="TICKET">Ticket</option>
            </select>
            <input className="input-dark" placeholder="emoji (ex: 🤖)" value={form.emoji} onChange={(e) => setForm((s) => ({ ...s, emoji: e.target.value }))} />
            <input className="input-dark" placeholder="avatar URL (https://...)" value={form.avatarUrl} onChange={(e) => setForm((s) => ({ ...s, avatarUrl: e.target.value }))} />
            <input className="input-dark md:col-span-2" placeholder="description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
            <textarea className="input-dark md:col-span-2 min-h-20" placeholder="prompt" value={form.prompt} onChange={(e) => setForm((s) => ({ ...s, prompt: e.target.value }))} />
            <input className="input-dark" placeholder="tags csv" value={form.tagsCsv} onChange={(e) => setForm((s) => ({ ...s, tagsCsv: e.target.value }))} />
            <select className="input-dark" value={form.teamId} onChange={(e) => setForm((s) => ({ ...s, teamId: e.target.value }))} disabled={form.isGlobal}>
              <option value="">Global</option>
              {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>Upload photo</span>
              <input type="file" accept="image/*" onChange={(e) => onAvatarFileSelected(e.target.files?.[0] || null)} />
            </label>
            <select className="input-dark" value={form.visibility} onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as AgentForm["visibility"] }))}>
              <option value="private">private</option>
              <option value="shared">shared</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.isGlobal} onChange={(e) => setForm((s) => ({ ...s, isGlobal: e.target.checked }))} />Legacy global</label>
            <div className="md:col-span-2 flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/35 px-3 py-2 text-xs text-slate-300">
              {form.avatarUrl ? (
                <img src={form.avatarUrl} alt="avatar preview" className="h-8 w-8 rounded-full border border-slate-600 object-cover" />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[10px] font-semibold text-slate-300">
                  {avatarFallback(form.name || "Agent")}
                </div>
              )}
              <span>{form.emoji || "🙂"} Avatar preview</span>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => void saveAgent()}>Save</button>
            <button className="btn-ghost" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Agents</div>
              <div className="text-xs text-slate-400">{agents.length} configured.</div>
            </div>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void load()}>Refresh</button>
          </div>

          {loading ? <div className="text-xs text-slate-400">Loading...</div> : null}

          <div className="space-y-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedAgentId === agent.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {agent.avatarUrl ? (
                      <img src={agent.avatarUrl} alt={`${agent.name} avatar`} className="h-8 w-8 rounded-full border border-slate-600 object-cover" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-xs font-semibold text-slate-200">
                        {agent.emoji || avatarFallback(agent.name)}
                      </div>
                    )}
                    <div>
                    <div className="font-semibold text-slate-100">{agent.name}</div>
                    <div className="text-xs text-slate-400">{agent.visibility} | {agent.isGlobal ? "main" : teams.find((t) => t.id === agent.teamId)?.key || "team"}</div>
                    </div>
                  </div>
                  {agent.visibility === "shared" ? <span className="rounded-md border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400">shared</span> : null}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {!selected ? (
            <div className="panel p-4 text-slate-400">Select an agent.</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {tabs.map((item) => (
                  <button key={item.id} className={`rounded-full px-4 py-2 text-sm ${tab === item.id ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-200"}`} onClick={() => setTab(item.id)}>{item.label}</button>
                ))}
              </div>

              {tab === "settings" ? (
                <div className="panel p-4">
                  <div className="mb-2 text-sm font-semibold text-slate-100">Settings</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    <input className="input-dark" placeholder="name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                    <select className="input-dark" value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value as AgentForm["type"] }))}>
                      <option value="SUPERVISOR">General</option>
                      <option value="SPECIALIST">Specialist</option>
                      <option value="TICKET">Ticket</option>
                    </select>
                    <input className="input-dark" placeholder="emoji (ex: 🤖)" value={form.emoji} onChange={(e) => setForm((s) => ({ ...s, emoji: e.target.value }))} />
                    <input className="input-dark" placeholder="avatar URL (https://...)" value={form.avatarUrl} onChange={(e) => setForm((s) => ({ ...s, avatarUrl: e.target.value }))} />
                    <input className="input-dark md:col-span-2" placeholder="description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
                    <textarea className="input-dark md:col-span-2 min-h-20" placeholder="prompt" value={form.prompt} onChange={(e) => setForm((s) => ({ ...s, prompt: e.target.value }))} />
                    <input className="input-dark" placeholder="tags csv" value={form.tagsCsv} onChange={(e) => setForm((s) => ({ ...s, tagsCsv: e.target.value }))} />
                    <select className="input-dark" value={form.teamId} onChange={(e) => setForm((s) => ({ ...s, teamId: e.target.value }))} disabled={form.isGlobal}>
                      <option value="">Global</option>
                      {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                    </select>
                    <label className="flex items-center gap-2 text-xs text-slate-300">
                      <span>Upload photo</span>
                      <input type="file" accept="image/*" onChange={(e) => onAvatarFileSelected(e.target.files?.[0] || null)} />
                    </label>
                    <select className="input-dark" value={form.visibility} onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as AgentForm["visibility"] }))}>
                      <option value="private">private</option>
                      <option value="shared">shared</option>
                    </select>
                    <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.isGlobal} onChange={(e) => setForm((s) => ({ ...s, isGlobal: e.target.checked }))} />Legacy global</label>
                    <div className="md:col-span-2 flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/35 px-3 py-2 text-xs text-slate-300">
                      {form.avatarUrl ? (
                        <img src={form.avatarUrl} alt="avatar preview" className="h-8 w-8 rounded-full border border-slate-600 object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-[10px] font-semibold text-slate-300">
                          {avatarFallback(form.name || "Agent")}
                        </div>
                      )}
                      <span>{form.emoji || "🙂"} Avatar preview</span>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="btn-primary" onClick={() => void saveAgent()}>Save</button>
                    <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeAgent()}>Delete</button>
                  </div>
                </div>
              ) : null}

              {tab === "overview" ? (
                <div className="panel p-4">
                  <div className="mb-2 text-lg font-semibold text-slate-100">Overview</div>
                  <div className="text-sm text-slate-400">Identity, scope and linked capabilities for this workspace.</div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <div>
                      <div className="text-xs text-slate-400">Workspace</div>
                      <div className="text-sm text-slate-100">/workspace/agents/{selected.name.toLowerCase().replace(/\s+/g, "-")}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Identity Name</div>
                      <div className="text-sm text-slate-100">{selected.name}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Visibility</div>
                      <div className="text-sm text-slate-100">{selected.visibility}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Owner Team</div>
                      <div className="text-sm text-slate-100">{selected.isGlobal ? "Global" : selectedTeam?.key || "Unassigned"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Type</div>
                      <div className="text-sm text-slate-100">{typeLabel(selected.type)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Identity Emoji</div>
                      <div className="text-sm text-slate-100">{selected.emoji || "-"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Avatar</div>
                      <div className="text-sm text-slate-100">{selected.avatarUrl ? "configured" : "not set"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Tags</div>
                      <div className="text-sm text-slate-100">{selected.tags.length ? selected.tags.join(", ") : "No tags"}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-400">Advanced Profile</div>
                      <div className="text-sm text-slate-100">{advancedProfileCustomized ? "Customized" : "Defaults"}</div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-4">
                    <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Prompt</div>
                      <div className="mt-2 text-sm text-slate-200">{selected.prompt || "No prompt configured."}</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Knowledge</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">{selected.knowledgeLinks?.length || 0}</div>
                      <div className="text-xs text-slate-400">Linked knowledge sources</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Tools</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-100">{selected.toolLinks?.length || 0}</div>
                      <div className="text-xs text-slate-400">Connected tools</div>
                    </div>
                    <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-3">
                      <div className="text-xs uppercase tracking-wider text-slate-400">Runtime</div>
                      <div className="mt-2 text-sm text-slate-100">{prefs.primaryModel}</div>
                      <div className="text-xs text-slate-400">Open Advanced to tune model and context.</div>
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "advanced" ? (
                <div className="panel p-4 space-y-4">
                  <div>
                    <div className="text-lg font-semibold text-slate-100">Advanced</div>
                    <div className="text-sm text-slate-400">Runtime tuning for specialists. Defaults are preloaded for the most common setup.</div>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">Model and Runtime</div>
                        <div className="text-xs text-slate-400">Token budget, sampling and fallback behavior.</div>
                      </div>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPrefs((p) => ({ ...p, primaryModel: advancedDefaults.primaryModel, fallbackModels: advancedDefaults.fallbackModels, reasoningEnabled: advancedDefaults.reasoningEnabled, temperature: advancedDefaults.temperature, maxTokens: advancedDefaults.maxTokens }))}>Reset section</button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Primary model</div>
                        <select className="input-dark" value={prefs.primaryModel} onChange={(e) => setPrefs((p) => ({ ...p, primaryModel: e.target.value }))}>
                          <option value="inherit default">Inherit default</option>
                          <option value="openai/gpt-5">openai/gpt-5</option>
                          <option value="openai/gpt-4o-mini">openai/gpt-4o-mini</option>
                          <option value="ollama/qwen2.5:3b">ollama/qwen2.5:3b</option>
                        </select>
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Fallback models</div>
                        <input className="input-dark" value={prefs.fallbackModels} onChange={(e) => setPrefs((p) => ({ ...p, fallbackModels: e.target.value }))} placeholder="provider/model, provider/model" />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Temperature</div>
                        <input className="input-dark" type="number" step="0.1" min={0} max={2} value={prefs.temperature} onChange={(e) => setPrefs((p) => ({ ...p, temperature: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="0.0 - 2.0" />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Max tokens</div>
                        <input className="input-dark" type="number" min={64} max={8192} value={prefs.maxTokens} onChange={(e) => setPrefs((p) => ({ ...p, maxTokens: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="64 - 8192" />
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={prefs.reasoningEnabled} onChange={(e) => setPrefs((p) => ({ ...p, reasoningEnabled: e.target.checked }))} />Enable reasoning mode</label>
                    </div>
                  </div>

                  <div className="rounded-lg border border-slate-700 bg-slate-900/35 p-4">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">Context and Knowledge</div>
                        <div className="text-xs text-slate-400">Conversation context, retrieval and reference behavior.</div>
                      </div>
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setPrefs((p) => ({ ...p, addHistoryContext: advancedDefaults.addHistoryContext, historySessions: advancedDefaults.historySessions, addStateContext: advancedDefaults.addStateContext, knowledgeMode: advancedDefaults.knowledgeMode, knowledgeMaxResults: advancedDefaults.knowledgeMaxResults, knowledgeAddReferences: advancedDefaults.knowledgeAddReferences, knowledgeContextFormat: advancedDefaults.knowledgeContextFormat, knowledgeFiltersJson: advancedDefaults.knowledgeFiltersJson }))}>Reset section</button>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={prefs.addHistoryContext} onChange={(e) => setPrefs((p) => ({ ...p, addHistoryContext: e.target.checked }))} />Add history context</label>
                      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={prefs.addStateContext} onChange={(e) => setPrefs((p) => ({ ...p, addStateContext: e.target.checked }))} />Add state context</label>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">History sessions</div>
                        <input className="input-dark" type="number" min={1} max={20} value={prefs.historySessions} onChange={(e) => setPrefs((p) => ({ ...p, historySessions: e.target.value === "" ? "" : Number(e.target.value) }))} placeholder="1 - 20" disabled={!prefs.addHistoryContext} />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Knowledge mode</div>
                        <select className="input-dark" value={prefs.knowledgeMode} onChange={(e) => setPrefs((p) => ({ ...p, knowledgeMode: e.target.value as AgentPreferences["knowledgeMode"] }))}>
                          <option value="agentic">agentic</option>
                          <option value="references">references</option>
                          <option value="hybrid">hybrid</option>
                        </select>
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Knowledge max results</div>
                        <input className="input-dark" type="number" min={1} max={50} value={prefs.knowledgeMaxResults} onChange={(e) => setPrefs((p) => ({ ...p, knowledgeMaxResults: e.target.value === "" ? "" : Number(e.target.value) }))} />
                      </div>
                      <div>
                        <div className="mb-1 text-xs text-slate-400">Knowledge context format</div>
                        <select className="input-dark" value={prefs.knowledgeContextFormat} onChange={(e) => setPrefs((p) => ({ ...p, knowledgeContextFormat: e.target.value as AgentPreferences["knowledgeContextFormat"] }))}>
                          <option value="json">json</option>
                          <option value="yaml">yaml</option>
                        </select>
                      </div>
                      <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={prefs.knowledgeAddReferences} onChange={(e) => setPrefs((p) => ({ ...p, knowledgeAddReferences: e.target.checked }))} />Add references to answers</label>
                      <div className="md:col-span-2">
                        <div className="mb-1 text-xs text-slate-400">Knowledge filters (JSON)</div>
                        <textarea className="input-dark min-h-20 font-mono text-xs" value={prefs.knowledgeFiltersJson} onChange={(e) => setPrefs((p) => ({ ...p, knowledgeFiltersJson: e.target.value }))} />
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button className="btn-primary" onClick={() => void saveAgent()}>Save Advanced Settings</button>
                    <button className="btn-ghost" onClick={() => setPrefs(defaultAgentPreferences())}>Reset to defaults</button>
                  </div>
                </div>
              ) : null}

              {tab === "files" ? (
                <div className="panel p-4 grid gap-3 lg:grid-cols-[260px_1fr]">
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-100">Core Files</div>
                    <div className="space-y-2">
                      {fileNames.map((name) => (
                        <button key={name} className={`w-full rounded-md border px-3 py-2 text-left ${selectedFile === name ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`} onClick={() => setSelectedFile(name)}>
                          <div className="text-sm font-semibold text-slate-100">{name}</div>
                          <div className="text-[11px] text-slate-400">workspace/{name}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-100">{selectedFile}</div>
                    <textarea className="input-dark min-h-[520px] font-mono text-xs" readOnly value={fileContent} />
                  </div>
                </div>
              ) : null}

              {tab === "tools" ? (
                <div className="panel p-4 space-y-4">
                  <div className="text-sm font-semibold text-slate-100">Connected Tools</div>
                  <div className="overflow-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-700 text-slate-400">
                          <th className="py-2">Name</th>
                          <th className="py-2">Type</th>
                          <th className="py-2">Policy</th>
                          <th className="py-2">Permissions</th>
                          <th className="py-2">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selected.toolLinks || []).map((link) => (
                          <tr key={link.id} className="border-b border-slate-800/70 text-slate-200">
                            <td className="py-2 font-semibold">{link.tool.name}</td>
                            <td className="py-2">{link.tool.type}</td>
                            <td className="py-2">{link.tool.policy}</td>
                            <td className="py-2">read:{String(link.canRead)} write:{String(link.canWrite)}</td>
                            <td className="py-2"><button className="btn-ghost px-2 py-1 text-xs" onClick={() => void removeTool(link.toolId)}>Remove</button></td>
                          </tr>
                        ))}
                        {!(selected.toolLinks || []).length ? (
                          <tr><td colSpan={5} className="py-3 text-slate-400">No tools connected.</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Add tool</div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {availableTools.slice(0, 9).map((tool) => (
                        <button key={tool.id} className="btn-ghost text-xs" onClick={() => void assignTool(tool.id)}>{tool.name}</button>
                      ))}
                      {!availableTools.length ? <div className="text-xs text-slate-400">No tools available for linking.</div> : null}
                    </div>
                  </div>
                </div>
              ) : null}

              {tab === "skills" ? (
                <div className="panel p-4 space-y-3">
                  <div className="text-sm font-semibold text-slate-100">Skills</div>
                  <div className="space-y-2">
                    {skills.map((skill) => (
                      <div key={skill.id} className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-semibold text-slate-100">{skill.name}</div>
                            <div className="text-xs text-slate-400">{skill.description}</div>
                          </div>
                          <label className="flex items-center gap-2 text-xs text-slate-300">
                            <input type="checkbox" checked={skill.enabled} onChange={(e) => setSkillEnabled(skill.id, e.target.checked)} />
                            <span>Enabled</span>
                          </label>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {tab === "channels" ? (
                <div className="panel p-4 space-y-3">
                  <div className="text-sm font-semibold text-slate-100">Channels</div>
                  {channels.map((channel) => (
                    <div key={channel.id} className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                      <div className="grid gap-2 md:grid-cols-2">
                        <div>
                          <div className="text-xs text-slate-400">Name</div>
                          <div className="text-sm text-slate-100">{channel.name}</div>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-slate-300 md:justify-end">
                          <input type="checkbox" checked={channel.enabled} onChange={(e) => setChannelEnabled(channel.id, e.target.checked)} />
                          <span>Enabled</span>
                        </label>
                        <div>
                          <div className="text-xs text-slate-400">Target</div>
                          <input className="input-dark" value={channel.target} onChange={(e) => setChannelField(channel.id, "target", e.target.value)} />
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Route hint</div>
                          <input className="input-dark" value={channel.routeHint} onChange={(e) => setChannelField(channel.id, "routeHint", e.target.value)} />
                        </div>
                      </div>
                      {channel.name.toLowerCase().includes("slack") ? (
                        <div className="mt-3 rounded-md border border-slate-700 bg-slate-950/60 p-3">
                          <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Slack identity preview</div>
                          <div className="flex items-center gap-2">
                            {selected.avatarUrl ? (
                              <img src={selected.avatarUrl} alt={`${selected.name} slack avatar`} className="h-8 w-8 rounded-full border border-slate-600 object-cover" />
                            ) : (
                              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-xs">
                                {selected.emoji || avatarFallback(selected.name)}
                              </div>
                            )}
                            <div>
                              <div className="text-sm text-slate-100">
                                {selected.emoji ? `${selected.emoji} ` : ""}
                                {selected.name}
                              </div>
                              <div className="text-xs text-slate-400">Posting to {channel.target || "channel:not-configured"}</div>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {tab === "cron" ? (
                <div className="panel p-4 space-y-3">
                  <div className="text-sm font-semibold text-slate-100">Cron Jobs</div>
                  {cronJobs.map((job) => (
                    <div key={job.id} className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                      <div className="grid gap-2 md:grid-cols-3">
                        <div>
                          <div className="text-xs text-slate-400">Name</div>
                          <input className="input-dark" value={job.name} onChange={(e) => setCronField(job.id, "name", e.target.value)} />
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Cron</div>
                          <input className="input-dark" value={job.expression} onChange={(e) => setCronField(job.id, "expression", e.target.value)} />
                        </div>
                        <div>
                          <div className="text-xs text-slate-400">Action</div>
                          <input className="input-dark" value={job.action} onChange={(e) => setCronField(job.id, "action", e.target.value)} />
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-300">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={job.enabled} onChange={(e) => setCronEnabled(job.id, e.target.checked)} />
                          <span>Enabled</span>
                        </label>
                        <span>Last run: {job.lastRun} ({job.status})</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
