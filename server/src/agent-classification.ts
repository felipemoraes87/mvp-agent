import type { Agent } from "@prisma/client";

export const AGENT_PERSONAS = ["SUPERVISOR", "SPECIALIST", "ANALYST", "EXECUTOR"] as const;
export const AGENT_ROUTING_ROLES = ["ENTRYPOINT", "DISPATCHER", "SPECIALIST", "TERMINAL", "FALLBACK"] as const;
export const AGENT_EXECUTION_PROFILES = ["READ_ONLY", "WRITE_GUARDED", "WRITE_ALLOWED", "APPROVAL_REQUIRED"] as const;

export type AgentPersona = (typeof AGENT_PERSONAS)[number];
export type AgentRoutingRole = (typeof AGENT_ROUTING_ROLES)[number];
export type AgentExecutionProfile = (typeof AGENT_EXECUTION_PROFILES)[number];

type AgentClassificationShape = {
  type?: string | null;
  persona?: string | null;
  routingRole?: string | null;
  executionProfile?: string | null;
  capabilities?: unknown;
  domains?: unknown;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function normalizeAgentPersona(agent: AgentClassificationShape): AgentPersona {
  if (agent.persona && AGENT_PERSONAS.includes(agent.persona as AgentPersona)) {
    return agent.persona as AgentPersona;
  }
  if (agent.type === "SUPERVISOR") return "SUPERVISOR";
  if (agent.type === "TICKET") return "EXECUTOR";
  return "SPECIALIST";
}

export function normalizeAgentRoutingRole(agent: AgentClassificationShape): AgentRoutingRole {
  if (agent.routingRole && AGENT_ROUTING_ROLES.includes(agent.routingRole as AgentRoutingRole)) {
    return agent.routingRole as AgentRoutingRole;
  }
  if (agent.type === "SUPERVISOR") return "ENTRYPOINT";
  if (agent.type === "TICKET") return "TERMINAL";
  return "SPECIALIST";
}

export function normalizeExecutionProfile(agent: AgentClassificationShape): AgentExecutionProfile {
  if (agent.executionProfile && AGENT_EXECUTION_PROFILES.includes(agent.executionProfile as AgentExecutionProfile)) {
    return agent.executionProfile as AgentExecutionProfile;
  }
  if (agent.type === "TICKET") return "WRITE_GUARDED";
  return "READ_ONLY";
}

export function normalizeCapabilities(agent: AgentClassificationShape): string[] {
  const explicit = asStringArray(agent.capabilities).map((item) => item.toLowerCase());
  if (explicit.length) return [...new Set(explicit)];

  const inferred = new Set<string>();
  const persona = normalizeAgentPersona(agent);
  const routingRole = normalizeAgentRoutingRole(agent);
  const executionProfile = normalizeExecutionProfile(agent);
  const domains = normalizeDomains(agent);

  if (routingRole === "ENTRYPOINT" || routingRole === "DISPATCHER") inferred.add("can_route");
  if (routingRole !== "TERMINAL") inferred.add("can_handoff");
  if (executionProfile !== "READ_ONLY") inferred.add("can_call_write_tools");
  if (executionProfile === "WRITE_GUARDED" || executionProfile === "WRITE_ALLOWED") inferred.add("can_open_ticket");
  if (persona === "SPECIALIST" || persona === "ANALYST" || persona === "SUPERVISOR") inferred.add("can_query_knowledge");
  if (domains.includes("falcon") || domains.includes("crowdstrike")) inferred.add("can_use_falcon_mcp");
  if (domains.includes("jumpcloud")) inferred.add("can_use_jumpcloud");

  return [...inferred];
}

export function normalizeDomains(agent: AgentClassificationShape): string[] {
  const explicit = asStringArray(agent.domains).map((item) => item.toLowerCase());
  if (explicit.length) return [...new Set(explicit)];
  return asStringArray((agent as { tags?: unknown }).tags).map((item) => item.toLowerCase());
}

export function canAgentUseWriteTools(agent: AgentClassificationShape): boolean {
  const profile = normalizeExecutionProfile(agent);
  const capabilities = normalizeCapabilities(agent);
  return capabilities.includes("can_call_write_tools") && profile !== "READ_ONLY";
}

export function classifyAgentFromLegacyType(type: string | null | undefined): {
  persona: AgentPersona;
  routingRole: AgentRoutingRole;
  executionProfile: AgentExecutionProfile;
  capabilities: string[];
} {
  const normalized = {
    type,
    persona: null,
    routingRole: null,
    executionProfile: null,
    capabilities: [],
    domains: [],
  };
  return {
    persona: normalizeAgentPersona(normalized),
    routingRole: normalizeAgentRoutingRole(normalized),
    executionProfile: normalizeExecutionProfile(normalized),
    capabilities: normalizeCapabilities(normalized),
  };
}

export function isSupervisorAgent(agent: AgentClassificationShape): boolean {
  return normalizeAgentPersona(agent) === "SUPERVISOR" || normalizeAgentRoutingRole(agent) === "ENTRYPOINT";
}

export function isTicketingAgent(agent: AgentClassificationShape): boolean {
  return normalizeAgentRoutingRole(agent) === "TERMINAL" || normalizeExecutionProfile(agent) !== "READ_ONLY";
}

export function isSpecialistAgent(agent: AgentClassificationShape): boolean {
  const persona = normalizeAgentPersona(agent);
  const routingRole = normalizeAgentRoutingRole(agent);
  return routingRole === "SPECIALIST" || persona === "SPECIALIST" || persona === "ANALYST";
}

export function getAgentClassification(agent: Agent | AgentClassificationShape) {
  return {
    persona: normalizeAgentPersona(agent),
    routingRole: normalizeAgentRoutingRole(agent),
    executionProfile: normalizeExecutionProfile(agent),
    capabilities: normalizeCapabilities(agent),
    domains: normalizeDomains(agent),
  };
}
