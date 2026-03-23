import type { Edge, Node } from "reactflow";

export type GraphNodeStatus = "healthy" | "warning" | "error" | "inactive" | "unknown";
export type GraphEntityType = "team" | "agent" | "coordinator";
export type GraphConnectionType = "contains" | "coordinates" | "depends_on" | "uses_tooling";

export type TeamRecord = {
  id: string;
  name: string;
  key: string;
  description: string;
  status: GraphNodeStatus;
  active: boolean;
  domain: string;
  agentIds: string[];
  coordinatorId?: string;
  lastUpdated: string;
};

export type AgentRecord = {
  id: string;
  name: string;
  summary: string;
  description: string;
  teamId: string;
  type: "SPECIALIST" | "COORDINATOR" | "ANALYST" | "INTEGRATION";
  status: GraphNodeStatus;
  capabilities: string[];
  tags: string[];
  tools: string[];
  mcps: string[];
  lastUpdated: string;
};

export type GraphConnectionRecord = {
  id: string;
  source: string;
  target: string;
  type: GraphConnectionType;
  label: string;
  critical?: boolean;
};

export type GraphDataset = {
  teams: TeamRecord[];
  agents: AgentRecord[];
  connections: GraphConnectionRecord[];
};

export type GraphFilters = {
  search: string;
  showTeams: boolean;
  showAgents: boolean;
  coordinatorsOnly: boolean;
  degradedOnly: boolean;
  nodeTypes: GraphEntityType[];
};

export type GraphNodeData = {
  id: string;
  label: string;
  title: string;
  description: string;
  status: GraphNodeStatus;
  entityType: GraphEntityType;
  subtitle?: string;
  badges?: string[];
  metrics?: Array<{ label: string; value: string }>;
};

export type GraphView = {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
};

export type GraphSummary = {
  totalTeams: number;
  totalAgents: number;
  totalCoordinators: number;
  totalConnections: number;
  activeTeams: number;
  degradedAgents: number;
  distribution: Array<{ label: string; value: number }>;
};

export type NodeDetails = {
  id: string;
  name: string;
  entityType: GraphEntityType;
  description: string;
  status: GraphNodeStatus;
  tags: string[];
  capabilities: string[];
  tools: string[];
  mcps: string[];
  teamName?: string;
  relations: string[];
  lastUpdated: string;
};
