import { useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { AgentWithLinks, Team, Tool } from "../lib/types";
import { ToolBadge } from "../components/ToolBadge";
import { HelpTip } from "../components/HelpTip";

type ToolTab = "overview" | "configuration" | "assignments";

type ToolForm = Omit<Tool, "id" | "managedBy" | "runtimeSource" | "userCustomized" | "customizationNote" | "customizationUpdatedAt"> & {
  userCustomized?: boolean;
  customizationNote?: string | null;
};

const tabs: Array<{ id: ToolTab; label: string }> = [
  { id: "overview", label: "Biblioteca" },
  { id: "configuration", label: "Configuracao" },
  { id: "assignments", label: "Uso" },
];

const empty: ToolForm = {
  name: "",
  description: "",
  callName: "",
  transport: "http",
  endpoint: "",
  method: "POST",
  authRef: "",
  timeoutMs: 15000,
  type: "internal",
  mode: "mock",
  policy: "read",
  riskLevel: "low",
  dataClassificationIn: "internal",
  dataClassificationOut: "internal",
  inputSchema: {},
  outputSchema: {},
  rateLimitPerMinute: 60,
  visibility: "private",
  teamId: null,
};

function getTeamLabel(teams: Team[], teamId: string | null) {
  if (!teamId) return "NO OWNER";
  return teams.find((team) => team.id === teamId)?.key || "team";
}

function FieldLabel({ label, tip }: { label: string; tip: string }) {
  return (
    <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">
      {label}
      <HelpTip text={tip} />
    </div>
  );
}

export function ToolsPage() { // NOSONAR
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<ToolTab>("overview");

  const [tools, setTools] = useState<Tool[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [selectedToolId, setSelectedToolId] = useState("");

  const [form, setForm] = useState<ToolForm>(empty);
  const [rawInputSchema, setRawInputSchema] = useState("{}");
  const [rawOutputSchema, setRawOutputSchema] = useState("{}");

  const load = async () => {
    try {
      setLoading(true);
      setError("");
      const [toolRes, teamRes, agentRes] = await Promise.all([
        apiGet<{ tools: Tool[] }>("/api/tools"),
        apiGet<{ teams: Team[] }>("/api/teams"),
        apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      ]);
      setTools(toolRes.tools);
      setTeams(teamRes.teams);
      setAgents(agentRes.agents);
      setSelectedToolId((current) => (toolRes.tools.some((tool) => tool.id === current) ? current : (toolRes.tools[0]?.id || "")));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed loading tools.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const selected = useMemo(() => tools.find((tool) => tool.id === selectedToolId) || null, [tools, selectedToolId]);

  useEffect(() => {
    if (!selected) {
      setForm(empty);
      setRawInputSchema("{}");
      setRawOutputSchema("{}");
      return;
    }
    setForm({ ...selected });
    setRawInputSchema(JSON.stringify(selected.inputSchema, null, 2));
    setRawOutputSchema(JSON.stringify(selected.outputSchema, null, 2));
  }, [selected?.id]);

  const linkedAgents = useMemo(() => {
    if (!selected) return [];
    return agents.filter((agent) => (agent.toolLinks || []).some((link) => link.toolId === selected.id));
  }, [agents, selected]);

  const startCreate = () => {
    setSelectedToolId("");
    setTab("configuration");
    setForm(empty);
    setRawInputSchema("{}");
    setRawOutputSchema("{}");
  };

  const save = async () => {
    try {
      const payload: ToolForm = {
        ...form,
        name: form.name.trim(),
        description: form.description?.trim() || null,
        callName: form.callName?.trim() || null,
        transport: form.transport?.trim() || null,
        endpoint: form.endpoint?.trim() || null,
        method: form.method?.trim().toUpperCase() || null,
        authRef: form.authRef?.trim() || null,
        timeoutMs: form.timeoutMs || null,
        inputSchema: JSON.parse(rawInputSchema || "{}"),
        outputSchema: JSON.parse(rawOutputSchema || "{}"),
      };
      if (!payload.name) {
        setStatus("Tool name is required.");
        return;
      }

      if (selected) {
        const updated = await apiPut<{ tool: Tool }>(`/api/tools/${selected.id}`, payload);
        setStatus("Tool updated.");
        await load();
        setSelectedToolId(updated.tool.id);
      } else {
        const created = await apiPost<{ tool: Tool }>("/api/tools", payload);
        setStatus("Tool created.");
        await load();
        setSelectedToolId(created.tool.id);
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setStatus("Invalid JSON schema.");
        return;
      }
      setStatus(err instanceof Error ? err.message : "Failed saving tool.");
    }
  };

  const removeSelected = async () => {
    if (!selected) return;
    if (!window.confirm(`Delete tool "${selected.name}"?`)) return;
    try {
      await apiDelete(`/api/tools/${selected.id}`);
      setStatus("Tool removed.");
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed removing tool.");
    }
  };

  const saveCustomization = async () => {
    if (!selected) return;
    try {
      const updated = await apiPut<{ tool: Tool }>(`/api/tools/${selected.id}/customization`, {
        userCustomized: Boolean(form.userCustomized),
        customizationNote: form.customizationNote?.trim() || null,
      });
      setStatus(updated.tool.userCustomized ? "Protecao de customizacao salva." : "Protecao de customizacao removida.");
      await load();
      setSelectedToolId(updated.tool.id);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Failed saving customization protection.");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-100">Tools</h2>
          <p className="text-sm text-slate-400">Biblioteca de ferramentas. Itens `Agno` representam runtime instalado; itens `portal` sao wrappers simples administrados pela interface.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost" onClick={() => void load()}>Refresh</button>
          <button className="btn-primary" onClick={startCreate}>New Tool</button>
        </div>
      </div>

      {status ? <div className="rounded-md border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-100">{status}</div> : null}
      {error ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">{error}</div> : null}

      <div className="grid gap-4 xl:grid-cols-[300px_1fr]">
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-100">Tools</div>
              <div className="text-xs text-slate-400">{tools.length} configured.</div>
            </div>
            <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void load()}>Refresh</button>
          </div>

          {loading ? <div className="text-xs text-slate-400">Loading...</div> : null}

          <div className="space-y-2">
            {tools.map((tool) => (
              <button
                key={tool.id}
                className={`w-full rounded-lg border px-3 py-3 text-left transition ${selectedToolId === tool.id ? "border-rose-400 bg-rose-500/10" : "border-slate-700 bg-slate-900/35"}`}
                onClick={() => setSelectedToolId(tool.id)}
              >
                <div className="font-semibold text-slate-100">{tool.name}</div>
                <div className="text-xs text-slate-400">{tool.type} | {tool.visibility} | {getTeamLabel(teams, tool.teamId)}</div>
                {tool.userCustomized ? <div className="mt-2 text-[10px] uppercase tracking-wider text-amber-300">custom protegido</div> : null}
              </button>
            ))}
            {!tools.length ? <div className="text-xs text-slate-400">No tools created yet.</div> : null}
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
              <div className="text-sm font-semibold text-slate-100">Tool Settings</div>
              {selected && selected.managedBy !== "agno" ? <button className="rounded-md border border-rose-500/50 bg-rose-500/15 px-3 py-2 text-sm text-rose-200" onClick={() => void removeSelected()}>Delete</button> : null}
            </div>

            {tab === "overview" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Identity and governance metadata.</div>
                {selected ? (
                  <div className="grid gap-3 md:grid-cols-4">
                    <div><div className="text-xs text-slate-400">Tool</div><div className="mt-1"><ToolBadge tool={selected} /></div></div>
                    <div><div className="text-xs text-slate-400">Call Name</div><div className="text-sm text-slate-100">{selected.callName || "-"}</div></div>
                    <div><div className="text-xs text-slate-400">Owner Team</div><div className="text-sm text-slate-100">{getTeamLabel(teams, selected.teamId)}</div></div>
                    <div><div className="text-xs text-slate-400">Origem</div><div className="text-sm text-slate-100">{selected.managedBy || "portal"}</div></div>
                    <div><div className="text-xs text-slate-400">Visibility</div><div className="text-sm text-slate-100">{selected.visibility}</div></div>
                    <div><div className="text-xs text-slate-400">Mode</div><div className="text-sm text-slate-100">{selected.mode}</div></div>
                    <div><div className="text-xs text-slate-400">Rate limit</div><div className="text-sm text-slate-100">{selected.rateLimitPerMinute}/min</div></div>
                    <div><div className="text-xs text-slate-400">Transport</div><div className="text-sm text-slate-100">{selected.transport || "-"}</div></div>
                    <div><div className="text-xs text-slate-400">Method</div><div className="text-sm text-slate-100">{selected.method || "-"}</div></div>
                    <div className="md:col-span-2"><div className="text-xs text-slate-400">Endpoint</div><div className="truncate text-sm text-slate-100">{selected.endpoint || selected.runtimeSource || "-"}</div></div>
                    <div><div className="text-xs text-slate-400">Protegida</div><div className="text-sm text-slate-100">{selected.userCustomized ? "sim" : "nao"}</div></div>
                    {selected.managedBy === "agno" ? <div className="md:col-span-4 rounded-md border border-slate-700 bg-slate-900/35 p-3 text-xs text-slate-400">Esta tool e gerenciada pelo runtime do Agno/MCP. O portal pode visualizar, vincular e governar uso, mas nao deve editar instalacao ou comportamento interno.</div> : null}
                    <div className="md:col-span-4 rounded-md border border-amber-400/30 bg-amber-500/10 p-3">
                      <div className="text-sm font-semibold text-amber-100">Protecao contra catalog sync</div>
                      <div className="mt-1 text-xs text-amber-50/80">Quando habilitado, `catalog sync` preserva esta tool e nao sobrescreve seus metadados do portal.</div>
                      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
                        <input type="checkbox" checked={Boolean(form.userCustomized)} onChange={(e) => setForm((state) => ({ ...state, userCustomized: e.target.checked }))} />
                        Marcar como customizacao do usuario
                      </label>
                      <textarea className="input-dark mt-3 min-h-20" placeholder="Motivo opcional para preservar esta tool" value={form.customizationNote || ""} onChange={(e) => setForm((state) => ({ ...state, customizationNote: e.target.value }))} />
                      <div className="mt-3">
                        <button className="btn-ghost" onClick={() => void saveCustomization()}>Salvar protecao</button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-400">Crie uma tool simples no portal ou selecione uma tool de runtime para inspecionar.</div>
                )}
              </div>
            ) : null}

            {tab === "configuration" ? (
              <div className="space-y-3">
                {selected?.managedBy === "agno" ? (
                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3 text-sm text-slate-300">
                    Esta tool e `runtime-managed`. Para alteracoes estruturais, ajuste o runtime/MCP e sincronize o catalogo. Use o portal apenas para visibilidade e atribuicao.
                  </div>
                ) : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Identity and Function Call</div>
                    <div className="space-y-2">
                      <div>
                        <FieldLabel label="Display Name" tip="Human-readable name shown in UI and inspector." />
                        <input className="input-dark" disabled={selected?.managedBy === "agno"} placeholder="Threat Feed Connector" value={form.name} onChange={(e) => setForm((state) => ({ ...state, name: e.target.value }))} />
                      </div>
                      <div>
                        <FieldLabel label="Call Name" tip="Stable function identifier used by the agent when invoking this tool." />
                        <input className="input-dark" disabled={selected?.managedBy === "agno"} placeholder="fetch_threat_feed" value={form.callName || ""} onChange={(e) => setForm((state) => ({ ...state, callName: e.target.value }))} />
                      </div>
                      <div>
                        <FieldLabel label="Description" tip="Short purpose statement to help model/tool selection." />
                        <input className="input-dark" disabled={selected?.managedBy === "agno"} placeholder="Fetches latest IOC feed from security provider." value={form.description || ""} onChange={(e) => setForm((state) => ({ ...state, description: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel label="Type" tip="Integration family used for this capability." />
                          <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.type} onChange={(e) => setForm((state) => ({ ...state, type: e.target.value as Tool["type"] }))}>{["slack", "confluence", "jira", "http", "internal"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
                        </div>
                        <div>
                          <FieldLabel label="Mode" tip="mock for simulated behavior, real for live execution." />
                          <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.mode} onChange={(e) => setForm((state) => ({ ...state, mode: e.target.value as Tool["mode"] }))}><option value="mock">mock</option><option value="real">real</option></select>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Execution Endpoint</div>
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel label="Transport" tip="Invocation channel used by runtime (http/sdk/mcp/internal)." />
                          <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.transport || "http"} onChange={(e) => setForm((state) => ({ ...state, transport: e.target.value }))}>
                            <option value="http">http</option>
                            <option value="sdk">sdk</option>
                            <option value="mcp">mcp</option>
                            <option value="internal">internal</option>
                          </select>
                        </div>
                        <div>
                          <FieldLabel label="Method" tip="HTTP verb or action method when applicable." />
                          <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.method || "POST"} onChange={(e) => setForm((state) => ({ ...state, method: e.target.value }))}>
                            <option value="GET">GET</option>
                            <option value="POST">POST</option>
                            <option value="PUT">PUT</option>
                            <option value="PATCH">PATCH</option>
                            <option value="DELETE">DELETE</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <FieldLabel label="Endpoint" tip="URL, route, or internal function target for the call." />
                        <input className="input-dark" disabled={selected?.managedBy === "agno"} placeholder="https://api.vendor.com/v1/feed" value={form.endpoint || ""} onChange={(e) => setForm((state) => ({ ...state, endpoint: e.target.value }))} />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <FieldLabel label="Auth Ref" tip="Credential reference key (never store token in plain text)." />
                          <input className="input-dark" disabled={selected?.managedBy === "agno"} placeholder="secops_api_prod" value={form.authRef || ""} onChange={(e) => setForm((state) => ({ ...state, authRef: e.target.value }))} />
                        </div>
                        <div>
                          <FieldLabel label="Timeout (ms)" tip="Max execution time before request is aborted." />
                          <input className="input-dark" disabled={selected?.managedBy === "agno"} type="number" value={form.timeoutMs ?? 15000} onChange={(e) => setForm((state) => ({ ...state, timeoutMs: Number(e.target.value) || 15000 }))} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Safety and Governance</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel label="Policy" tip="read for non-mutating operations, write for state-changing actions." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.policy} onChange={(e) => setForm((state) => ({ ...state, policy: e.target.value as Tool["policy"] }))}><option value="read">read</option><option value="write">write</option></select>
                      </div>
                      <div>
                        <FieldLabel label="Risk Level" tip="Operational risk rating used for control and approvals." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.riskLevel} onChange={(e) => setForm((state) => ({ ...state, riskLevel: e.target.value as Tool["riskLevel"] }))}>{["low", "med", "high"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
                      </div>
                      <div>
                        <FieldLabel label="Rate Limit / min" tip="Maximum allowed invocations per minute." />
                        <input className="input-dark" disabled={selected?.managedBy === "agno"} type="number" value={form.rateLimitPerMinute} onChange={(e) => setForm((state) => ({ ...state, rateLimitPerMinute: Number(e.target.value) || 60 }))} />
                      </div>
                      <div>
                        <FieldLabel label="Owner Team" tip="Team that owns and can edit this tool." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.teamId || ""} onChange={(e) => setForm((state) => ({ ...state, teamId: e.target.value || null }))}><option value="">no owner team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}</select>
                      </div>
                      <div>
                        <FieldLabel label="Visibility" tip="Private is only visible to the owner team. Shared can be reused by other teams." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.visibility} onChange={(e) => setForm((state) => ({ ...state, visibility: e.target.value as Tool["visibility"] }))}>
                          <option value="private">private</option>
                          <option value="shared">shared</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                    <div className="mb-2 text-xs uppercase tracking-wider text-slate-400">Data Classification</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <FieldLabel label="Input Classification" tip="Highest sensitivity accepted as input payload." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.dataClassificationIn} onChange={(e) => setForm((state) => ({ ...state, dataClassificationIn: e.target.value as Tool["dataClassificationIn"] }))}>{["public", "internal", "confidential", "restricted"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
                      </div>
                      <div>
                        <FieldLabel label="Output Classification" tip="Expected sensitivity of returned data." />
                        <select className="input-dark" disabled={selected?.managedBy === "agno"} value={form.dataClassificationOut} onChange={(e) => setForm((state) => ({ ...state, dataClassificationOut: e.target.value as Tool["dataClassificationOut"] }))}>{["public", "internal", "confidential", "restricted"].map((item) => <option key={item} value={item}>{item}</option>)}</select>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  {selected?.managedBy === "agno" ? null : <button className="btn-primary" onClick={() => void save()}>{selected ? "Save" : "Create"}</button>}
                </div>
              </div>
            ) : null}

            {tab === "assignments" ? (
              <div className="space-y-3">
                <div className="text-sm text-slate-400">Agents currently linked to this tool.</div>
                <div className="rounded-md border border-slate-700 bg-slate-900/35 p-3">
                  {selected ? (
                    linkedAgents.length ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {linkedAgents.map((agent) => (
                          <div key={agent.id} className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-200">
                            {agent.name}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-400">No linked agents for this tool.</div>
                    )
                  ) : (
                    <div className="text-sm text-slate-400">Select or create a tool to inspect assignments.</div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
