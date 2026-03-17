import "dotenv/config";
import { AgentType, PrismaClient } from "@prisma/client";
import { ensureSchema } from "../src/init-db.js";

const prisma = new PrismaClient();
const agnoBaseUrl = process.env.AGNO_BASE_URL || "http://agno_service:8010";

const falconRuntimeConfig = {
  domainPlanner: {
    enabled: true,
    domain: "falcon",
    tasks: [
      { id: "falcon_list_host_inventory", name: "List host inventory", when: "Listar hostnames, hosts ou endpoints do Falcon.", operation: "falcon_search_hosts", summary: "Host inventory", query: { limit: 20, sort: "hostname.asc" } },
      { id: "falcon_count_hosts", name: "Count hosts", when: "Contar hosts ou endpoints no Falcon.", operation: "falcon_search_hosts", summary: "Host count source", query: { limit: 5000, sort: "hostname.asc" } },
      { id: "falcon_recent_detections", name: "Recent detections", when: "Deteccoes, alertas e hunting recente no Falcon.", operation: "falcon_search_detections", summary: "Detections", query: { limit: 20 } },
    ],
  },
};

const jumpcloudRuntimeConfig = {
  domainPlanner: {
    enabled: true,
    domain: "jumpcloud",
    tasks: [
      { id: "jumpcloud_list_users", name: "List users", when: "Listar usuarios ou contas do JumpCloud.", operation: "list_users", summary: "Users", query: { limit: 10 } },
      { id: "jumpcloud_list_systems", name: "List systems", when: "Listar devices, systems, hosts ou endpoints do JumpCloud.", operation: "list_systems", summary: "Systems", query: { limit: 10 } },
      { id: "jumpcloud_list_user_groups", name: "List user groups", when: "Listar grupos de usuarios do JumpCloud.", operation: "list_user_groups", summary: "User groups", query: { limit: 10 } },
      { id: "jumpcloud_list_system_groups", name: "List system groups", when: "Listar grupos de devices ou systems do JumpCloud.", operation: "list_system_groups", summary: "System groups", query: { limit: 10 } },
      { id: "jumpcloud_list_policies", name: "List policies", when: "Listar policies do JumpCloud.", operation: "list_policies", summary: "Policies", query: { limit: 10 } },
      { id: "jumpcloud_recent_login_events", name: "Recent login events", when: "Logins, autenticacao, MFA, SSO e eventos recentes de acesso.", operation: "list_directory_events", summary: "Recent login events", query: { service: "directory", limit: 50 } },
      { id: "jumpcloud_last_failed_password_login", name: "Latest failed login events", when: "Ultimo usuario a errar senha, tentativas de login com falha ou password incorreta.", operation: "list_directory_events", summary: "Latest failed login events", query: { service: "directory", limit: 50 } },
    ],
  },
};

type AgnoCatalog = {
  tools?: Array<{
    name: string;
    description?: string | null;
    callName?: string | null;
    type: "slack" | "confluence" | "jira" | "http" | "internal";
    policy: "read" | "write";
    transport?: string | null;
    mode?: "mock" | "real" | null;
    visibility?: "private" | "shared" | null;
    ownerTeamKey?: string | null;
    runtimeSource?: string | null;
    linkedAgentNames?: string[] | null;
  }>;
  skills?: Array<{
    name: string;
    description?: string | null;
    prompt: string;
    category: string;
    enabled: boolean;
    runbookUrl?: string | null;
    visibility?: "private" | "shared" | null;
    ownerTeamKey?: string | null;
    runtimeSource?: string | null;
    linkedAgentNames?: string[] | null;
  }>;
};

async function fetchAgnoCatalog(): Promise<AgnoCatalog | null> {
  try {
    const res = await fetch(`${agnoBaseUrl}/catalog`);
    if (!res.ok) return null;
    return (await res.json()) as AgnoCatalog;
  } catch {
    return null;
  }
}

async function ensureFalconEdrAnalyst() {
  const team = await prisma.team.findUnique({ where: { key: "DNR" } });
  if (!team) {
    console.warn("sync-agno-catalog: team DNR not found; skipping Falcon EDR Analyst sync.");
    return;
  }

  const [supervisor, ticketAgent, knowledge] = await Promise.all([
    prisma.agent.findFirst({ where: { type: AgentType.SUPERVISOR, isGlobal: true } }),
    prisma.agent.findFirst({ where: { type: AgentType.TICKET, isGlobal: true } }),
    prisma.knowledgeSource.findFirst({ where: { ownerTeamId: team.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const existingFalconAgent = await prisma.agent.findUnique({
    where: { name_teamId: { name: "Falcon EDR Analyst", teamId: team.id } },
  });
  const falconAgent = existingFalconAgent?.userCustomized
    ? existingFalconAgent
    : await prisma.agent.upsert({
        where: { name_teamId: { name: "Falcon EDR Analyst", teamId: team.id } },
        update: {
          description: "Analista senior de EDR focado em CrowdStrike Falcon para triagem, investigacao e hunting.",
          prompt:
            "Atue como analista senior de EDR focado em CrowdStrike Falcon. Trabalhe apenas em modo leitura para investigacao, triagem, hunting e recomendacao. " +
            "Considere como prioridades incidentes ativos, deteccoes criticas, persistence, privilege escalation, credential access, lateral movement, beaconing, cadeias pai/filho anomalas e sinais de ransomware. " +
            "Explique fatos observados, inferencias, hipoteses, lacunas e proximos passos de forma objetiva.",
          tags: ["dnr", "falcon", "edr", "crowdstrike", "hunting", "detection", "response", "specialist"],
          type: AgentType.SPECIALIST,
          isGlobal: false,
          visibility: "private",
          runtimeConfig: falconRuntimeConfig,
        },
        create: {
          name: "Falcon EDR Analyst",
          description: "Analista senior de EDR focado em CrowdStrike Falcon para triagem, investigacao e hunting.",
          prompt:
            "Atue como analista senior de EDR focado em CrowdStrike Falcon. Trabalhe apenas em modo leitura para investigacao, triagem, hunting e recomendacao. " +
            "Considere como prioridades incidentes ativos, deteccoes criticas, persistence, privilege escalation, credential access, lateral movement, beaconing, cadeias pai/filho anomalas e sinais de ransomware. " +
            "Explique fatos observados, inferencias, hipoteses, lacunas e proximos passos de forma objetiva.",
          tags: ["dnr", "falcon", "edr", "crowdstrike", "hunting", "detection", "response", "specialist"],
          type: AgentType.SPECIALIST,
          isGlobal: false,
          visibility: "private",
          runtimeConfig: falconRuntimeConfig,
          teamId: team.id,
        },
      });

  if (supervisor && !supervisor.userCustomized && !falconAgent.userCustomized) {
    await prisma.handoff.upsert({
      where: {
        fromAgentId_toAgentId: {
          fromAgentId: supervisor.id,
          toAgentId: falconAgent.id,
        },
      },
      update: {
        conditionExpr: "falcon edr crowdstrike hunting detections",
        priority: 85,
      },
      create: {
        fromAgentId: supervisor.id,
        toAgentId: falconAgent.id,
        conditionExpr: "falcon edr crowdstrike hunting detections",
        priority: 85,
      },
    });
  }

  if (ticketAgent && !ticketAgent.userCustomized && !falconAgent.userCustomized) {
    await prisma.handoff.upsert({
      where: {
        fromAgentId_toAgentId: {
          fromAgentId: falconAgent.id,
          toAgentId: ticketAgent.id,
        },
      },
      update: {
        conditionExpr: "ticket required",
        priority: 80,
      },
      create: {
        fromAgentId: falconAgent.id,
        toAgentId: ticketAgent.id,
        conditionExpr: "ticket required",
        priority: 80,
      },
    });
  }

  if (knowledge && !knowledge.userCustomized && !falconAgent.userCustomized) {
    await prisma.agentKnowledge.upsert({
      where: {
        agentId_knowledgeSourceId: {
          agentId: falconAgent.id,
          knowledgeSourceId: knowledge.id,
        },
      },
      update: {},
      create: {
        agentId: falconAgent.id,
        knowledgeSourceId: knowledge.id,
      },
    });
  }

  console.log(
    existingFalconAgent?.userCustomized
      ? 'sync-agno-catalog: Falcon EDR Analyst preservado por customizacao do usuario.'
      : "sync-agno-catalog: Falcon EDR Analyst synchronized.",
  );
}

async function ensureJumpCloudDirectoryAnalyst() {
  const team = await prisma.team.findUnique({ where: { key: "IAM_IGA" } });
  if (!team) {
    console.warn("sync-agno-catalog: team IAM_IGA not found; skipping JumpCloud Directory Analyst sync.");
    return;
  }

  const [supervisor, ticketAgent, knowledge] = await Promise.all([
    prisma.agent.findFirst({ where: { type: AgentType.SUPERVISOR, isGlobal: true } }),
    prisma.agent.findFirst({ where: { type: AgentType.TICKET, isGlobal: true } }),
    prisma.knowledgeSource.findFirst({ where: { ownerTeamId: team.id }, orderBy: { createdAt: "asc" } }),
  ]);

  const existingAgent = await prisma.agent.findUnique({
    where: { name_teamId: { name: "JumpCloud Directory Analyst", teamId: team.id } },
  });
  const jumpCloudAgent = existingAgent?.userCustomized
    ? existingAgent
    : await prisma.agent.upsert({
        where: { name_teamId: { name: "JumpCloud Directory Analyst", teamId: team.id } },
        update: {
          description: "Especialista de IAM/IGA focado em JumpCloud para investigacao, triagem e analise de usuarios, grupos, devices e eventos.",
          prompt:
            "Atue como especialista senior de IAM/IGA focado em JumpCloud. Use verificacoes factuais em usuarios, grupos, devices e Directory Insights antes de responder. " +
            "Priorize estado atual, escopo do impacto, memberships, vinculos de dispositivos, eventos recentes e proximos passos operacionais. " +
            "Separe fatos observados de inferencias, lacunas e recomendacoes.",
          tags: ["iam", "iga", "jumpcloud", "directory", "identity", "devices", "groups", "events", "specialist"],
          type: AgentType.SPECIALIST,
          isGlobal: false,
          visibility: "private",
          runtimeConfig: jumpcloudRuntimeConfig,
        },
        create: {
          name: "JumpCloud Directory Analyst",
          description: "Especialista de IAM/IGA focado em JumpCloud para investigacao, triagem e analise de usuarios, grupos, devices e eventos.",
          prompt:
            "Atue como especialista senior de IAM/IGA focado em JumpCloud. Use verificacoes factuais em usuarios, grupos, devices e Directory Insights antes de responder. " +
            "Priorize estado atual, escopo do impacto, memberships, vinculos de dispositivos, eventos recentes e proximos passos operacionais. " +
            "Separe fatos observados de inferencias, lacunas e recomendacoes.",
          tags: ["iam", "iga", "jumpcloud", "directory", "identity", "devices", "groups", "events", "specialist"],
          type: AgentType.SPECIALIST,
          isGlobal: false,
          visibility: "private",
          runtimeConfig: jumpcloudRuntimeConfig,
          teamId: team.id,
        },
      });

  if (supervisor && !supervisor.userCustomized && !jumpCloudAgent.userCustomized) {
    await prisma.handoff.upsert({
      where: {
        fromAgentId_toAgentId: {
          fromAgentId: supervisor.id,
          toAgentId: jumpCloudAgent.id,
        },
      },
      update: {
        conditionExpr: "jumpcloud identity iga directory user group device access",
        priority: 80,
      },
      create: {
        fromAgentId: supervisor.id,
        toAgentId: jumpCloudAgent.id,
        conditionExpr: "jumpcloud identity iga directory user group device access",
        priority: 80,
      },
    });
  }

  if (ticketAgent && !ticketAgent.userCustomized && !jumpCloudAgent.userCustomized) {
    await prisma.handoff.upsert({
      where: {
        fromAgentId_toAgentId: {
          fromAgentId: jumpCloudAgent.id,
          toAgentId: ticketAgent.id,
        },
      },
      update: {
        conditionExpr: "ticket required",
        priority: 75,
      },
      create: {
        fromAgentId: jumpCloudAgent.id,
        toAgentId: ticketAgent.id,
        conditionExpr: "ticket required",
        priority: 75,
      },
    });
  }

  if (knowledge && !knowledge.userCustomized && !jumpCloudAgent.userCustomized) {
    await prisma.agentKnowledge.upsert({
      where: {
        agentId_knowledgeSourceId: {
          agentId: jumpCloudAgent.id,
          knowledgeSourceId: knowledge.id,
        },
      },
      update: {},
      create: {
        agentId: jumpCloudAgent.id,
        knowledgeSourceId: knowledge.id,
      },
    });
  }

  console.log(
    existingAgent?.userCustomized
      ? 'sync-agno-catalog: JumpCloud Directory Analyst preservado por customizacao do usuario.'
      : "sync-agno-catalog: JumpCloud Directory Analyst synchronized.",
  );
}

async function linkToolToAgents(toolName: string, linkedAgentNames: string[] | null | undefined): Promise<void> {
  if (!linkedAgentNames?.length) return;
  const tool = await prisma.tool.findUnique({ where: { name: toolName } });
  if (!tool) return;
  for (const agentName of linkedAgentNames) {
    const agent = await prisma.agent.findFirst({ where: { name: agentName } });
    if (!agent) continue;
    await prisma.agentTool.upsert({
      where: { agentId_toolId: { agentId: agent.id, toolId: tool.id } },
      update: { canRead: true },
      create: { agentId: agent.id, toolId: tool.id, canRead: true, canWrite: false },
    });
  }
}

async function linkSkillToAgents(skillName: string, ownerTeamId: string | null, linkedAgentNames: string[] | null | undefined): Promise<void> {
  if (!linkedAgentNames?.length) return;
  const skill = await prisma.skill.findFirst({ where: { name: skillName, ownerTeamId } });
  if (!skill) return;
  for (const agentName of linkedAgentNames) {
    const agent = await prisma.agent.findFirst({ where: { name: agentName } });
    if (!agent) continue;
    await prisma.agentSkill.upsert({
      where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
      update: {},
      create: { agentId: agent.id, skillId: skill.id },
    });
  }
}

async function main() {
  await ensureSchema(prisma);
  await ensureFalconEdrAnalyst();
  await ensureJumpCloudDirectoryAnalyst();

  const catalog = await fetchAgnoCatalog();
  if (!catalog) {
    console.warn("sync-agno-catalog: unable to fetch /catalog from agno service; skipping runtime catalog sync.");
    return;
  }

  const teams = await prisma.team.findMany();
  const teamByKey = new Map(teams.map((team) => [team.key, team]));
  const skipped: string[] = [];
  let syncedTools = 0;
  let syncedSkills = 0;

  for (const tool of catalog.tools || []) {
    const ownerTeam = tool.ownerTeamKey ? teamByKey.get(tool.ownerTeamKey) : null;
    const currentTool = await prisma.tool.findUnique({ where: { name: tool.name } });
    if (currentTool?.userCustomized) {
      skipped.push(`Tool "${tool.name}" preservada por customizacao do usuario.`);
      continue;
    }
    await prisma.tool.upsert({
      where: { name: tool.name },
      update: {
        description: tool.description || null,
        callName: tool.callName || null,
        transport: tool.transport || "internal",
        endpoint: null,
        method: "POST",
        authRef: null,
        timeoutMs: 30000,
        type: tool.type,
        mode: tool.mode || "real",
        policy: tool.policy,
        riskLevel: "low",
        dataClassificationIn: "internal",
        dataClassificationOut: "internal",
        inputSchema: {},
        outputSchema: {},
        rateLimitPerMinute: 120,
        visibility: tool.visibility || "shared",
        managedBy: "agno",
        runtimeSource: tool.runtimeSource || "agno",
        teamId: ownerTeam?.id || null,
      },
      create: {
        name: tool.name,
        description: tool.description || null,
        callName: tool.callName || null,
        transport: tool.transport || "internal",
        endpoint: null,
        method: "POST",
        authRef: null,
        timeoutMs: 30000,
        type: tool.type,
        mode: tool.mode || "real",
        policy: tool.policy,
        riskLevel: "low",
        dataClassificationIn: "internal",
        dataClassificationOut: "internal",
        inputSchema: {},
        outputSchema: {},
        rateLimitPerMinute: 120,
        visibility: tool.visibility || "shared",
        managedBy: "agno",
        runtimeSource: tool.runtimeSource || "agno",
        teamId: ownerTeam?.id || null,
      },
    });
    syncedTools += 1;
    await linkToolToAgents(tool.name, tool.linkedAgentNames);
  }

  for (const skill of catalog.skills || []) {
    const ownerTeam = skill.ownerTeamKey ? teamByKey.get(skill.ownerTeamKey) : null;
    const currentSkill = await prisma.skill.findFirst({
      where: { name: skill.name, ownerTeamId: ownerTeam?.id || null },
    });
    if (currentSkill?.userCustomized) {
      skipped.push(`Skill "${skill.name}" preservada por customizacao do usuario.`);
      continue;
    }
    if (currentSkill) {
      await prisma.skill.update({
        where: { id: currentSkill.id },
        data: {
          description: skill.description || "",
          prompt: skill.prompt,
          runbookUrl: skill.runbookUrl || null,
          category: skill.category,
          enabled: skill.enabled,
          visibility: skill.visibility || "shared",
          managedBy: "agno",
          runtimeSource: skill.runtimeSource || "agno",
          ownerTeamId: ownerTeam?.id || null,
        },
      });
      syncedSkills += 1;
      continue;
    }
    await prisma.skill.create({
      data: {
        description: skill.description || "",
        prompt: skill.prompt,
        runbookUrl: skill.runbookUrl || null,
        category: skill.category,
        enabled: skill.enabled,
        visibility: skill.visibility || "shared",
        managedBy: "agno",
        runtimeSource: skill.runtimeSource || "agno",
        ownerTeamId: ownerTeam?.id || null,
        name: skill.name,
      },
    });
    syncedSkills += 1;
    await linkSkillToAgents(skill.name, ownerTeam?.id || null, skill.linkedAgentNames);
    continue;
  }
  for (const skill of catalog.skills || []) {
    const ownerTeam = skill.ownerTeamKey ? teamByKey.get(skill.ownerTeamKey) : null;
    await linkSkillToAgents(skill.name, ownerTeam?.id || null, skill.linkedAgentNames);
  }

  console.log(JSON.stringify({
    ok: true,
    tools: syncedTools,
    skills: syncedSkills,
    skipped,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
