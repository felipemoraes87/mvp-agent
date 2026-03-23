import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type OnConnect,
} from "reactflow";
import "reactflow/dist/style.css";
import { apiDelete, apiGet, apiPost, apiPut } from "../lib/api";
import type { AgentWithLinks, Handoff, KnowledgeSource, Skill, Team, Tool, Workflow } from "../lib/types";
import { AgentNode } from "../components/AgentNode";
import { ConnectionEdge } from "../components/ConnectionEdge";
import { InspectorPanel } from "../components/InspectorPanel";
import { ResourceNode } from "../components/ResourceNode";

const nodeTypes = { agentNode: AgentNode, resourceNode: ResourceNode };
const edgeTypes = { connectionEdge: ConnectionEdge };

const LAYOUT_H_GAP = 330;
const LAYOUT_V_GAP = 155;
const LAYOUT_START_X = 90;
const LAYOUT_START_Y = 90;
const COMPONENT_V_GAP = 120;
type GraphResponse = { nodes: Array<{ id: string }>; edges: Handoff[] };
type ViewMode = "teams" | "workflows";
type ChannelRecord = { id: string; enabled: boolean };
type SavedGraphLayout = Record<string, { x: number; y: number }>;
type WorkflowNodeKind = "trigger" | "analysis" | "decision" | "knowledge" | "action" | "finish";
type WorkflowStepModal = {
  stepNumber: number;
  title: string;
  detail: string;
  caption: string;
  kind: WorkflowNodeKind;
  phase?: string;
  agentName?: string;
  integrations?: string[];
  bullets?: string[];
};

function scoreAgentForStep(step: string, agent: AgentWithLinks): number {
  const text = step.toLowerCase();
  const haystack = [
    agent.name,
    agent.description,
    agent.prompt,
    ...(agent.tags || []),
    ...(agent.capabilities || []),
    ...(agent.domains || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  let score = 0;
  const tokens = text.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  for (const token of tokens) {
    if (haystack.includes(token)) score += token.length > 6 ? 3 : 2;
  }
  if (text.includes("jumpcloud") && haystack.includes("jumpcloud")) score += 6;
  if ((text.includes("github") || text.includes("repo") || text.includes("mapping")) && haystack.includes("github")) score += 6;
  if ((text.includes("iga") || text.includes("approval") || text.includes("br") || text.includes("sr") || text.includes("reconc")) && haystack.includes("iga")) score += 6;
  if ((text.includes("bigquery") || text.includes("correl") || text.includes("analytic") || text.includes("history")) && haystack.includes("bigquery")) score += 6;
  if ((text.includes("document") || text.includes("runbook") || text.includes("ticket") || text.includes("process")) && (haystack.includes("knowledge") || haystack.includes("confluence") || haystack.includes("jira"))) score += 5;
  if ((text.includes("adequa") || text.includes("classif") || text.includes("origem") || text.includes("entitlement")) && haystack.includes("reason")) score += 5;
  if ((text.includes("risk") || text.includes("severidade") || text.includes("suspeit")) && haystack.includes("risk")) score += 5;
  return score;
}

function chooseAgentForStep(step: string, agents: AgentWithLinks[]): AgentWithLinks | null {
  if (!agents.length) return null;
  const ranked = agents
    .map((agent) => ({ agent, score: scoreAgentForStep(step, agent) }))
    .sort((a, b) => b.score - a.score || a.agent.name.localeCompare(b.agent.name));
  return ranked[0]?.score > 0 ? ranked[0].agent : ranked[0]?.agent || null;
}

function generateAgentSuffix(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(random[0] % 1000).padStart(3, "0");
}

function readEnabledChannelsCount(): number {
  try {
    const raw = localStorage.getItem("studio.channels.config.v2") || localStorage.getItem("studio.channels.config.v1");
    if (!raw) return 0;
    return (JSON.parse(raw) as ChannelRecord[]).filter((channel) => channel.enabled).length;
  } catch {
    return 0;
  }
}

function layoutStorageKey(teamId: string): string {
  return `graph.layout.v1:${teamId}`;
}

function readSavedLayout(teamId: string): SavedGraphLayout {
  if (!teamId) return {};
  try {
    const raw = localStorage.getItem(layoutStorageKey(teamId));
    return raw ? (JSON.parse(raw) as SavedGraphLayout) : {};
  } catch {
    return {};
  }
}

function saveLayout(teamId: string, nodes: Node[]): void {
  const payload: SavedGraphLayout = {};
  for (const node of nodes) {
    const id = String(node.id);
    if (id.includes("::resource::") || id.startsWith("workflow::")) continue;
    payload[id] = { x: node.position.x, y: node.position.y };
  }
  localStorage.setItem(layoutStorageKey(teamId), JSON.stringify(payload));
}

function sortByAgentPriority(a: AgentWithLinks, b: AgentWithLinks): number {
  const rank = { SUPERVISOR: 0, SPECIALIST: 1, TICKET: 2 } as const;
  const delta = rank[a.type] - rank[b.type];
  return delta !== 0 ? delta : a.name.localeCompare(b.name);
}

function teamLabelForAgent(agent: AgentWithLinks, teams: Team[]): string {
  if (agent.isGlobal) return "GLOBAL";
  const team = teams.find((item) => item.id === agent.teamId);
  return team ? `${team.key} ${agent.visibility}` : agent.visibility;
}

function inferWorkflowKind(step: string, index: number, total: number): WorkflowNodeKind {
  const value = step.toLowerCase();
  if (index === 0) return "trigger";
  if (index === total - 1) return "finish";
  if (value.includes("approve") || value.includes("confirm") || value.includes("guard")) return "decision";
  if (value.includes("knowledge") || value.includes("runbook") || value.includes("document")) return "knowledge";
  if (value.includes("change") || value.includes("execute") || value.includes("update") || value.includes("reconcile")) return "action";
  return "analysis";
}

function summarizeStep(step: string): { title: string; detail: string } {
  const normalized = step.replace(/\s+/g, " ").trim();
  const parts = normalized.split(/[:.-]\s+/, 2);
  if (parts.length === 2 && parts[0].length <= 42) return { title: parts[0], detail: parts[1] };
  const words = normalized.split(" ");
  return words.length <= 7 ? { title: normalized, detail: "Follow this workflow instruction." } : { title: words.slice(0, 6).join(" "), detail: normalized };
}

function buildSmartLayout(agents: AgentWithLinks[], handoffs: Handoff[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const nodeIds = new Set(agents.map((agent) => agent.id));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  const undirected = new Map<string, string[]>();

  for (const id of nodeIds) {
    outgoing.set(id, []);
    incoming.set(id, 0);
    undirected.set(id, []);
  }

  for (const edge of handoffs) {
    if (!nodeIds.has(edge.fromAgentId) || !nodeIds.has(edge.toAgentId)) continue;
    outgoing.get(edge.fromAgentId)!.push(edge.toAgentId);
    incoming.set(edge.toAgentId, (incoming.get(edge.toAgentId) || 0) + 1);
    undirected.get(edge.fromAgentId)!.push(edge.toAgentId);
    undirected.get(edge.toAgentId)!.push(edge.fromAgentId);
  }

  const visited = new Set<string>();
  const components: string[][] = [];
  for (const id of nodeIds) {
    if (visited.has(id)) continue;
    const queue = [id];
    const component: string[] = [];
    visited.add(id);
    while (queue.length) {
      const current = queue.shift()!;
      component.push(current);
      for (const next of undirected.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  let currentY = LAYOUT_START_Y;

  for (const component of components) {
    const componentSet = new Set(component);
    const localIncoming = new Map<string, number>();
    const localOutgoing = new Map<string, string[]>();
    const level = new Map<string, number>();
    const processed = new Set<string>();

    for (const id of component) {
      localIncoming.set(id, 0);
      localOutgoing.set(id, []);
    }
    for (const id of component) {
      for (const to of outgoing.get(id) || []) {
        if (!componentSet.has(to)) continue;
        localOutgoing.get(id)!.push(to);
        localIncoming.set(to, (localIncoming.get(to) || 0) + 1);
      }
    }

    const queue = component
      .filter((id) => (localIncoming.get(id) || 0) === 0)
      .map((id) => byId.get(id)!)
      .sort(sortByAgentPriority)
      .map((agent) => agent.id);
    for (const id of queue) level.set(id, 0);

    while (queue.length) {
      const current = queue.shift()!;
      processed.add(current);
      const currentLevel = level.get(current) || 0;
      for (const next of localOutgoing.get(current) || []) {
        level.set(next, Math.max(level.get(next) ?? 0, currentLevel + 1));
        localIncoming.set(next, (localIncoming.get(next) || 0) - 1);
        if ((localIncoming.get(next) || 0) <= 0) queue.push(next);
      }
    }

    component
      .filter((id) => !processed.has(id))
      .map((id) => byId.get(id)!)
      .sort(sortByAgentPriority)
      .forEach((agent, index) => level.set(agent.id, 1 + (index % 3)));

    const layers = new Map<number, AgentWithLinks[]>();
    for (const id of component) {
      const layer = level.get(id) || 0;
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer)!.push(byId.get(id)!);
    }

    let maxLayerSize = 1;
    for (const layer of Array.from(layers.keys()).sort((a, b) => a - b)) {
      const layerAgents = layers.get(layer)!.sort(sortByAgentPriority);
      maxLayerSize = Math.max(maxLayerSize, layerAgents.length);
      layerAgents.forEach((agent, index) => {
        positions.set(agent.id, { x: LAYOUT_START_X + layer * LAYOUT_H_GAP, y: currentY + index * LAYOUT_V_GAP });
      });
    }

    currentY += maxLayerSize * LAYOUT_V_GAP + COMPONENT_V_GAP;
  }

  return positions;
}

function buildResourceDecorations(agent: AgentWithLinks, baseNodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const core = baseNodes.find((node) => node.id === agent.id);
  if (!core) return { nodes: [], edges: [] };
  const resources = [
    { key: "tools", label: "Tools", count: agent.toolLinks?.length || 0, dx: -210, dy: -110, color: "#22c55e" },
    { key: "knowledge", label: "Knowledge", count: agent.knowledgeLinks?.length || 0, dx: 220, dy: -110, color: "#38bdf8" },
    { key: "skills", label: "Skills", count: agent.skillLinks?.length || 0, dx: -220, dy: 120, color: "#a78bfa" },
    { key: "permissions", label: "Permissions", count: (agent.toolLinks || []).filter((link) => link.canWrite).length, dx: 220, dy: 120, color: "#f59e0b" },
    { key: "channels", label: "Channels", count: readEnabledChannelsCount(), dx: 0, dy: 220, color: "#f97316" },
  ];

  return {
    nodes: resources.map((res) => ({
      id: `${agent.id}::resource::${res.key}`,
      type: "resourceNode",
      position: { x: core.position.x + res.dx, y: core.position.y + res.dy },
      draggable: false,
      selectable: false,
      data: { label: res.label, count: res.count, color: res.color },
    })),
    edges: resources.map((res) => ({
      id: `${agent.id}::edge::${res.key}`,
      source: agent.id,
      sourceHandle: res.key === "tools" ? "port-tools" : res.key === "knowledge" ? "port-knowledge" : res.key === "skills" ? "port-skills" : res.key === "permissions" ? "port-permissions" : "port-channels",
      target: `${agent.id}::resource::${res.key}`,
      label: res.label,
      style: { stroke: "#64748b", strokeDasharray: "4 3" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b", width: 12, height: 12 },
    })),
  };
}

function buildWorkflowStepDetails(workflow: Workflow, orderedAgents: AgentWithLinks[]): WorkflowStepModal[] {
  const sharedContext = [
    "Intent classification, entities and requested objective",
    "Collected evidence from previous steps",
    "Integration readiness and missing setup state",
  ];
  const steps: WorkflowStepModal[] = [
    {
      stepNumber: 0,
      title: "Request intake",
      detail: workflow.objective,
      caption: "Protocol start",
      kind: "trigger",
      phase: "Entrada",
      agentName: orderedAgents[0]?.name || "IAM Orchestrator",
      integrations: workflow.integrationKeys.slice(0, 3),
      bullets: workflow.preconditions.length ? workflow.preconditions : ["Request details and target scope are captured here."],
    },
    {
      stepNumber: 1,
      title: "Setup and authentication gates",
      detail: "The coordinator validates required integrations before dispatching the workflow.",
      caption: "Protocol gate",
      kind: "decision",
      phase: "Setup",
      agentName: "IAM Orchestrator",
      integrations: workflow.integrationKeys,
      bullets: workflow.setupPoints.length ? workflow.setupPoints : ["No explicit setup points declared for this workflow."],
    },
  ];

  workflow.steps.forEach((step, index) => {
    const summary = summarizeStep(step);
    const candidateAgents = orderedAgents.filter((agent) => agent.name !== "IAM Orchestrator");
    const agent = chooseAgentForStep(step, candidateAgents) || orderedAgents[orderedAgents.length - 1] || null;
    steps.push({
      stepNumber: index + 2,
      title: summary.title,
      detail: summary.detail,
      caption: `Step ${index + 1}`,
      kind: inferWorkflowKind(step, index, workflow.steps.length),
      phase: "Execution",
      agentName: agent?.name || "IAM Orchestrator",
      integrations: workflow.integrationKeys.slice(0, 2),
      bullets: [
        `Context sent: ${sharedContext.join("; ")}.`,
        `Agent task: ${step}`,
      ],
    });
  });

  steps.push({
    stepNumber: workflow.steps.length + 2,
    title: "Exception and fallback handling",
    detail: "Failure paths are evaluated before the final response is produced.",
    caption: "Exception path",
    kind: "knowledge",
    phase: "Exceptions",
    agentName: "IAM Orchestrator",
    integrations: [],
    bullets: workflow.failureHandling.length ? workflow.failureHandling : ["No explicit failure handling declared."],
  });

  steps.push({
    stepNumber: workflow.steps.length + 3,
    title: "Output and consolidation",
    detail: workflow.outputFormat || "Return the consolidated workflow result.",
    caption: "Finish",
    kind: "finish",
    phase: "Output",
    agentName: orderedAgents[orderedAgents.length - 1]?.name || "IAM Orchestrator",
    integrations: [],
    bullets: workflow.successCriteria.length ? workflow.successCriteria : ["No explicit success criteria declared."],
  });

  return steps;
}

function resolveAgentFromNode(node: Node): string | null {
  if (String(node.id).includes("::resource::")) return null;
  return String(node.id);
}

export function GraphPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("teams");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(null);
  const [workflowSearch, setWorkflowSearch] = useState("");
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutStatus, setLayoutStatus] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [workflowStepModal, setWorkflowStepModal] = useState<WorkflowStepModal | null>(null);
  const [workflowZoom, setWorkflowZoom] = useState(0.78);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const load = useCallback(async (nextTeamId?: string) => {
    const teamRes = await apiGet<{ teams: Team[] }>("/api/teams");
    const effectiveTeamId = nextTeamId || teamId || teamRes.teams[0]?.id || "";
    const [graphRes, agentRes, toolRes, skillRes, knowledgeRes, workflowRes] = await Promise.all([
      apiGet<GraphResponse>(`/api/graph${effectiveTeamId ? `?teamId=${effectiveTeamId}` : ""}`),
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ tools: Tool[] }>("/api/tools"),
      apiGet<{ skills: Skill[] }>("/api/skills"),
      apiGet<{ knowledgeSources: KnowledgeSource[] }>("/api/knowledge-sources"),
      apiGet<{ workflows: Workflow[] }>("/api/workflows"),
    ]);

    setTeams(teamRes.teams);
    setTools(toolRes.tools);
    setSkills(skillRes.skills);
    setKnowledge(knowledgeRes.knowledgeSources);
    setWorkflows(workflowRes.workflows);
    if (teamId !== effectiveTeamId) setTeamId(effectiveTeamId);

    const visibleIds = new Set(graphRes.nodes.map((node) => node.id));
    const visibleAgents = agentRes.agents.filter((agent) => visibleIds.has(agent.id));
    setAgents(visibleAgents);

    const smartPositions = buildSmartLayout(visibleAgents, graphRes.edges);
    const savedLayout = readSavedLayout(effectiveTeamId);
    setNodes(visibleAgents.map((agent) => ({
      id: agent.id,
      type: "agentNode",
      position: savedLayout[agent.id] || smartPositions.get(agent.id) || { x: LAYOUT_START_X, y: LAYOUT_START_Y },
      data: { name: agent.name, type: agent.type, teamLabel: teamLabelForAgent(agent, teamRes.teams) },
    })));
    setEdges(graphRes.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromAgentId,
      sourceHandle: "out-main",
      target: edge.toAgentId,
      targetHandle: "in-main",
      type: "connectionEdge",
      label: edge.conditionExpr || "handoff",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8", width: 16, height: 16 },
      data: { highlighted: false },
    })));
    setLayoutDirty(false);
  }, [teamId, setEdges, setNodes]);

  useEffect(() => { load().catch(() => undefined); }, [load]);

  const selectedTeam = useMemo(() => teams.find((team) => team.id === teamId) || null, [teamId, teams]);
  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === selectedAgentId) || null, [agents, selectedAgentId]);
  const visibleAgentIds = useMemo(() => new Set(agents.map((agent) => agent.id)), [agents]);
  const visibleWorkflows = useMemo(() => workflows
    .filter((workflow) => {
      const ownedByTeam = workflow.ownerTeamId === teamId;
      const hasVisibleParticipant = workflow.participantAgentIds.some((agentId) => visibleAgentIds.has(agentId));
      return ownedByTeam || hasVisibleParticipant;
    })
    .filter((workflow) => {
      const term = workflowSearch.trim().toLowerCase();
      if (!term) return true;
      return [workflow.name, workflow.description, workflow.objective, workflow.outputFormat, ...workflow.integrationKeys].filter(Boolean).some((value) => String(value).toLowerCase().includes(term));
    })
    .sort((a, b) => a.name.localeCompare(b.name)), [teamId, visibleAgentIds, workflowSearch, workflows]);
  const selectedWorkflow = useMemo(() => visibleWorkflows.find((workflow) => workflow.id === selectedWorkflowId) || visibleWorkflows[0] || null, [selectedWorkflowId, visibleWorkflows]);
  const orderedWorkflowAgents = useMemo(() => !selectedWorkflow ? [] : selectedWorkflow.participantAgentIds.map((id) => agents.find((agent) => agent.id === id) || null).filter((agent): agent is AgentWithLinks => Boolean(agent)), [agents, selectedWorkflow]);
  const workflowStepDetails = useMemo(() => selectedWorkflow ? buildWorkflowStepDetails(selectedWorkflow, orderedWorkflowAgents) : [], [orderedWorkflowAgents, selectedWorkflow]);

  useEffect(() => { setSelectedWorkflowId((current) => current && visibleWorkflows.some((workflow) => workflow.id === current) ? current : (visibleWorkflows[0]?.id || null)); }, [visibleWorkflows]);
  useEffect(() => { setWorkflowStepModal(null); }, [selectedWorkflowId, viewMode]);
  useEffect(() => {
    if (viewMode !== "teams") return;
    setEdges((current) => current.map((edge) => ({ ...edge, data: { highlighted: hoveredNodeId ? edge.source === hoveredNodeId || edge.target === hoveredNodeId : false } })));
  }, [hoveredNodeId, setEdges, viewMode]);

  const teamGraph = useMemo(() => {
    if (!selectedAgent) return { nodes, edges };
    const addon = buildResourceDecorations(selectedAgent, nodes);
    return { nodes: [...nodes, ...addon.nodes], edges: [...edges, ...addon.edges] };
  }, [selectedAgent, nodes, edges]);
  const renderedGraph = useMemo(() => teamGraph, [teamGraph]);

  const onConnect: OnConnect = (params: Connection) => {
    if (viewMode !== "teams" || !params.source || !params.target) return;
    apiPost("/api/handoffs", { fromAgentId: params.source, toAgentId: params.target, priority: 50 }).then(() => load(teamId)).catch(() => undefined);
  };
  const deleteEdge = (id: string) => {
    if (viewMode !== "teams" || !window.confirm("Delete this handoff connection?")) return;
    apiDelete(`/api/handoffs/${id}`).then(() => load(teamId)).catch(() => undefined);
  };
  const addAgent = () => {
    apiPost("/api/agents", {
      name: `New Specialist ${generateAgentSuffix()}`,
      description: "New specialist node",
      prompt: "Handle team specific demand and escalate when needed.",
      tags: ["specialist"],
      type: "SPECIALIST",
      isGlobal: false,
      visibility: "private",
      teamId: teamId || null,
    }).then(() => load(teamId)).catch(() => undefined);
  };
  const persistCurrentLayout = () => {
    if (!teamId) return;
    saveLayout(teamId, nodes);
    setLayoutDirty(false);
    setLayoutStatus("Visualizacao grafica salva para este time.");
  };
  const restoreSavedLayout = () => {
    if (!teamId) return;
    const savedLayout = readSavedLayout(teamId);
    if (!Object.keys(savedLayout).length) {
      setLayoutStatus("Nenhuma visualizacao salva para este time.");
      return;
    }
    setNodes((prev) => prev.map((node) => savedLayout[String(node.id)] ? { ...node, position: savedLayout[String(node.id)] } : node));
    setLayoutDirty(false);
    setLayoutStatus("Visualizacao grafica restaurada.");
  };

  const saveConfig = async (payload: Partial<AgentWithLinks>) => {
    if (!selectedAgentId || !selectedAgent) return;
    await apiPut(`/api/agents/${selectedAgentId}`, { ...selectedAgent, ...payload, tags: payload.tags || selectedAgent.tags });
    await load(teamId);
  };
  const assignTool = async (toolId: string, canRead: boolean, canWrite: boolean) => {
    if (!selectedAgentId) return;
    await apiPost(`/api/agents/${selectedAgentId}/tools`, { toolId, canRead, canWrite, justification: "Assigned from graph inspector" });
    await load(teamId);
  };
  const removeTool = async (toolId: string) => {
    if (!selectedAgentId) return;
    const toolName = agents.find((agent) => agent.id === selectedAgentId)?.toolLinks?.find((link) => link.toolId === toolId)?.tool.name || "this tool";
    if (!window.confirm(`Remove "${toolName}" from this agent?`)) return;
    await apiDelete(`/api/agents/${selectedAgentId}/tools/${toolId}`);
    await load(teamId);
  };
  const assignKnowledge = async (knowledgeSourceId: string) => {
    if (!selectedAgentId) return;
    await apiPost(`/api/agents/${selectedAgentId}/knowledge`, { knowledgeSourceId });
    await load(teamId);
  };
  const removeKnowledge = async (knowledgeSourceId: string) => {
    if (!selectedAgentId) return;
    const sourceName = knowledge.find((item) => item.id === knowledgeSourceId)?.name || "this knowledge source";
    if (!window.confirm(`Remove "${sourceName}" from this agent?`)) return;
    await apiDelete(`/api/agents/${selectedAgentId}/knowledge/${knowledgeSourceId}`);
    await load(teamId);
  };
  const assignSkill = async (skillId: string) => {
    if (!selectedAgentId) return;
    await apiPost(`/api/agents/${selectedAgentId}/skills`, { skillId });
    await load(teamId);
  };
  const removeSkill = async (skillId: string) => {
    if (!selectedAgentId) return;
    const skillName = skills.find((item) => item.id === skillId)?.name || "this skill";
    if (!window.confirm(`Remove "${skillName}" from this agent?`)) return;
    await apiDelete(`/api/agents/${selectedAgentId}/skills/${skillId}`);
    await load(teamId);
  };

  return (
    <div className="grid h-[calc(100vh-4.5rem)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-slate-700/70 bg-[var(--bg-elev)]">
      <div className="border-b border-slate-800/80 bg-slate-950/85 px-3 py-2">
        <div className="flex flex-nowrap items-center gap-2 overflow-hidden">
          <div className="flex shrink-0 items-center rounded-xl border border-slate-800 bg-slate-900/70 p-1">
            <button className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${viewMode === "teams" ? "bg-sky-500/15 text-sky-100" : "text-slate-300 hover:text-slate-100"}`} onClick={() => setViewMode("teams")}>Times</button>
            <button className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${viewMode === "workflows" ? "bg-amber-500/15 text-amber-100" : "text-slate-300 hover:text-slate-100"}`} onClick={() => setViewMode("workflows")}>Workflows</button>
          </div>

          {viewMode === "teams" ? (
            <>
              <select className="input-dark min-w-0 w-[240px] shrink !py-1.5 text-xs" value={teamId} onChange={(e) => { const value = e.target.value; setTeamId(value); load(value).catch(() => undefined); }}>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.key} - {team.name}</option>)}
              </select>
              <button className={`shrink-0 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition ${layoutDirty ? "border-emerald-400 bg-emerald-500/15 text-emerald-100" : "border-slate-700 bg-slate-800/80 text-slate-100 hover:border-emerald-400/50"}`} onClick={persistCurrentLayout}>Salvar visualizacao</button>
              <button className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-slate-500" onClick={restoreSavedLayout}>Restaurar salvo</button>
              <button className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-sky-400/50" onClick={addAgent}>+ Novo agente</button>
            </>
          ) : (
            <>
              <select className="input-dark min-w-0 w-[240px] shrink-0 !py-1.5 text-xs" value={selectedWorkflowId || ""} onChange={(e) => setSelectedWorkflowId(e.target.value || null)}>
                {visibleWorkflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name}</option>)}
              </select>
              <input className="input-dark min-w-0 w-[260px] flex-1 !py-1.5 text-xs" placeholder="Filtrar workflow..." value={workflowSearch} onChange={(e) => setWorkflowSearch(e.target.value)} />
              <div className="flex shrink-0 items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/70 px-2 py-1">
                <button className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 transition hover:border-amber-400/60" onClick={() => setWorkflowZoom((current) => Math.max(0.55, Number((current - 0.08).toFixed(2))))}>-</button>
                <div className="w-12 text-center text-[11px] font-semibold text-slate-300">{Math.round(workflowZoom * 100)}%</div>
                <button className="rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-slate-200 transition hover:border-amber-400/60" onClick={() => setWorkflowZoom((current) => Math.min(1, Number((current + 0.08).toFixed(2))))}>+</button>
              </div>
              <button className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-amber-400/60" onClick={() => window.location.assign("/workflows")}>Abrir workflow</button>
              <button className="shrink-0 rounded-xl border border-slate-700 bg-slate-800/70 px-2.5 py-1.5 text-xs font-semibold text-slate-100 transition hover:border-amber-400/60" onClick={() => window.location.assign("/workflows")}>+ Novo passo</button>
            </>
          )}

          {layoutStatus ? <div className="truncate rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] text-slate-300">{layoutStatus}</div> : null}
        </div>
      </div>

      <div className="min-h-0 h-full">
        <section className="relative h-full min-h-0 min-w-0">
          {viewMode === "workflows" ? (
            selectedWorkflow ? (
              <div className="h-full overflow-auto bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.08),transparent_38%),linear-gradient(180deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-6">
                <div className="mx-auto max-w-[1600px]">
                  <div className="rounded-3xl border border-amber-400/20 bg-slate-950/88 px-5 py-4 shadow-xl">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-amber-100">Workflow Sequence</div>
                    <div className="mt-1 text-xl font-semibold text-slate-100">{selectedWorkflow.name}</div>
                    <div className="mt-1 text-sm text-slate-400">{selectedWorkflow.steps.length} etapas visiveis no board. Clique em qualquer etapa para abrir os detalhes.</div>
                  </div>

                  <div className="mt-6 overflow-auto pb-6">
                    <div className="flex min-w-max items-center gap-3 pb-2" style={{ transform: `scale(${workflowZoom})`, transformOrigin: "top left" }}>
                    {workflowStepDetails.map((step, index) => (
                      <div key={`${selectedWorkflow.id}-board-${step.stepNumber}`} className="flex items-center gap-3">
                        <button
                          className="w-[250px] rounded-[24px] border border-slate-700 bg-slate-950/95 p-4 text-left shadow-2xl transition hover:-translate-y-0.5 hover:border-amber-400/60 hover:bg-slate-900/95"
                          onClick={() => setWorkflowStepModal(step)}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-[11px] uppercase tracking-[0.18em] text-amber-100">{step.caption}</div>
                              {step.phase ? <div className="mt-1 text-[11px] font-semibold text-slate-500">{step.phase}</div> : null}
                              <div className="mt-2 text-base font-semibold text-slate-100">{step.title}</div>
                            </div>
                            <div className="rounded-2xl border border-slate-700 px-2.5 py-1 text-xs font-semibold text-slate-200">{step.stepNumber}</div>
                          </div>
                          <div className="mt-3 line-clamp-4 text-xs leading-5 text-slate-300">{step.detail}</div>
                          <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/75 px-3 py-2">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Agent</div>
                            <div className="mt-1 text-xs font-semibold text-slate-100">{step.agentName || "IAM Orchestrator"}</div>
                          </div>
                          {step.bullets?.length ? (
                            <div className="mt-3">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Protocol details</div>
                              <div className="mt-2 space-y-1.5">
                                {step.bullets.slice(0, 2).map((item) => (
                                  <div key={item} className="rounded-2xl border border-slate-800 bg-slate-900/60 px-3 py-2 text-[11px] leading-5 text-slate-300">
                                    {item}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </button>
                        {index < workflowStepDetails.length - 1 ? (
                          <div className="flex shrink-0 items-center gap-2 px-1">
                            <div className="h-px w-7 bg-amber-400/50" />
                            <div className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-100">
                              next
                            </div>
                            <div className="h-px w-7 bg-amber-400/50" />
                          </div>
                        ) : null}
                      </div>
                    ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center bg-slate-950/90 p-8">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/60 px-6 py-5 text-sm text-slate-400">
                  Nenhum workflow disponivel para o filtro atual.
                </div>
              </div>
            )
          ) : (
        <>
        {selectedTeam ? (
          <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-2xl border border-sky-400/20 bg-slate-950/88 px-4 py-3 shadow-xl">
            <div className="text-[11px] uppercase tracking-[0.2em] text-sky-100">Team Map</div>
            <div className="mt-1 text-sm font-semibold text-slate-100">{selectedTeam.name}</div>
            <div className="mt-1 text-xs text-slate-400">{agents.length} agentes visiveis. Arraste os nos para compor a visualizacao do time.</div>
          </div>
        ) : null}
        <ReactFlow
          key={`${viewMode}:${selectedWorkflow?.id || "none"}`}
          nodes={renderedGraph.nodes}
          edges={renderedGraph.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            const agentId = resolveAgentFromNode(node);
            if (!agentId) return;
            setSelectedAgentId(agentId);
            setInspectorOpen(false);
          }}
          onNodeDoubleClick={(_, node) => { const agentId = resolveAgentFromNode(node); if (!agentId) return; setSelectedAgentId(agentId); setInspectorOpen(true); }}
          onNodeMouseEnter={(_, node) => setHoveredNodeId(String(node.id))}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onNodeDragStop={() => { if (viewMode !== "teams") return; setLayoutDirty(true); setLayoutStatus("Posicoes alteradas. Use 'Salvar visualizacao' para manter este formato."); }}
          onEdgeDoubleClick={(_, edge) => { if (!String(edge.id).includes("::edge::")) deleteEdge(edge.id); }}
          defaultEdgeOptions={{ type: "connectionEdge", markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8" } }}
          fitView
          fitViewOptions={{ padding: 0.22, maxZoom: 1 }}
          minZoom={0.25}
          maxZoom={1.8}
          className="h-full"
        >
          <Background variant={BackgroundVariant.Dots} color="#334155" size={1.4} gap={18} />
          <MiniMap pannable zoomable style={{ background: "#0f172a", border: "1px solid #334155" }} maskColor="rgba(15, 23, 42, 0.65)" nodeColor={(node) => String(node.id).startsWith("workflow::") ? "#f59e0b" : "#6366f1"} />
          <Controls className="!bg-slate-900 !text-slate-200 !border !border-slate-700" />
        </ReactFlow>
        </>
          )}
        </section>
      </div>

      {inspectorOpen && selectedAgent ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={() => setInspectorOpen(false)}>
          <div className="max-h-[88vh] w-full max-w-[980px] overflow-auto" onMouseDown={(e) => e.stopPropagation()}>
            <InspectorPanel
              mode="modal"
              agent={selectedAgent}
              teams={teams}
              tools={tools}
              skills={skills}
              knowledge={knowledge}
              onClose={() => setInspectorOpen(false)}
              onSaveConfig={saveConfig}
              onAssignTool={assignTool}
              onRemoveTool={removeTool}
              onAssignKnowledge={assignKnowledge}
              onRemoveKnowledge={removeKnowledge}
              onAssignSkill={assignSkill}
              onRemoveSkill={removeSkill}
            />
          </div>
        </div>
      ) : null}
      {workflowStepModal ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={() => setWorkflowStepModal(null)}>
          <div className="max-h-[86vh] w-full max-w-[720px] overflow-auto rounded-3xl border border-slate-700 bg-slate-950/95 p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.2em] text-amber-100">{workflowStepModal.caption}</div>
                {workflowStepModal.phase ? <div className="mt-1 text-xs font-semibold text-slate-500">{workflowStepModal.phase}</div> : null}
                <div className="mt-2 text-2xl font-semibold text-slate-100">{workflowStepModal.title}</div>
              </div>
              <button className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-slate-500" onClick={() => setWorkflowStepModal(null)}>
                Fechar
              </button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Etapa</div>
                <div className="mt-1 text-lg font-semibold text-slate-100">{workflowStepModal.stepNumber}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Tipo</div>
                <div className="mt-1 text-lg font-semibold capitalize text-slate-100">{workflowStepModal.kind}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Agente</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{workflowStepModal.agentName || "IAM Orchestrator"}</div>
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Detalhes da etapa</div>
              <div className="mt-3 text-sm leading-7 text-slate-200">{workflowStepModal.detail}</div>
            </div>

            {workflowStepModal.bullets?.length ? (
              <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
                <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Protocolo de interacao</div>
                <div className="mt-3 space-y-2">
                  {workflowStepModal.bullets.map((item) => (
                    <div key={item} className="rounded-2xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm leading-6 text-slate-200">
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-900/65 p-4">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Integracoes relacionadas</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {(workflowStepModal.integrations || []).map((integration) => (
                  <span key={integration} className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-xs text-slate-300">
                    {integration}
                  </span>
                ))}
                {!workflowStepModal.integrations?.length ? <span className="text-xs text-slate-500">Nenhuma integracao destacada para esta etapa.</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
