import type { Agent, Handoff, RoutingRule, Team } from "@prisma/client";

type SimInput = {
  message: string;
  teams: Team[];
  agents: Agent[];
  handoffs: Handoff[];
  rules: RoutingRule[];
  suggestedTeamId?: string;
  forcedAgentId?: string;
  contextTags?: string[];
};

export type SimulationResult = {
  chosenTeam: { id: string; key: string; name: string } | null;
  chosenAgent: { id: string; name: string; type: string } | null;
  confidence: number;
  justification: string[];
  top3: Array<{ agentId: string; agentName: string; score: number; reason: string }>;
  graphPath: string[];
  usedSources: Array<{ id: string; name: string; url: string }>;
};

function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_]/gu, " ")
    .split(/\s+/)
    .filter((x) => x.length > 2);
}

export function runSimulation(input: SimInput): SimulationResult { // NOSONAR
  const terms = tokenize(input.message);
  const termSet = new Set(terms);
  const context = new Set((input.contextTags || []).map((x) => x.toLowerCase()));
  const agentsById = new Map(input.agents.map((a) => [a.id, a]));

  function scoreKeyword(keyword: string): number {
    const kwTokens = tokenize(keyword);
    if (!kwTokens.length) return 0;
    if (kwTokens.length === 1) return termSet.has(kwTokens[0]) ? 1 : 0;
    return kwTokens.every((token) => termSet.has(token)) ? 1 : 0;
  }

  const teamScores = input.teams.map((team) => {
    const keyTerms = tokenize(`${team.name} ${team.key} ${team.description || ""}`);
    const overlap = terms.filter((t) => keyTerms.includes(t)).length;
    const bonus = input.suggestedTeamId && input.suggestedTeamId === team.id ? 2 : 0;
    return {
      team,
      score: overlap + bonus,
      reasons: [
        overlap > 0 ? `keyword overlap: ${overlap}` : "no direct keyword overlap",
        bonus ? "suggested team boost" : "",
      ].filter(Boolean),
    };
  });

  const ruleScores = input.rules
    .map((r) => {
      const keywords = Array.isArray(r.keywords) ? (r.keywords as string[]) : [];
      const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
      const kwScore = keywords.reduce((sum, keyword) => sum + scoreKeyword(keyword), 0);
      const tagScore = tags.filter((t) => context.has(t.toLowerCase())).length;
      return { rule: r, score: kwScore + tagScore };
    })
    .sort((a, b) => b.score - a.score);
  const matchingRule = ruleScores[0];
  const ruleTeamBoost = new Map<string, number>();
  const ruleBoostByAgentId = new Map<string, number>();
  for (const scored of ruleScores) {
    if (scored.score <= 0) continue;
    const current = ruleBoostByAgentId.get(scored.rule.targetAgentId) || 0;
    ruleBoostByAgentId.set(scored.rule.targetAgentId, current + scored.score * 2);
    const targetAgent = agentsById.get(scored.rule.targetAgentId);
    if (targetAgent?.teamId) {
      const teamCurrent = ruleTeamBoost.get(targetAgent.teamId) || 0;
      ruleTeamBoost.set(targetAgent.teamId, teamCurrent + scored.score * 2);
    }
  }

  const teamScoresWithRules = teamScores
    .map((item) => ({
      ...item,
      score: item.score + (ruleTeamBoost.get(item.team.id) || 0),
      reasons: [...item.reasons, (ruleTeamBoost.get(item.team.id) || 0) > 0 ? `rule team boost=${ruleTeamBoost.get(item.team.id)}` : ""].filter(Boolean),
    }))
    .sort((a, b) => b.score - a.score);
  const forcedAgent = input.forcedAgentId ? agentsById.get(input.forcedAgentId) : null;
  const forcedTeam = forcedAgent?.teamId ? input.teams.find((team) => team.id === forcedAgent.teamId) || null : null;
  const chosenTeam = forcedTeam || teamScoresWithRules[0]?.team || null;

  const teamAgents = forcedAgent
    ? input.agents.filter((a) => a.id === forcedAgent.id || a.isGlobal || a.visibility === "shared" || (forcedAgent.teamId ? a.teamId === forcedAgent.teamId : false))
    : input.agents.filter((a) => a.isGlobal || a.visibility === "shared" || a.teamId === chosenTeam?.id);
  const agentRank = teamAgents
    .map((agent) => {
      const tags = Array.isArray(agent.tags) ? (agent.tags as string[]) : [];
      const text = `${agent.name} ${agent.description} ${agent.prompt} ${tags.join(" ")}`;
      const overlap = terms.filter((t) => tokenize(text).includes(t)).length;
      const tagBoost = tags.filter((t) => context.has(t.toLowerCase())).length;
      return {
        agent,
        score: overlap + tagBoost,
        reason: `overlap=${overlap}, tagBoost=${tagBoost}`,
      };
    })
    .sort((a, b) => b.score - a.score);

  let path: string[] = [];
  const enrichedAgentRank = agentRank
    .map((item) => {
      const ruleBoost = ruleBoostByAgentId.get(item.agent.id) || 0;
      return {
        ...item,
        score: item.score + ruleBoost,
        reason: `${item.reason}, ruleBoost=${ruleBoost}`,
      };
    })
    .sort((a, b) => b.score - a.score);
  const specialistRank = enrichedAgentRank.filter((item) => item.agent.type === "SPECIALIST");
  const hasSignal = (teamScoresWithRules[0]?.score || 0) > 0 || (enrichedAgentRank[0]?.score || 0) > 0;
  let rankedTop = forcedAgent ? enrichedAgentRank.find((item) => item.agent.id === forcedAgent.id) || enrichedAgentRank[0] : enrichedAgentRank[0];

  // Avoid defaulting to global supervisor when there is no signal or tie.
  if (!forcedAgent && (!hasSignal || rankedTop?.agent.type === "SUPERVISOR") && specialistRank.length) {
    const bestSpecialist = specialistRank[0];
    if (!rankedTop || bestSpecialist.score >= rankedTop.score) rankedTop = bestSpecialist;
  }
  const rankedTopAgent = rankedTop?.agent;

  if (rankedTopAgent) {
    const supervisor = teamAgents.find((a) => a.type === "SUPERVISOR");
    const ticket = input.agents.find((a) => a.type === "TICKET");
    if (!forcedAgent && supervisor && supervisor.id !== rankedTopAgent.id) path.push(supervisor.name);
    path.push(rankedTopAgent.name);
    if (ticket) {
      const hasEdge = input.handoffs.some((h) => h.fromAgentId === rankedTopAgent.id && h.toAgentId === ticket.id);
      if (hasEdge && ticket.name !== rankedTopAgent.name) path.push(ticket.name);
    }
  }

  const confidence = Math.min(0.99, Math.max(0.15, (teamScoresWithRules[0]?.score || 0) / 8 + (rankedTop?.score || 0) / 10));

  return {
    chosenTeam: chosenTeam ? { id: chosenTeam.id, key: chosenTeam.key, name: chosenTeam.name } : null,
    chosenAgent: rankedTopAgent ? { id: rankedTopAgent.id, name: rankedTopAgent.name, type: rankedTopAgent.type } : null,
    confidence,
    justification: [
      ...(teamScoresWithRules[0]?.reasons || []),
      matchingRule ? `routing rule weight=${matchingRule.score}` : "no rule match",
      rankedTop?.reason || "no agent ranking",
      forcedAgent ? `forced start agent=${forcedAgent.name}` : "",
      !hasSignal ? "fallback to specialist due low signal" : "",
    ].filter(Boolean),
    top3: (forcedAgent
      ? [
          ...enrichedAgentRank.filter((item) => item.agent.id === forcedAgent.id),
          ...enrichedAgentRank.filter((item) => item.agent.id !== forcedAgent.id),
        ]
      : enrichedAgentRank
    )
      .slice(0, 3)
      .map((x) => ({ agentId: x.agent.id, agentName: x.agent.name, score: x.score, reason: x.reason })),
    graphPath: path,
    usedSources: [],
  };
}
