import type { Agent, Role, Tool } from "@prisma/client";
import type { SessionUser } from "./types.js";

type PolicyInput = {
  actor: SessionUser;
  action: string;
  ownerTeamId?: string | null;
  agent?: Agent | null;
  tool?: Tool | null;
  requiresWrite?: boolean;
  justification?: string;
  commit?: boolean;
};

export type PolicyResult = { allow: boolean; reason?: string };

function isSameTeam(actor: SessionUser, ownerTeamId?: string | null): boolean {
  if (!ownerTeamId) return false;
  return actor.teamId === ownerTeamId;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult { // NOSONAR
  const { actor, action, ownerTeamId, agent, tool, requiresWrite, justification, commit } = input;

  if (actor.role === "ADMIN") return { allow: true };

  if (actor.role === "OPERATOR") {
    if (action.startsWith("read:") || action.startsWith("simulate:")) return { allow: true };
    return { allow: false, reason: "Operator is read-only." };
  }

  if (actor.role === "TEAM_MAINTAINER") {
    if (!isSameTeam(actor, ownerTeamId) && !agent?.isGlobal) {
      return { allow: false, reason: "Cross-team change denied." };
    }

    if (action === "agent:update" && agent?.type === "SUPERVISOR" && agent.isGlobal) {
      return { allow: false, reason: "Global Supervisor can only be edited by Admin." };
    }

    if ((action === "agent:create" || action === "agent:update") && agent?.isGlobal) {
      return { allow: false, reason: "Global agents can only be managed by Admin." };
    }

    if (action.startsWith("tool:") && tool?.policy === "write") {
      return { allow: false, reason: "TeamMaintainer cannot create/edit write tools." };
    }

    if (requiresWrite && !justification) {
      return { allow: false, reason: "Write operations require justification." };
    }

    if (action === "ticket:commit" && !commit) {
      return { allow: false, reason: "Two-step required: prepare before commit." };
    }

    return { allow: true };
  }

  return { allow: false, reason: "Default deny." };
}
