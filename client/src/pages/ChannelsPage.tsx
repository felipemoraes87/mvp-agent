import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { AgentWithLinks, Team } from "../lib/types";

type ChannelConfig = {
  id: string;
  name: string;
  provider: "slack" | "discord" | "telegram" | "webhook";
  target: string;
  enabled: boolean;
  notes: string;
  linkedAgentId: string;
  messageFormat: "summary" | "bulletin" | "raw";
  ownerTeamId: string | null;
  visibility: "private" | "shared";
};

type ChannelTab = "overview" | "delivery" | "routing";

type ChannelForm = Omit<ChannelConfig, "id">;

const STORAGE_KEY = "studio.channels.config.v2";

const tabs: Array<{ id: ChannelTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "delivery", label: "Delivery" },
  { id: "routing", label: "Routing" },
];

const empty: ChannelForm = {
  name: "",
  provider: "slack",
  target: "",
  enabled: true,
  notes: "",
  linkedAgentId: "",
  messageFormat: "summary",
  ownerTeamId: null,
  visibility: "private",
};

function loadChannels(): ChannelConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChannelConfig[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toForm(channel: ChannelConfig): ChannelForm {
  return {
    name: channel.name,
    provider: channel.provider,
    target: channel.target,
    enabled: channel.enabled,
    notes: channel.notes,
    linkedAgentId: channel.linkedAgentId,
    messageFormat: channel.messageFormat,
    ownerTeamId: channel.ownerTeamId,
    visibility: channel.visibility,
  };
}

function avatarFallback(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ChannelsPage() { // NOSONAR
  const { user } = useAuth();
  const [tab, setTab] = useState<ChannelTab>("overview");
  const [status, setStatus] = useState("");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const [channels, setChannels] = useState<ChannelConfig[]>(() => loadChannels());
  const [selectedId, setSelectedId] = useState(() => loadChannels()[0]?.id || "");
  const [form, setForm] = useState<ChannelForm>(empty);

  useEffect(() => {
    void Promise.all([
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ teams: Team[] }>("/api/teams"),
    ])
      .then(([agentRes, teamRes]) => {
        setAgents(agentRes.agents);
        setTeams(teamRes.teams);
      })
      .catch(() => {
        setAgents([]);
        setTeams([]);
      });
  }, []);

  const visibleChannels = useMemo(() => {
    if (!user) return channels;
    if (user.role === "ADMIN" || user.role === "OPERATOR") return channels;
    return channels.filter((channel) => channel.visibility === "shared" || channel.ownerTeamId === user.teamId);
  }, [channels, user]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
    setSelectedId((current) => (visibleChannels.some((channel) => channel.id === current) ? current : (visibleChannels[0]?.id || "")));
  }, [channels, visibleChannels]);

  const selected = useMemo(() => visibleChannels.find((channel) => channel.id === selectedId) || null, [visibleChannels, selectedId]);

  useEffect(() => {
    if (!selected) {
      setForm(empty);
      return;
    }
    setForm(toForm(selected));
  }, [selected?.id]);

  const linkedAgent = useMemo(() => agents.find((agent) => agent.id === form.linkedAgentId) || null, [agents, form.linkedAgentId]);

  const startCreate = () => {
    setSelectedId("");
    setForm({ ...empty, linkedAgentId: agents[0]?.id || "", ownerTeamId: user?.teamId || teams[0]?.id || null });
    setTab("delivery");
  };

  const save = () => {
    const payload: ChannelConfig = {
      id: selected?.id || `channel-${Date.now()}`,
      name: form.name.trim(),
      provider: form.provider,
      target: form.target.trim(),
      enabled: form.enabled,
      notes: form.notes.trim(),
      linkedAgentId: form.linkedAgentId,
      messageFormat: form.messageFormat,
      ownerTeamId: form.ownerTeamId,
      visibility: form.visibility,
    };

    if (!payload.name || !payload.target) {
      setStatus("Channel name and target are required.");
      return;
    }

    if (selected) {
      setChannels((prev) => prev.map((item) => (item.id === selected.id ? payload : item)));
      setStatus("Channel updated.");
    } else {
      setChannels((prev) => [payload, ...prev]);
      setSelectedId(payload.id);
      setStatus("Channel created.");
    }
  };

  const removeSelected = () => {
    if (!selected) return;
    if (!window.confirm(`Delete channel "${selected.name}"?`)) return;
    setChannels((prev) => prev.filter((item) => item.id !== selected.id));
    setStatus("Channel removed.");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Channels</h2>
          <p className="text-sm text-slate-400">Delivery layer: output channels, routing targets, and agent identity projection.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => setChannels(loadChannels())}>Reload</button>
          <button className="btn-primary" onClick={startCreate}>New Channel</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 text-sm font-semibold text-slate-100">Channels</div>
          <div className="space-y-2">
            {visibleChannels.map((channel) => (
              <button
                key={channel.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedId === channel.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedId(channel.id)}
              >
                <div className="font-semibold text-slate-100">{channel.name}</div>
                <div className="text-xs uppercase text-slate-400">{channel.provider} | {channel.visibility} | {channel.enabled ? "enabled" : "disabled"}</div>
              </button>
            ))}
            {!channels.length ? <div className="text-xs text-slate-400">No channels configured yet.</div> : null}
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
              <div className="text-sm font-semibold text-slate-100">Channel Settings</div>
              {selected ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={removeSelected}>Delete</button> : null}
            </div>

            {tab === "overview" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Channel identity, provider and output destination summary.</div>
                {selected ? (
                  <div className="grid gap-3 md:grid-cols-3">
                    <div><div className="text-xs text-slate-400">Name</div><div className="text-sm text-slate-100">{selected.name}</div></div>
                    <div><div className="text-xs text-slate-400">Provider</div><div className="text-sm uppercase text-slate-100">{selected.provider}</div></div>
                    <div><div className="text-xs text-slate-400">Status</div><div className="text-sm text-slate-100">{selected.enabled ? "enabled" : "disabled"}</div></div>
                    <div><div className="text-xs text-slate-400">Visibility</div><div className="text-sm text-slate-100">{selected.visibility}</div></div>
                    <div><div className="text-xs text-slate-400">Target</div><div className="text-sm text-slate-100">{selected.target}</div></div>
                    <div><div className="text-xs text-slate-400">Format</div><div className="text-sm text-slate-100">{selected.messageFormat}</div></div>
                    <div><div className="text-xs text-slate-400">Linked Agent</div><div className="text-sm text-slate-100">{linkedAgent?.name || "none"}</div></div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">Create a channel in Delivery tab.</div>
                )}
              </div>
            ) : null}

            {tab === "delivery" ? (
              <div className="grid gap-2 md:grid-cols-2">
                <input className="input-dark" placeholder="Display name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
                <select className="input-dark" value={form.provider} onChange={(e) => setForm((s) => ({ ...s, provider: e.target.value as ChannelForm["provider"] }))}>
                  <option value="slack">Slack</option>
                  <option value="discord">Discord</option>
                  <option value="telegram">Telegram</option>
                  <option value="webhook">Webhook</option>
                </select>
                <select className="input-dark" value={form.ownerTeamId || ""} onChange={(e) => setForm((s) => ({ ...s, ownerTeamId: e.target.value || null }))}>
                  <option value="">No owner team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <select className="input-dark" value={form.visibility} onChange={(e) => setForm((s) => ({ ...s, visibility: e.target.value as ChannelForm["visibility"] }))}>
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
                <input className="input-dark md:col-span-2" placeholder="Target (channel id, webhook url, etc)" value={form.target} onChange={(e) => setForm((s) => ({ ...s, target: e.target.value }))} />
                <select className="input-dark" value={form.messageFormat} onChange={(e) => setForm((s) => ({ ...s, messageFormat: e.target.value as ChannelForm["messageFormat"] }))}>
                  <option value="summary">summary</option>
                  <option value="bulletin">bulletin</option>
                  <option value="raw">raw</option>
                </select>
                <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm((s) => ({ ...s, enabled: e.target.checked }))} />Enabled</label>
                <textarea className="input-dark md:col-span-2 min-h-20" placeholder="Operational notes" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
                <div className="md:col-span-2"><button className="btn-primary" onClick={save}>{selected ? "Save" : "Create"}</button></div>
              </div>
            ) : null}

            {tab === "routing" ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 text-xs text-slate-400">Linked Agent</div>
                  <select className="input-dark" value={form.linkedAgentId} onChange={(e) => setForm((s) => ({ ...s, linkedAgentId: e.target.value }))}>
                    <option value="">None</option>
                    {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                  </select>
                </div>

                {form.provider === "slack" ? (
                  <div className="rounded-md border border-slate-700 bg-slate-950/60 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Slack identity preview</div>
                    {linkedAgent ? (
                      <div className="flex items-center gap-2">
                        {linkedAgent.avatarUrl ? (
                          <img src={linkedAgent.avatarUrl} alt={`${linkedAgent.name} avatar`} className="h-8 w-8 rounded-full border border-slate-600 object-cover" />
                        ) : (
                          <div className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-xs">
                            {linkedAgent.emoji || avatarFallback(linkedAgent.name)}
                          </div>
                        )}
                        <div>
                          <div className="text-sm text-slate-100">{linkedAgent.emoji ? `${linkedAgent.emoji} ` : ""}{linkedAgent.name}</div>
                          <div className="text-xs text-slate-400">Posting to {form.target || "channel:not-configured"}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">Select an agent to preview Slack identity.</div>
                    )}
                  </div>
                ) : null}

                <button className="btn-primary" onClick={save}>{selected ? "Save Routing" : "Create Channel"}</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
