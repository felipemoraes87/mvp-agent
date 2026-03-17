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
import type { AgentWithLinks, Handoff, KnowledgeSource, Skill, Team, Tool } from "../lib/types";
import { AgentNode } from "../components/AgentNode";
import { ConnectionEdge } from "../components/ConnectionEdge";
import { InspectorPanel } from "../components/InspectorPanel";
import { ResourceNode } from "../components/ResourceNode";
import { useAuth } from "../lib/auth";

const nodeTypes = { agentNode: AgentNode, resourceNode: ResourceNode };
const edgeTypes = { connectionEdge: ConnectionEdge };

const LAYOUT_H_GAP = 330;
const LAYOUT_V_GAP = 155;
const LAYOUT_START_X = 90;
const LAYOUT_START_Y = 90;
const COMPONENT_V_GAP = 120;
const ALL_TEAMS_VALUE = "__ALL__";

type GraphResponse = { nodes: Array<{ id: string }>; edges: Handoff[] };

type ChannelRecord = { id: string; enabled: boolean };

function generateAgentSuffix(): string {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  return String(random[0] % 1000).padStart(3, "0");
}

function readEnabledChannelsCount(): number {
  try {
    const raw = localStorage.getItem("studio.channels.config.v2") || localStorage.getItem("studio.channels.config.v1");
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as ChannelRecord[];
    return parsed.filter((channel) => channel.enabled).length;
  } catch {
    return 0;
  }
}

function sortByAgentPriority(a: AgentWithLinks, b: AgentWithLinks): number {
  const rank = { SUPERVISOR: 0, SPECIALIST: 1, TICKET: 2 } as const;
  const r = rank[a.type] - rank[b.type];
  if (r !== 0) return r;
  return a.name.localeCompare(b.name);
}

function buildSmartLayout(agents: AgentWithLinks[], handoffs: Handoff[]): Map<string, { x: number; y: number }> { // NOSONAR
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(agents.map((a) => [a.id, a]));
  const nodeIds = new Set(agents.map((a) => a.id));

  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map<string, number>();
  const undirected = new Map<string, string[]>();

  for (const id of nodeIds) {
    outgoing.set(id, []);
    incomingCount.set(id, 0);
    undirected.set(id, []);
  }

  for (const edge of handoffs) {
    if (!nodeIds.has(edge.fromAgentId) || !nodeIds.has(edge.toAgentId)) continue;
    outgoing.get(edge.fromAgentId)!.push(edge.toAgentId);
    incomingCount.set(edge.toAgentId, (incomingCount.get(edge.toAgentId) || 0) + 1);
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
      const cur = queue.shift()!;
      component.push(cur);
      for (const nxt of undirected.get(cur) || []) {
        if (visited.has(nxt)) continue;
        visited.add(nxt);
        queue.push(nxt);
      }
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);

  let currentY = LAYOUT_START_Y;

  for (const component of components) {
    const compSet = new Set(component);
    const compIncoming = new Map<string, number>();
    const compOutgoing = new Map<string, string[]>();
    const layer = new Map<string, number>();
    const processed = new Set<string>();

    for (const id of component) {
      compIncoming.set(id, 0);
      compOutgoing.set(id, []);
    }

    for (const id of component) {
      for (const to of outgoing.get(id) || []) {
        if (!compSet.has(to)) continue;
        compOutgoing.get(id)!.push(to);
        compIncoming.set(to, (compIncoming.get(to) || 0) + 1);
      }
    }

    const roots = component
      .filter((id) => (compIncoming.get(id) || 0) === 0)
      .map((id) => byId.get(id)!)
      .sort(sortByAgentPriority)
      .map((a) => a.id);

    const queue = [...roots];
    for (const id of queue) layer.set(id, 0);

    while (queue.length) {
      const cur = queue.shift()!;
      processed.add(cur);
      const curLayer = layer.get(cur) || 0;

      for (const nxt of compOutgoing.get(cur) || []) {
        const nextLayer = Math.max(layer.get(nxt) ?? 0, curLayer + 1);
        layer.set(nxt, nextLayer);
        compIncoming.set(nxt, (compIncoming.get(nxt) || 0) - 1);
        if ((compIncoming.get(nxt) || 0) <= 0) queue.push(nxt);
      }
    }

    const leftovers = component.filter((id) => !processed.has(id));
    leftovers
      .map((id) => byId.get(id)!)
      .sort(sortByAgentPriority)
      .forEach((agent, idx) => {
        layer.set(agent.id, 1 + (idx % 3));
      });

    const layers = new Map<number, AgentWithLinks[]>();
    for (const id of component) {
      const l = layer.get(id) || 0;
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l)!.push(byId.get(id)!);
    }

    let maxLayerSize = 1;
    const orderedLayers = Array.from(layers.keys()).sort((a, b) => a - b);
    for (const l of orderedLayers) {
      const arr = layers.get(l)!.sort(sortByAgentPriority);
      maxLayerSize = Math.max(maxLayerSize, arr.length);
      arr.forEach((agent, idx) => {
        positions.set(agent.id, {
          x: LAYOUT_START_X + l * LAYOUT_H_GAP,
          y: currentY + idx * LAYOUT_V_GAP,
        });
      });
    }

    currentY += maxLayerSize * LAYOUT_V_GAP + COMPONENT_V_GAP;
  }

  return positions;
}

function buildResourceDecorations(agent: AgentWithLinks, baseNodes: Node[]): { nodes: Node[]; edges: Edge[] } {
  const core = baseNodes.find((node) => node.id === agent.id);
  if (!core) return { nodes: [], edges: [] };

  const toolCount = agent.toolLinks?.length || 0;
  const knowledgeCount = agent.knowledgeLinks?.length || 0;
  const skillCount = agent.skillLinks?.length || 0;
  const writePermCount = (agent.toolLinks || []).filter((link) => link.canWrite).length;
  const channelCount = readEnabledChannelsCount();

  const resources = [
    { key: "tools", label: "Tools", count: toolCount, dx: -210, dy: -110, color: "#22c55e" },
    { key: "knowledge", label: "Knowledge", count: knowledgeCount, dx: 220, dy: -110, color: "#38bdf8" },
    { key: "skills", label: "Skills", count: skillCount, dx: -220, dy: 120, color: "#a78bfa" },
    { key: "permissions", label: "Permissions", count: writePermCount, dx: 220, dy: 120, color: "#f59e0b" },
    { key: "channels", label: "Channels", count: channelCount, dx: 0, dy: 220, color: "#f97316" },
  ];

  const nodes: Node[] = resources.map((res) => ({
    id: `${agent.id}::resource::${res.key}`,
    type: "resourceNode",
    position: { x: core.position.x + res.dx, y: core.position.y + res.dy },
    draggable: false,
    selectable: false,
    data: { label: res.label, count: res.count, color: res.color },
  }));

  const edges: Edge[] = resources.map((res) => ({
    id: `${agent.id}::edge::${res.key}`,
    source: agent.id,
    sourceHandle:
      res.key === "tools"
        ? "port-tools"
        : res.key === "knowledge"
          ? "port-knowledge"
          : res.key === "skills"
            ? "port-skills"
            : res.key === "permissions"
              ? "port-permissions"
              : "port-channels",
    target: `${agent.id}::resource::${res.key}`,
    label: res.label,
    style: { stroke: "#64748b", strokeDasharray: "4 3" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#64748b", width: 12, height: 12 },
  }));

  return { nodes, edges };
}

export function GraphPage() { // NOSONAR
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState("");
  const [agents, setAgents] = useState<AgentWithLinks[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([]);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const load = useCallback(async (nextTeamId?: string) => {
    const teamRes = await apiGet<{ teams: Team[] }>("/api/teams");
    const effectiveTeamId = nextTeamId || teamId || (isAdmin ? ALL_TEAMS_VALUE : teamRes.teams[0]?.id || "");
    const isAllTeams = effectiveTeamId === ALL_TEAMS_VALUE;
    const [graphRes, agentRes, toolRes, skillRes, knowledgeRes] = await Promise.all([
      apiGet<GraphResponse>(`/api/graph${!isAllTeams && effectiveTeamId ? `?teamId=${effectiveTeamId}` : ""}`),
      apiGet<{ agents: AgentWithLinks[] }>("/api/agents"),
      apiGet<{ tools: Tool[] }>("/api/tools"),
      apiGet<{ skills: Skill[] }>("/api/skills"),
      apiGet<{ knowledgeSources: KnowledgeSource[] }>("/api/knowledge-sources"),
    ]);

    setTeams(teamRes.teams);
    setTools(toolRes.tools);
    setSkills(skillRes.skills);
    setKnowledge(knowledgeRes.knowledgeSources);

    if (teamId !== effectiveTeamId) setTeamId(effectiveTeamId);

    const nodeIds = new Set(graphRes.nodes.map((node) => node.id));
    const visibleAgents = agentRes.agents.filter((agent) => nodeIds.has(agent.id));
    setAgents(visibleAgents);

    const smartPositions = buildSmartLayout(visibleAgents, graphRes.edges);
    const laidOutNodes: Node[] = visibleAgents.map((agent) => {
      const teamLabel = agent.isGlobal ? "GLOBAL" : `${teamRes.teams.find((t) => t.id === agent.teamId)?.key || ""} ${agent.visibility}`;
      const pos = smartPositions.get(agent.id) || { x: LAYOUT_START_X, y: LAYOUT_START_Y };
      return {
        id: agent.id,
        type: "agentNode",
        position: pos,
        data: {
          name: agent.name,
          type: agent.type,
          teamLabel,
        },
      };
    });

    const highlightedPairs = new Set<string>();
    try {
      const savedPathRaw = localStorage.getItem("playground.lastPath") || localStorage.getItem("simulator.lastPath");
      if (savedPathRaw) {
        const path = JSON.parse(savedPathRaw) as string[];
        for (let i = 0; i < path.length - 1; i += 1) highlightedPairs.add(`${path[i]}::${path[i + 1]}`);
      }
    } catch {
      // ignore malformed local storage
    }

    const graphEdges: Edge[] = graphRes.edges.map((edge) => ({
      id: edge.id,
      source: edge.fromAgentId,
      sourceHandle: "out-main",
      target: edge.toAgentId,
      targetHandle: "in-main",
      type: "connectionEdge",
      label: edge.conditionExpr || "handoff",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8", width: 16, height: 16 },
      data: { highlighted: highlightedPairs.has(`${edge.fromAgentId}::${edge.toAgentId}`) },
    }));

    setNodes(laidOutNodes);
    setEdges(graphEdges);
  }, [teamId, setEdges, setNodes, isAdmin]);

  useEffect(() => {
    load().catch(() => {
      // no-op: initial load error is surfaced by API layer consumers
    });
  }, [load]);

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === selectedAgentId) || null, [agents, selectedAgentId]);

  useEffect(() => {
    setEdges((current) =>
      current.map((edge) => ({
        ...edge,
        data: {
          highlighted:
            Boolean(edge.data && (edge.data as { highlighted?: boolean }).highlighted) ||
            (hoveredNodeId ? edge.source === hoveredNodeId || edge.target === hoveredNodeId : false),
        },
      })),
    );
  }, [hoveredNodeId, setEdges]);

  const decorated = useMemo(() => {
    if (!selectedAgent) return { nodes, edges };
    const addon = buildResourceDecorations(selectedAgent, nodes);
    return {
      nodes: [...nodes, ...addon.nodes],
      edges: [...edges, ...addon.edges],
    };
  }, [selectedAgent, nodes, edges]);

  const onConnect: OnConnect = (params: Connection) => {
    if (!params.source || !params.target) return;
    apiPost("/api/handoffs", { fromAgentId: params.source, toAgentId: params.target, priority: 50 })
      .then(() => load(teamId))
      .catch(() => {
        // no-op: operation errors are handled centrally
      });
  };

  const deleteEdge = (id: string) => {
    if (!window.confirm("Delete this handoff connection?")) return;
    apiDelete(`/api/handoffs/${id}`)
      .then(() => load(teamId))
      .catch(() => {
        // no-op: operation errors are handled centrally
      });
  };

  const addAgent = () => {
    if (teamId === ALL_TEAMS_VALUE) return;
    apiPost("/api/agents", {
      name: `New Specialist ${generateAgentSuffix()}`,
      description: "New specialist node",
      prompt: "Handle team specific demand and escalate when needed.",
      tags: ["specialist"],
      type: "SPECIALIST",
      isGlobal: !teamId,
      visibility: "private",
      teamId: teamId || null,
    })
      .then(() => load(teamId))
      .catch(() => {
        // no-op: operation errors are handled centrally
      });
  };
  const isAllSelection = teamId === ALL_TEAMS_VALUE;

  const autoLayout = () => {
    const smartPositions = buildSmartLayout(
      agents,
      edges.map((edge) => ({
        id: edge.id,
        fromAgentId: edge.source,
        toAgentId: edge.target,
        conditionExpr: null,
        priority: 50,
      })),
    );
    setNodes((prev) => prev.map((node) => ({ ...node, position: smartPositions.get(node.id) || node.position })));
  };

  const saveConfig = async (payload: Partial<AgentWithLinks>) => {
    if (!selectedAgentId || !selectedAgent) return;
    await apiPut(`/api/agents/${selectedAgentId}`, {
      ...selectedAgent,
      ...payload,
      tags: payload.tags || selectedAgent.tags,
    });
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
    <div className="relative h-[calc(100vh-4.5rem)] overflow-hidden rounded-2xl border border-slate-700/70 bg-[var(--bg-elev)]">
      <section className="relative h-full min-w-0 flex-1">
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/80 p-2 backdrop-blur">
          <select
            className="input-dark min-w-40 !px-2 !py-1 text-xs"
            value={teamId}
            onChange={(e) => {
              const value = e.target.value;
              setTeamId(value);
              load(value).catch(() => {
                // no-op: operation errors are handled centrally
              });
            }}
          >
            {isAdmin ? <option value={ALL_TEAMS_VALUE}>Todos os times</option> : null}
            {teams.map((team) => (
              <option key={team.id} value={team.id}>{team.key} - {team.name}</option>
            ))}
          </select>
          <button className="btn-ghost !px-2 !py-1 text-xs" onClick={autoLayout}>Auto Layout</button>
          <button className={`btn-primary !px-2 !py-1 text-xs ${isAllSelection ? "opacity-60 cursor-not-allowed" : ""}`} disabled={isAllSelection} title={isAllSelection ? "Selecione um time especifico para criar agente" : ""} onClick={addAgent}>+ Agent</button>
        </div>

        <ReactFlow
          nodes={decorated.nodes}
          edges={decorated.edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            if (String(node.id).includes("::resource::")) return;
            setSelectedAgentId(node.id);
            setInspectorOpen(false);
          }}
          onNodeDoubleClick={(_, node) => {
            if (String(node.id).includes("::resource::")) return;
            setSelectedAgentId(node.id);
            setInspectorOpen(true);
          }}
          onNodeMouseEnter={(_, node) => {
            if (String(node.id).includes("::resource::")) return;
            setHoveredNodeId(node.id);
          }}
          onNodeMouseLeave={() => setHoveredNodeId(null)}
          onEdgeDoubleClick={(_, edge) => {
            if (String(edge.id).includes("::edge::")) return;
            deleteEdge(edge.id);
          }}
          defaultEdgeOptions={{ type: "connectionEdge", markerEnd: { type: MarkerType.ArrowClosed, color: "#818cf8" } }}
          fitView
          minZoom={0.3}
          maxZoom={1.8}
          className="h-full"
        >
          <Background variant={BackgroundVariant.Dots} color="#334155" size={1.4} gap={18} />
          <MiniMap
            pannable
            zoomable
            style={{ background: "#0f172a", border: "1px solid #334155" }}
            maskColor="rgba(15, 23, 42, 0.65)"
            nodeColor={() => "#6366f1"}
          />
          <Controls className="!bg-slate-900 !text-slate-200 !border !border-slate-700" />
        </ReactFlow>
      </section>

      {inspectorOpen && selectedAgent ? (
        <div
          className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4"
          onMouseDown={() => setInspectorOpen(false)}
        >
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
    </div>
  );
}
