import { MarkerType, type Edge, type Node } from "reactflow";
import type { AgentRecord, GraphConnectionRecord, GraphDataset, GraphFilters, GraphNodeData, GraphSummary, GraphView, NodeDetails, TeamRecord } from "./types";

const STATUS_COLORS = {
  healthy: "#22c55e",
  warning: "#f59e0b",
  error: "#ef4444",
  inactive: "#64748b",
  unknown: "#94a3b8",
} as const;

function matchesSearch(text: string, search: string): boolean {
  if (!search.trim()) return true;
  return text.toLowerCase().includes(search.trim().toLowerCase());
}

function shouldIncludeTeam(team: TeamRecord, filters: GraphFilters): boolean {
  if (!filters.showTeams) return false;
  if (!filters.nodeTypes.includes("team")) return false;
  if (filters.degradedOnly && team.status === "healthy") return false;
  return matchesSearch(`${team.name} ${team.key} ${team.description} ${team.domain}`, filters.search);
}

function shouldIncludeAgent(agent: AgentRecord, filters: GraphFilters): boolean {
  if (!filters.showAgents) return false;
  const entityType = agent.type === "COORDINATOR" ? "coordinator" : "agent";
  if (!filters.nodeTypes.includes(entityType)) return false;
  if (filters.coordinatorsOnly && agent.type !== "COORDINATOR") return false;
  if (filters.degradedOnly && !["warning", "error", "unknown"].includes(agent.status)) return false;
  return matchesSearch(`${agent.name} ${agent.summary} ${agent.description} ${agent.tags.join(" ")} ${agent.capabilities.join(" ")}`, filters.search);
}

function buildTeamNode(team: TeamRecord, agentCount: number, x: number, y: number): Node<GraphNodeData> {
  return {
    id: team.id,
    type: "teamNode",
    position: { x, y },
    data: {
      id: team.id,
      label: team.key,
      title: team.name,
      description: team.description,
      status: team.status,
      entityType: "team",
      subtitle: team.domain,
      badges: [team.active ? "active" : "inactive"],
      metrics: [
        { label: "Agents", value: String(agentCount) },
        { label: "Status", value: team.status },
      ],
    },
  };
}

function buildAgentNode(agent: AgentRecord, team: TeamRecord | undefined, x: number, y: number): Node<GraphNodeData> {
  const entityType = agent.type === "COORDINATOR" ? "coordinator" : "agent";
  return {
    id: agent.id,
    type: entityType === "coordinator" ? "coordinatorNode" : "agentNode",
    position: { x, y },
    data: {
      id: agent.id,
      label: agent.type,
      title: agent.name,
      description: agent.summary,
      status: agent.status,
      entityType,
      subtitle: team?.key,
      badges: agent.tags.slice(0, 3),
      metrics: [
        { label: "Tools", value: String(agent.tools.length) },
        { label: "MCPs", value: String(agent.mcps.length) },
      ],
    },
  };
}

function buildEdge(connection: GraphConnectionRecord): Edge {
  const color =
    connection.type === "contains" ? "#475569" :
    connection.type === "coordinates" ? "#818cf8" :
    connection.type === "depends_on" ? "#38bdf8" : "#f59e0b";

  return {
    id: connection.id,
    source: connection.source,
    target: connection.target,
    type: "smoothstep",
    label: connection.label,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    style: {
      stroke: color,
      strokeWidth: connection.critical ? 2.4 : 1.6,
      opacity: connection.critical ? 1 : 0.72,
    },
    labelStyle: {
      fill: "#cbd5e1",
      fontSize: 11,
      fontWeight: 600,
    },
  };
}

export function buildGraphView(dataset: GraphDataset, filters: GraphFilters): GraphView {
  const visibleTeams = dataset.teams.filter((team) => shouldIncludeTeam(team, filters));
  const visibleAgents = dataset.agents.filter((agent) => shouldIncludeAgent(agent, filters));
  const visibleIds = new Set<string>([...visibleTeams.map((team) => team.id), ...visibleAgents.map((agent) => agent.id)]);

  const teamNodes = visibleTeams.map((team, index) =>
    buildTeamNode(team, dataset.agents.filter((agent) => agent.teamId === team.id).length, 80, 100 + index * 250),
  );

  const agentGroups = new Map<string, AgentRecord[]>();
  for (const agent of visibleAgents) {
    const existing = agentGroups.get(agent.teamId) || [];
    existing.push(agent);
    agentGroups.set(agent.teamId, existing);
  }

  const agentNodes = visibleTeams.flatMap((team, teamIndex) => {
    const teamAgents = (agentGroups.get(team.id) || []).sort((a, b) => a.name.localeCompare(b.name));
    return teamAgents.map((agent, agentIndex) =>
      buildAgentNode(agent, team, 430 + agentIndex * 260, 60 + teamIndex * 250 + (agentIndex % 2) * 96),
    );
  });

  const orphanAgents = visibleAgents.filter((agent) => !visibleTeams.some((team) => team.id === agent.teamId));
  const orphanNodes = orphanAgents.map((agent, index) =>
    buildAgentNode(agent, dataset.teams.find((team) => team.id === agent.teamId), 430 + index * 260, 60),
  );

  const edges = dataset.connections.filter((connection) => visibleIds.has(connection.source) && visibleIds.has(connection.target)).map(buildEdge);

  return { nodes: [...teamNodes, ...agentNodes, ...orphanNodes], edges };
}

export function buildGraphSummary(dataset: GraphDataset): GraphSummary {
  const coordinators = dataset.agents.filter((agent) => agent.type === "COORDINATOR");
  const degraded = dataset.agents.filter((agent) => ["warning", "error", "unknown"].includes(agent.status));
  return {
    totalTeams: dataset.teams.length,
    totalAgents: dataset.agents.length,
    totalCoordinators: coordinators.length,
    totalConnections: dataset.connections.length,
    activeTeams: dataset.teams.filter((team) => team.active).length,
    degradedAgents: degraded.length,
    distribution: [
      { label: "Specialists", value: dataset.agents.filter((agent) => agent.type === "SPECIALIST").length },
      { label: "Coordinators", value: coordinators.length },
      { label: "Analysts", value: dataset.agents.filter((agent) => agent.type === "ANALYST").length },
      { label: "Integrations", value: dataset.agents.filter((agent) => agent.type === "INTEGRATION").length },
    ],
  };
}

export function buildNodeDetails(dataset: GraphDataset, nodeId: string | null): NodeDetails | null {
  if (!nodeId) return null;
  const team = dataset.teams.find((item) => item.id === nodeId);
  if (team) {
    const relations = dataset.connections.filter((connection) => connection.source === nodeId || connection.target === nodeId).map((connection) => connection.label);
    return {
      id: team.id,
      name: team.name,
      entityType: "team",
      description: team.description,
      status: team.status,
      tags: [team.key, team.domain],
      capabilities: ["team topology", "agent grouping", "coordination ownership"],
      tools: [],
      mcps: [],
      relations,
      lastUpdated: team.lastUpdated,
    };
  }

  const agent = dataset.agents.find((item) => item.id === nodeId);
  if (!agent) return null;
  const parentTeam = dataset.teams.find((teamItem) => teamItem.id === agent.teamId);
  const relations = dataset.connections.filter((connection) => connection.source === nodeId || connection.target === nodeId).map((connection) => `${connection.label} -> ${connection.source === nodeId ? connection.target : connection.source}`);
  return {
    id: agent.id,
    name: agent.name,
    entityType: agent.type === "COORDINATOR" ? "coordinator" : "agent",
    description: agent.description,
    status: agent.status,
    tags: agent.tags,
    capabilities: agent.capabilities,
    tools: agent.tools,
    mcps: agent.mcps,
    teamName: parentTeam?.name,
    relations,
    lastUpdated: agent.lastUpdated,
  };
}

export function statusColor(status: string): string {
  return STATUS_COLORS[status as keyof typeof STATUS_COLORS] || "#94a3b8";
}
