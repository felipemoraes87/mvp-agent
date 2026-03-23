import { useEffect, useMemo, useState } from "react";
import { apiPost } from "../lib/api";
import type { AgentWithLinks, KnowledgeSource, Skill, Team, Tool } from "../lib/types";
import { ToolBadge } from "./ToolBadge";
import { HelpTip } from "./HelpTip";

type TabKey = "config" | "run" | "tools" | "knowledge" | "skills" | "permissions";
type ModalType = "tool" | "knowledge" | "skill";

type SimResponse = {
  chosenTeam: { id: string; key: string; name: string } | null;
  chosenAgent: { id: string; name: string; type: string } | null;
  confidence: number;
  justification: string[];
  top3: Array<{ agentId: string; agentName: string; score: number; reason: string }>;
  graphPath: string[];
  usedSources: Array<{ id: string; name: string; url: string }>;
};

const tabs: Array<{ key: TabKey; label: string }> = [
  { key: "config", label: "Configuracao" },
  { key: "run", label: "Run" },
  { key: "tools", label: "Tools" },
  { key: "knowledge", label: "Knowledge" },
  { key: "skills", label: "Skills" },
  { key: "permissions", label: "Permissions" },
];

export function InspectorPanel({ // NOSONAR
  agent,
  teams,
  tools,
  skills,
  knowledge,
  mode = "sidebar",
  onClose,
  onSaveConfig,
  onAssignTool,
  onRemoveTool,
  onAssignKnowledge,
  onRemoveKnowledge,
  onAssignSkill,
  onRemoveSkill,
}: {
  agent: AgentWithLinks | null;
  teams: Team[];
  tools: Tool[];
  skills: Skill[];
  knowledge: KnowledgeSource[];
  mode?: "sidebar" | "modal";
  onClose: () => void;
  onSaveConfig: (payload: Partial<AgentWithLinks>) => Promise<void>;
  onAssignTool: (toolId: string, canRead: boolean, canWrite: boolean) => Promise<void>;
  onRemoveTool: (toolId: string) => Promise<void>;
  onAssignKnowledge: (knowledgeSourceId: string) => Promise<void>;
  onRemoveKnowledge: (knowledgeSourceId: string) => Promise<void>;
  onAssignSkill: (skillId: string) => Promise<void>;
  onRemoveSkill: (skillId: string) => Promise<void>;
}) {
  const agentSupportsWrite = Boolean(agent?.executionProfile && agent.executionProfile !== "READ_ONLY");
  const [tab, setTab] = useState<TabKey>("config");
  const [status, setStatus] = useState("");
  const [modal, setModal] = useState<ModalType | null>(null);

  const [form, setForm] = useState({ name: "", description: "", prompt: "", type: "SPECIALIST" as AgentWithLinks["type"], teamId: "", tags: "" });

  const [selectedToolId, setSelectedToolId] = useState("");
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(false);

  const [selectedKnowledgeId, setSelectedKnowledgeId] = useState("");

  const [selectedSkillId, setSelectedSkillId] = useState("");

  const [newTool, setNewTool] = useState({
    name: "",
    type: "internal" as Tool["type"],
    mode: "mock" as Tool["mode"],
    policy: "read" as Tool["policy"],
    teamId: "",
  });
  const [newKnowledge, setNewKnowledge] = useState({ name: "", url: "", tagsCsv: "", ownerTeamId: "" });
  const [newSkill, setNewSkill] = useState({ name: "", description: "", prompt: "", runbookUrl: "", category: "operations" as Skill["category"] });
  const [runMessage, setRunMessage] = useState("");
  const [runContextTags, setRunContextTags] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runResult, setRunResult] = useState<SimResponse | null>(null);
  const [runError, setRunError] = useState("");

  useEffect(() => {
    setTab("config");
    setStatus("");
    if (!agent) return;
    setForm({
      name: agent.name,
      description: agent.description,
      prompt: agent.prompt,
      type: agent.type,
      teamId: agent.teamId || "",
      tags: agent.tags.join(", "),
    });
    setSelectedToolId("");
    setCanRead(true);
    setCanWrite(false);
    setSelectedKnowledgeId("");
    setSelectedSkillId("");

    const teamScope = agent.teamId || "";
    setNewTool({ name: "", type: "internal", mode: "mock", policy: "read", teamId: teamScope });
    setNewKnowledge({ name: "", url: "", tagsCsv: "", ownerTeamId: teamScope || teams[0]?.id || "" });
    setNewSkill({ name: "", description: "", prompt: "", runbookUrl: "", category: "operations" });
    setRunMessage(`Analise a demanda e coordene o fluxo a partir do agente ${agent.name}.`);
    setRunContextTags(agent.tags.join(", "));
    setRunResult(null);
    setRunError("");

  }, [agent?.id, teams]);

  const linkedToolIds = useMemo(() => new Set((agent?.toolLinks || []).map((link) => link.toolId)), [agent?.toolLinks]);
  const assignableTools = useMemo(() => tools.filter((tool) => !linkedToolIds.has(tool.id)), [tools, linkedToolIds]);

  const linkedKnowledgeIds = useMemo(() => new Set((agent?.knowledgeLinks || []).map((item) => item.knowledgeSourceId)), [agent?.knowledgeLinks]);
  const relatedKnowledge = useMemo(() => {
    if (!agent) return [];
    return knowledge.filter((item) => linkedKnowledgeIds.has(item.id));
  }, [agent, knowledge, linkedKnowledgeIds]);
  const assignableKnowledge = useMemo(() => knowledge.filter((item) => !linkedKnowledgeIds.has(item.id)), [knowledge, linkedKnowledgeIds]);

  const linkedSkills = useMemo(() => {
    if (!agent) return [];
    return skills.filter((skill) => (skill.linkedAgentIds || []).includes(agent.id));
  }, [skills, agent?.id]);

  const assignableSkills = useMemo(() => {
    if (!agent) return [];
    return skills.filter((skill) => !(skill.linkedAgentIds || []).includes(agent.id));
  }, [skills, agent?.id]);

  const createToolAndAssign = async () => {
    if (!agent) return;
    try {
      const created = await apiPost<{ tool: Tool }>("/api/tools", {
        name: newTool.name.trim(),
        description: "Callable capability created from Team Graph Inspector.",
        callName: newTool.name.trim().toLowerCase().replace(/\s+/g, "_"),
        transport: newTool.type === "http" ? "http" : "internal",
        endpoint: "",
        method: "POST",
        authRef: "",
        timeoutMs: 15000,
        type: newTool.type,
        mode: newTool.mode,
        policy: newTool.policy,
        riskLevel: "low",
        dataClassificationIn: "internal",
        dataClassificationOut: "internal",
        inputSchema: {},
        outputSchema: {},
      rateLimitPerMinute: 60,
      visibility: newTool.teamId ? "private" : "shared",
      teamId: newTool.teamId || null,
    });
      await onAssignTool(created.tool.id, true, newTool.policy === "write" && agentSupportsWrite);
      setStatus("Nova tool criada e vinculada.");
      setModal(null);
      setNewTool((prev) => ({ ...prev, name: "" }));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao criar tool.");
    }
  };

  const createKnowledgeAndAssign = async () => {
    try {
      const created = await apiPost<{ knowledgeSource: KnowledgeSource }>("/api/knowledge-sources", {
        name: newKnowledge.name.trim(),
        url: newKnowledge.url.trim(),
        tags: newKnowledge.tagsCsv.split(",").map((item) => item.trim()).filter(Boolean),
        visibility: "private",
        ownerTeamId: newKnowledge.ownerTeamId,
      });
      await onAssignKnowledge(created.knowledgeSource.id);
      setStatus("Nova knowledge criada e vinculada.");
      setModal(null);
      setNewKnowledge((prev) => ({ ...prev, name: "", url: "", tagsCsv: "" }));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao criar knowledge.");
    }
  };

  const createSkillAndAssign = async () => {
    if (!agent) return;
    const payload = {
      name: newSkill.name.trim(),
      description: newSkill.description.trim(),
      prompt: newSkill.prompt.trim(),
      runbookUrl: newSkill.runbookUrl.trim(),
      category: newSkill.category,
      enabled: true,
      visibility: agent.teamId ? "private" : "shared",
      ownerTeamId: agent.teamId,
      linkedAgentIds: [agent.id],
      managedBy: "portal",
      runtimeSource: null,
    };
    if (!payload.name) {
      setStatus("Nome da skill obrigatorio.");
      return;
    }
    try {
      await apiPost("/api/skills", payload);
      setStatus("Nova skill criada e vinculada.");
      setModal(null);
      setNewSkill({ name: "", description: "", prompt: "", runbookUrl: "", category: "operations" });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao criar skill.");
    }
  };

  const linkExistingSkill = async () => {
    if (!agent || !selectedSkillId) return;
    try {
      await onAssignSkill(selectedSkillId);
      setSelectedSkillId("");
      setStatus("Skill vinculada ao agente.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao vincular skill.");
    }
  };

  const unlinkSkill = async (skillId: string) => {
    if (!agent) return;
    const skillName = skills.find((skill) => skill.id === skillId)?.name || "this skill";
    if (!window.confirm(`Remove "${skillName}" from agent "${agent.name}"?`)) return;
    try {
      await onRemoveSkill(skillId);
      setStatus("Skill removida do agente.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao remover skill.");
    }
  };

  const runFlowFromAgent = async () => {
    if (!agent) return;
    const message = runMessage.trim();
    if (message.length < 4) {
      setRunError("Mensagem precisa ter pelo menos 4 caracteres.");
      return;
    }
    setRunBusy(true);
    setRunError("");
    try {
      const result = await apiPost<SimResponse>("/api/simulator/run", {
        message,
        suggestedTeamId: agent.teamId || undefined,
        forcedAgentId: agent.id,
        contextTags: runContextTags.split(",").map((item) => item.trim()).filter(Boolean),
      });
      setRunResult(result);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Falha ao executar fluxo.");
    } finally {
      setRunBusy(false);
    }
  };

  if (!agent) {
    return (
      <aside className={mode === "modal" ? "w-full rounded-xl border border-slate-700 bg-[var(--bg-elev)] p-4" : "h-full w-full max-w-sm border-l border-slate-700/70 bg-[var(--bg-elev)] p-4"}>
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4 text-sm text-slate-400">Selecione um agent no canvas para editar.</div>
      </aside>
    );
  }

  return (
    <aside
      className={
        mode === "modal"
          ? "relative w-full max-w-[920px] rounded-xl border border-slate-700 bg-[var(--bg-elev)] p-3"
          : "relative h-full w-full max-w-sm border-l border-slate-700/70 bg-[var(--bg-elev)] p-3"
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-slate-400">Inspector</div>
          <h3 className="text-sm font-semibold text-slate-100">{agent.name}</h3>
        </div>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={onClose}>Fechar</button>
      </div>

      {status ? <div className="mb-3 rounded-md border border-indigo-500/40 bg-indigo-500/10 px-2 py-1 text-xs text-indigo-100">{status}</div> : null}

      <div className="mb-3 flex gap-1 rounded-lg border border-slate-700 bg-slate-900/70 p-1">
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`flex-1 rounded-md px-2 py-1 text-xs ${tab === item.key ? "bg-indigo-500/25 text-indigo-200" : "text-slate-400 hover:text-slate-200"}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="space-y-3 overflow-auto pb-6 text-sm">
        {tab === "config" ? (
          <>
            <div className="flex items-center gap-1 text-xs text-slate-400">Nome <HelpTip text="Nome exibido no grafo e no playground para identificar o agente." /></div>
            <input className="input-dark" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Nome" />
            <div className="flex items-center gap-1 text-xs text-slate-400">Descricao <HelpTip text="Resumo da responsabilidade do agente dentro do fluxo." /></div>
            <textarea className="input-dark min-h-20" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Descricao" />
            <div className="flex items-center gap-1 text-xs text-slate-400">Prompt <HelpTip text="Instrucoes de sistema usadas para guiar o comportamento do agente." /></div>
            <textarea className="input-dark min-h-28" value={form.prompt} onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))} placeholder="Prompt/system instructions" />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Tipo <HelpTip text="Supervisor acolhe e confirma entendimento; Specialist aprofunda; Ticket prepara chamado." /></div>
                <select className="input-dark" value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as AgentWithLinks["type"] }))}>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="SPECIALIST">Specialist</option>
                  <option value="TICKET">Ticket</option>
                </select>
              </div>
              <div>
                <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Time <HelpTip text="Define escopo do agente. Global pode ser usado por varios times." /></div>
                <select className="input-dark" value={form.teamId} onChange={(e) => setForm((prev) => ({ ...prev, teamId: e.target.value }))}>
                  <option value="">Global</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>{team.key}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-1 text-xs text-slate-400">Tags <HelpTip text="Palavras-chave usadas no roteamento e contexto do agente." /></div>
            <input className="input-dark" value={form.tags} onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))} placeholder="tags (csv)" />
            <button
              className="btn-primary w-full"
              onClick={() =>
                void onSaveConfig({
                  name: form.name,
                  description: form.description,
                  prompt: form.prompt,
                  type: form.type,
                  teamId: form.teamId || null,
                  isGlobal: !form.teamId,
                  tags: form.tags.split(",").map((item) => item.trim()).filter(Boolean),
                })
              }
            >
              Save Configuration
            </button>
          </>
        ) : null}

        {tab === "run" ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-300">
              Executa o fluxo a partir deste agente selecionado no graph.
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Instrucao</div>
              <textarea className="input-dark min-h-24" value={runMessage} onChange={(e) => setRunMessage(e.target.value)} placeholder="Descreva a solicitacao para iniciar o fluxo" />
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1 text-xs text-slate-400">Context tags (csv)</div>
              <input className="input-dark" value={runContextTags} onChange={(e) => setRunContextTags(e.target.value)} placeholder="iam,incident,response" />
            </div>
            <button className="btn-primary w-full" disabled={runBusy} onClick={() => void runFlowFromAgent()}>
              {runBusy ? "Executando..." : "Executar Flow"}
            </button>
            {runError ? <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-xs text-rose-200">{runError}</div> : null}

            {runResult ? (
              <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-300">
                <div>Team: <b className="text-slate-100">{runResult.chosenTeam?.name || "N/A"}</b></div>
                <div>Agent: <b className="text-slate-100">{runResult.chosenAgent?.name || "N/A"}</b></div>
                <div>Confidence: <b className="text-slate-100">{(runResult.confidence * 100).toFixed(1)}%</b></div>
                <div className="text-slate-400">Path: {runResult.graphPath.length ? runResult.graphPath.join(" -> ") : "-"}</div>
                <div className="pt-1 text-slate-400">Justification</div>
                <ul className="list-disc space-y-1 pl-4">
                  {runResult.justification.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === "tools" ? (
          <>
            <div className="flex justify-end">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setModal("tool")}>Nova Tool</button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400">Assigned <HelpTip text="Tools ja vinculadas ao agente." /></div>
              {(agent.toolLinks || []).length ? (
                <div className="space-y-2">
                  {(agent.toolLinks || []).map((link) => (
                    <div key={link.id} className="flex items-center justify-between gap-2">
                      <ToolBadge tool={link.tool} compact />
                      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void onRemoveTool(link.toolId)}>Remove</button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400">No tools assigned.</div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-slate-400">Add Tool <HelpTip text="Vincula uma tool ao agente." /></div>
              <select className="input-dark" value={selectedToolId} onChange={(e) => setSelectedToolId(e.target.value)}>
                <option value="">Select tool</option>
                {assignableTools.map((tool) => (
                  <option key={tool.id} value={tool.id}>{tool.name} ({tool.policy})</option>
                ))}
              </select>
              <div className="flex items-center gap-3 text-xs text-slate-300">
                <label className="flex items-center gap-1"><input type="checkbox" checked={canRead} onChange={(e) => setCanRead(e.target.checked)} />Read</label>
                <label className="flex items-center gap-1"><input type="checkbox" checked={canWrite} onChange={(e) => setCanWrite(e.target.checked)} />Write</label>
              </div>
              <button className="btn-primary w-full" disabled={!selectedToolId} onClick={() => selectedToolId && void onAssignTool(selectedToolId, canRead, canWrite)}>Assign Tool</button>
            </div>
          </>
        ) : null}

        {tab === "knowledge" ? (
          <>
            <div className="flex justify-end">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setModal("knowledge")}>Nova Knowledge</button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400">Associated Sources</div>
              {relatedKnowledge.length ? (
                relatedKnowledge.map((item) => (
                  <div key={item.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-2 py-2">
                    <div className="min-w-0">
                      <div className="text-sm text-slate-100">{item.name}</div>
                      <div className="truncate text-xs text-slate-400">{item.url}</div>
                    </div>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void onRemoveKnowledge(item.id)}>Remove</button>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400">No knowledge source linked to this agent.</div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400">Link Existing</div>
              <select className="input-dark" value={selectedKnowledgeId} onChange={(e) => setSelectedKnowledgeId(e.target.value)}>
                <option value="">Select source</option>
                {assignableKnowledge.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
              <button className="btn-primary w-full" disabled={!selectedKnowledgeId} onClick={() => selectedKnowledgeId && void onAssignKnowledge(selectedKnowledgeId)}>Link Source</button>
            </div>
          </>
        ) : null}

        {tab === "skills" ? (
          <>
            <div className="flex justify-end">
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setModal("skill")}>Nova Skill</button>
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400">Linked Skills</div>
              {linkedSkills.length ? (
                linkedSkills.map((skill) => (
                  <div key={skill.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-700 px-2 py-2">
                    <div>
                      <div className="text-sm text-slate-100">{skill.name}</div>
                      <div className="text-xs text-slate-400">{skill.category}</div>
                      <div className="line-clamp-2 text-[11px] text-slate-500">{skill.prompt || skill.description || "-"}</div>
                    </div>
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => void unlinkSkill(skill.id)}>Remove</button>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400">Nenhuma skill vinculada neste agente.</div>
              )}
            </div>

            <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3">
              <div className="text-xs uppercase tracking-wider text-slate-400">Link Existing Skill</div>
              <select className="input-dark" value={selectedSkillId} onChange={(e) => setSelectedSkillId(e.target.value)}>
                <option value="">Select skill</option>
                {assignableSkills.map((skill) => (
                  <option key={skill.id} value={skill.id}>{skill.name}</option>
                ))}
              </select>
                <button className="btn-primary w-full" disabled={!selectedSkillId} onClick={() => void linkExistingSkill()}>Link Skill</button>
            </div>
          </>
        ) : null}

        {tab === "permissions" ? (
          <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-xs text-slate-300">
            <div className="text-xs uppercase tracking-wider text-slate-400">SoD Snapshot</div>
            <div>Role expected: {agentSupportsWrite ? "Write-capable" : "Read-only"}</div>
            <div>Global scope: {agent.isGlobal ? "Yes" : "No"}</div>
            <div>Write tools assigned: {(agent.toolLinks || []).filter((link) => link.canWrite).length}</div>
            <div className="rounded-md border border-slate-700 bg-slate-800/70 p-2 text-[11px] text-slate-400">
              Write permissions should be restricted to ticket agents and approved by policy engine.
            </div>
          </div>
        ) : null}
      </div>

      {modal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-100">
                {modal === "tool" ? "Nova Tool" : null}
                {modal === "knowledge" ? "Nova Knowledge" : null}
                {modal === "skill" ? "Nova Skill" : null}
              </div>
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setModal(null)}>Fechar</button>
            </div>

            {modal === "tool" ? (
              <div className="space-y-2">
                <input className="input-dark" placeholder="Nome" value={newTool.name} onChange={(e) => setNewTool((prev) => ({ ...prev, name: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <select className="input-dark" value={newTool.type} onChange={(e) => setNewTool((prev) => ({ ...prev, type: e.target.value as Tool["type"] }))}>
                    <option value="slack">slack</option>
                    <option value="confluence">confluence</option>
                    <option value="jira">jira</option>
                    <option value="http">http</option>
                    <option value="internal">internal</option>
                  </select>
                  <select className="input-dark" value={newTool.mode} onChange={(e) => setNewTool((prev) => ({ ...prev, mode: e.target.value as Tool["mode"] }))}>
                    <option value="mock">mock</option>
                    <option value="real">real</option>
                  </select>
                </div>
                <select className="input-dark" value={newTool.policy} onChange={(e) => setNewTool((prev) => ({ ...prev, policy: e.target.value as Tool["policy"] }))}>
                  <option value="read">read</option>
                  <option value="write">write</option>
                </select>
                <select className="input-dark" value={newTool.teamId} onChange={(e) => setNewTool((prev) => ({ ...prev, teamId: e.target.value }))}>
                  <option value="">Global</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <button className="btn-primary w-full" onClick={() => void createToolAndAssign()}>Salvar e Vincular</button>
              </div>
            ) : null}

            {modal === "knowledge" ? (
              <div className="space-y-2">
                <input className="input-dark" placeholder="Nome" value={newKnowledge.name} onChange={(e) => setNewKnowledge((prev) => ({ ...prev, name: e.target.value }))} />
                <input className="input-dark" placeholder="URL" value={newKnowledge.url} onChange={(e) => setNewKnowledge((prev) => ({ ...prev, url: e.target.value }))} />
                <input className="input-dark" placeholder="tags csv" value={newKnowledge.tagsCsv} onChange={(e) => setNewKnowledge((prev) => ({ ...prev, tagsCsv: e.target.value }))} />
                <select className="input-dark" value={newKnowledge.ownerTeamId} onChange={(e) => setNewKnowledge((prev) => ({ ...prev, ownerTeamId: e.target.value }))}>
                  <option value="">Select team</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.key}</option>)}
                </select>
                <button className="btn-primary w-full" onClick={() => void createKnowledgeAndAssign()}>Salvar e Vincular</button>
              </div>
            ) : null}

            {modal === "skill" ? (
              <div className="space-y-2">
                <input className="input-dark" placeholder="Nome" value={newSkill.name} onChange={(e) => setNewSkill((prev) => ({ ...prev, name: e.target.value }))} />
                <textarea className="input-dark min-h-20" placeholder="Descricao" value={newSkill.description} onChange={(e) => setNewSkill((prev) => ({ ...prev, description: e.target.value }))} />
                <textarea className="input-dark min-h-24" placeholder="Prompt / operational instruction" value={newSkill.prompt} onChange={(e) => setNewSkill((prev) => ({ ...prev, prompt: e.target.value }))} />
                <input className="input-dark" placeholder="Runbook URL" value={newSkill.runbookUrl} onChange={(e) => setNewSkill((prev) => ({ ...prev, runbookUrl: e.target.value }))} />
                <select className="input-dark" value={newSkill.category} onChange={(e) => setNewSkill((prev) => ({ ...prev, category: e.target.value as Skill["category"] }))}>
                  <option value="operations">operations</option>
                  <option value="analysis">analysis</option>
                  <option value="compliance">compliance</option>
                  <option value="custom">custom</option>
                </select>
                <button className="btn-primary w-full" onClick={() => void createSkillAndAssign()}>Salvar e Vincular</button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}
