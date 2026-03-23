import "dotenv/config";
import { AgentExecutionProfile, AgentPersona, AgentRoutingRole, AgentType, PrismaClient } from "@prisma/client";
import { ensureSchema } from "../src/init-db.js";

const prisma = new PrismaClient();
const agnoBaseUrl = process.env.AGNO_BASE_URL || "http://agno_service:8010";

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

const iamWorkflowNames = [
  "Access Trace Workflow",
  "User Access Review Workflow",
  "Suspicious Authentication Investigation",
  "Provisioning / Reconciliation Diagnostic",
  "Documentation-Assisted Troubleshooting",
  "Controlled Change Proposal",
  "Entitlement Root Cause Analysis",
  "Access Adequacy Review",
  "IAM Risk Triage",
  "Knowledge-Assisted Investigation",
  "Controlled Change with Guardrails",
];

const iamCoordinatorRuntimeConfig = {
  iamTeamProfile: {
    role: "coordinator",
    teamKey: "IAM_IGA",
    defaultMode: "workflow_or_open_investigation",
    requiredIntegrations: [],
    reusableAgents: ["JumpCloud Directory Analyst"],
    workflowCatalog: iamWorkflowNames,
  },
};

const IAM_AGENT_NAMES = [
  "IAM Orchestrator",
  "JumpCloud Directory Analyst",
  "GitHub IAM Agent",
  "IGA Agent",
  "BigQuery IAM/Security Agent",
  "Jira/Confluence IAM Agent",
  "IAM Knowledge Agent",
  "Entitlement Reasoning Agent",
  "IAM Risk Analyst",
  "Change Guard / Approval Agent",
];

let managedHandoffDeleteTombstones: Set<string> | null = null;

function handoffKey(fromAgentId: string, toAgentId: string): string {
  return `${fromAgentId}::${toAgentId}`;
}

async function loadManagedHandoffDeleteTombstones(): Promise<Set<string>> {
  if (managedHandoffDeleteTombstones) return managedHandoffDeleteTombstones;
  const audits = await prisma.auditLog.findMany({
    where: {
      entityType: "handoff",
      action: { in: ["handoff:create", "handoff:delete"] },
    },
    orderBy: { createdAt: "asc" },
    select: { action: true, beforeJson: true, afterJson: true },
  });
  const latestActionByPair = new Map<string, string>();
  for (const audit of audits) {
    const raw = audit.afterJson || audit.beforeJson;
    if (!raw) continue;
    try {
      const payload = JSON.parse(raw) as { fromAgentId?: string; toAgentId?: string };
      if (!payload.fromAgentId || !payload.toAgentId) continue;
      latestActionByPair.set(handoffKey(payload.fromAgentId, payload.toAgentId), audit.action);
    } catch {
      continue;
    }
  }
  managedHandoffDeleteTombstones = new Set(
    Array.from(latestActionByPair.entries())
      .filter(([, action]) => action === "handoff:delete")
      .map(([key]) => key),
  );
  return managedHandoffDeleteTombstones;
}

async function upsertManagedHandoff({
  fromAgentId,
  toAgentId,
  conditionExpr,
  priority,
  label,
}: {
  fromAgentId: string;
  toAgentId: string;
  conditionExpr: string;
  priority: number;
  label: string;
}): Promise<void> {
  const existing = await prisma.handoff.findUnique({
    where: {
      fromAgentId_toAgentId: {
        fromAgentId,
        toAgentId,
      },
    },
  });
  if (!existing) {
    const deletedTombstones = await loadManagedHandoffDeleteTombstones();
    if (deletedTombstones.has(handoffKey(fromAgentId, toAgentId))) {
      console.log(`sync-agno-catalog: handoff skipped because it was deleted manually: ${label}`);
      return;
    }
  }
  await prisma.handoff.upsert({
    where: {
      fromAgentId_toAgentId: {
        fromAgentId,
        toAgentId,
      },
    },
    update: {
      conditionExpr,
      priority,
    },
    create: {
      fromAgentId,
      toAgentId,
      conditionExpr,
      priority,
    },
  });
}

function mergeRuntimeConfig(current: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  const currentValue = current && typeof current === "object" && !Array.isArray(current) ? (current as Record<string, unknown>) : {};
  return { ...currentValue, ...patch };
}

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
  workflows?: Array<{
    name: string;
    description?: string | null;
    objective: string;
    preconditions: string[];
    integrationKeys: string[];
    steps: string[];
    successCriteria: string[];
    outputFormat: string;
    failureHandling: string[];
    setupPoints: string[];
    enabled: boolean;
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

async function cleanupNonIamAgents() {
  const removableAgents = await prisma.agent.findMany({
    where: {
      userCustomized: false,
      name: { notIn: IAM_AGENT_NAMES },
    },
    select: { id: true, name: true },
  });
  if (!removableAgents.length) return;

  const agentIds = removableAgents.map((agent) => agent.id);
  await prisma.agentWorkflow.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agentSkill.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agentTool.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.agentKnowledge.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.handoff.deleteMany({
    where: {
      OR: [
        { fromAgentId: { in: agentIds } },
        { toAgentId: { in: agentIds } },
      ],
    },
  });
  await prisma.routingRule.deleteMany({
    where: {
      OR: [
        { targetAgentId: { in: agentIds } },
        { fallbackAgentId: { in: agentIds } },
      ],
    },
  });
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });

  console.log(`sync-agno-catalog: removed non-IAM managed agents: ${removableAgents.map((agent) => agent.name).join(", ")}`);
}

async function ensureJumpCloudDirectoryAnalyst() {
  const team = await prisma.team.findUnique({ where: { key: "IAM_IGA" } });
  if (!team) {
    console.warn("sync-agno-catalog: team IAM_IGA not found; skipping JumpCloud Directory Analyst sync.");
    return;
  }

  const [knowledge] = await Promise.all([
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
          persona: AgentPersona.ANALYST,
          routingRole: AgentRoutingRole.SPECIALIST,
          executionProfile: AgentExecutionProfile.READ_ONLY,
          capabilities: ["can_query_knowledge", "can_handoff", "can_use_jumpcloud"],
          domains: ["iam", "iga", "jumpcloud", "directory"],
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
          persona: AgentPersona.ANALYST,
          routingRole: AgentRoutingRole.SPECIALIST,
          executionProfile: AgentExecutionProfile.READ_ONLY,
          capabilities: ["can_query_knowledge", "can_handoff", "can_use_jumpcloud"],
          domains: ["iam", "iga", "jumpcloud", "directory"],
          isGlobal: false,
          visibility: "private",
          runtimeConfig: jumpcloudRuntimeConfig,
          teamId: team.id,
        },
      });

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

async function ensureIamTeam() {
  const team = await prisma.team.findUnique({ where: { key: "IAM_IGA" } });
  if (!team) {
    console.warn("sync-agno-catalog: team IAM_IGA not found; skipping IAM Team sync.");
    return;
  }

  const [knowledge, existingJumpCloudAgent] = await Promise.all([
    prisma.knowledgeSource.findFirst({ where: { ownerTeamId: team.id }, orderBy: { createdAt: "asc" } }),
    prisma.agent.findUnique({ where: { name_teamId: { name: "JumpCloud Directory Analyst", teamId: team.id } } }),
  ]);

  if (existingJumpCloudAgent && !existingJumpCloudAgent.userCustomized) {
    await prisma.agent.update({
      where: { id: existingJumpCloudAgent.id },
      data: {
        capabilities: Array.from(new Set([...(existingJumpCloudAgent.capabilities || []), "can_query_knowledge", "can_handoff", "can_use_jumpcloud"])),
        domains: Array.from(new Set([...(existingJumpCloudAgent.domains || []), "iam", "jumpcloud", "directory"])),
        runtimeConfig: mergeRuntimeConfig(existingJumpCloudAgent.runtimeConfig, {
          ...jumpcloudRuntimeConfig,
          iamTeamProfile: {
            role: "specialist",
            domain: "jumpcloud",
            requiredIntegrations: ["jumpcloud"],
            reusable: true,
            adapter: "reuse-existing-agent",
          },
        }),
      },
    });
  }

  const agentDefinitions = [
    {
      name: "IAM Orchestrator",
      description: "Coordenador do time de IAM. Classifica a intencao, escolhe playbook ou investigacao aberta, valida setup de integracoes e consolida evidencias.",
      prompt:
        "Atue como coordenador senior de IAM e seguranca. Classifique a demanda, selecione workflow conhecido ou investigacao aberta e chame apenas os agentes necessarios. " +
        "Antes de qualquer execucao, valide configuracao de integracoes na ordem correta. Use knowledge retrieval, entitlement reasoning, risk triage e change guard quando fizer sentido. " +
        "Separe fatos, inferencias, lacunas, riscos e proximos passos. Prefira leitura e diagnostico antes de qualquer acao de escrita e nunca aplique mudancas sem confirmacao explicita.",
      tags: ["iam", "orchestrator", "coordinator", "identity", "governance", "workflow", "knowledge", "risk", "guardrails"],
      type: AgentType.SUPERVISOR,
      persona: AgentPersona.SUPERVISOR,
      routingRole: AgentRoutingRole.ENTRYPOINT,
      executionProfile: AgentExecutionProfile.READ_ONLY,
      capabilities: ["can_route", "can_handoff", "can_query_knowledge"],
      domains: ["iam", "identity", "governance", "routing"],
      visibility: "shared" as const,
      runtimeConfig: iamCoordinatorRuntimeConfig,
    },
    {
      name: "GitHub IAM Agent",
      description: "Especialista em repositorios IAM/GCP, roles, bindings, templates, manifests, PRs e historico de mudancas.",
      prompt:
        "Atue como especialista de IAM focado em GitHub e policy-as-code para GCP. Investigue roles, bindings, grupos, manifests, templates, pipelines e pull requests relevantes. " +
        "Nao aplique mudancas automaticamente; proponha ajustes com evidencia e impacto esperado.",
      tags: ["iam", "github", "gcp", "roles", "bindings", "repo", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.READ_ONLY,
      capabilities: ["can_query_knowledge", "can_handoff"],
      domains: ["iam", "github", "gcp", "policy_as_code"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "github_iam",
          requiredIntegrations: ["github"],
        },
        requiredIntegrations: ["github"],
      },
    },
    {
      name: "IGA Agent",
      description: "Especialista em IGA para papeis, vinculos, aprovacoes, solicitacoes, excecoes e reconciliacao.",
      prompt:
        "Atue como especialista de IGA. Consulte atribuicoes, BRs, excecoes, requests, aprovacoes e reconciliacao antes de concluir. " +
        "Mudancas operacionais sao opt-in e devem ser tratadas como write_guarded, sempre com impacto e pre-condicoes explicitas.",
      tags: ["iam", "iga", "approval", "reconciliation", "provisioning", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.WRITE_GUARDED,
      capabilities: ["can_query_knowledge", "can_handoff", "can_call_write_tools"],
      domains: ["iam", "iga", "provisioning", "approvals"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "iga",
          requiredIntegrations: ["iga"],
        },
        requiredIntegrations: ["iga"],
      },
    },
    {
      name: "BigQuery IAM/Security Agent",
      description: "Especialista em consultas analiticas para IAM e seguranca usando BigQuery.",
      prompt:
        "Atue como especialista analitico de IAM/Security usando BigQuery. Correlacione eventos, historico, cobertura de roles e sinais suspeitos. " +
        "Escrita de findings e opcional, nunca default, e exige autorizacao explicita.",
      tags: ["iam", "bigquery", "security", "analytics", "events", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.WRITE_GUARDED,
      capabilities: ["can_query_knowledge", "can_handoff", "can_call_write_tools"],
      domains: ["iam", "bigquery", "analytics", "security"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "bigquery_iam",
          requiredIntegrations: ["bigquery"],
        },
        requiredIntegrations: ["bigquery"],
      },
    },
    {
      name: "Jira/Confluence IAM Agent",
      description: "Especialista em tickets, runbooks e documentacao operacional de IAM.",
      prompt:
        "Atue como especialista de IAM para Jira e Confluence. Busque tickets, filas, excecoes, mudancas e runbooks antes de orientar troubleshooting ou proposta de ajuste. " +
        "Sempre diferencie documentacao oficial, contexto historico e lacunas operacionais.",
      tags: ["iam", "jira", "confluence", "documentation", "runbook", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.READ_ONLY,
      capabilities: ["can_query_knowledge", "can_handoff"],
      domains: ["iam", "jira", "confluence", "documentation"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "jira_confluence",
          requiredIntegrations: ["jira", "confluence"],
        },
        requiredIntegrations: ["jira", "confluence"],
      },
    },
    {
      name: "IAM Knowledge Agent",
      description: "Camada de conhecimento contextual para IAM, com retrieval semantico de runbooks, glossario, excecoes e historico documental.",
      prompt:
        "Atue como IAM Knowledge Agent. Recupere contexto organizacional, processos, runbooks, glossario, excecoes, post-mortems e referencias relevantes. " +
        "Nao invente processo; cite evidencias, diferencie politica oficial de contexto historico e ajude outros agentes a operar com base documental.",
      tags: ["iam", "knowledge", "rag", "documentation", "process", "context", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.READ_ONLY,
      capabilities: ["can_query_knowledge", "can_handoff"],
      domains: ["iam", "knowledge", "rag", "documentation", "operations"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "iam_knowledge",
          requiredIntegrations: ["jira", "confluence", "slack", "google_drive"],
        },
        requiredIntegrations: ["jira", "confluence", "slack", "google_drive"],
      },
    },
    {
      name: "Entitlement Reasoning Agent",
      description: "Especialista em raciocinio sobre entitlement, origem do acesso, adequacao, herancas, excecoes e conflitos de segregacao.",
      prompt:
        "Atue como Entitlement Reasoning Agent. Explique de onde o acesso vem, se ele parece adequado, excessivo, orfao, excepcional ou potencialmente conflitante. " +
        "Use evidencias operacionais e documentais, e seja conservador quando houver pouca evidencia.",
      tags: ["iam", "entitlement", "adequacy", "sod", "governance", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.READ_ONLY,
      capabilities: ["can_query_knowledge", "can_handoff"],
      domains: ["iam", "entitlement", "governance", "access_review"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "entitlement_reasoning",
          requiredIntegrations: [],
        },
      },
    },
    {
      name: "IAM Risk Analyst",
      description: "Especialista em priorizacao de risco e deteccoes IAM a partir de sinais operacionais e analiticos.",
      prompt:
        "Atue como IAM Risk Analyst. Correlacione sinais, gere findings, classifique severidade e confianca, proponha hipoteses e proximos passos. " +
        "Nao substitua a telemetria; complemente JumpCloud e BigQuery com priorizacao e racional claro.",
      tags: ["iam", "risk", "detections", "auth", "analytics", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.ANALYST,
      routingRole: AgentRoutingRole.SPECIALIST,
      executionProfile: AgentExecutionProfile.WRITE_GUARDED,
      capabilities: ["can_query_knowledge", "can_handoff", "can_call_write_tools"],
      domains: ["iam", "risk", "detections", "analytics", "auth"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "iam_risk",
          requiredIntegrations: ["jumpcloud", "bigquery", "findings_store"],
        },
        requiredIntegrations: ["jumpcloud", "bigquery", "findings_store"],
      },
    },
    {
      name: "Change Guard / Approval Agent",
      description: "Barreira de governanca para operacoes sensiveis, com proposta auditavel, impacto e necessidade de aprovacao.",
      prompt:
        "Atue como Change Guard / Approval Agent. Classifique a seguranca da mudanca em read_only, propose_only, approval_required ou safe_to_execute. " +
        "Bloqueie escrita sensivel por padrao, exija aprovacao quando necessario e devolva um plano auditavel e conservador.",
      tags: ["iam", "change", "approval", "guardrails", "governance", "specialist"],
      type: AgentType.SPECIALIST,
      persona: AgentPersona.EXECUTOR,
      routingRole: AgentRoutingRole.TERMINAL,
      executionProfile: AgentExecutionProfile.APPROVAL_REQUIRED,
      capabilities: ["can_handoff", "can_call_write_tools"],
      domains: ["iam", "governance", "change_control", "approval"],
      visibility: "private" as const,
      runtimeConfig: {
        iamTeamProfile: {
          role: "specialist",
          domain: "change_guard",
          requiredIntegrations: [],
        },
      },
    },
  ];

  const agents = new Map<string, { id: string; userCustomized: boolean }>();
  for (const definition of agentDefinitions) {
    const existingAgent = await prisma.agent.findUnique({
      where: { name_teamId: { name: definition.name, teamId: team.id } },
    });
    const agent = existingAgent?.userCustomized
      ? existingAgent
      : await prisma.agent.upsert({
          where: { name_teamId: { name: definition.name, teamId: team.id } },
          update: {
            description: definition.description,
            prompt: definition.prompt,
            tags: definition.tags,
            type: definition.type,
            persona: definition.persona,
            routingRole: definition.routingRole,
            executionProfile: definition.executionProfile,
            capabilities: definition.capabilities,
            domains: definition.domains,
            isGlobal: false,
            visibility: definition.visibility,
            runtimeConfig: definition.runtimeConfig,
          },
          create: {
            name: definition.name,
            description: definition.description,
            prompt: definition.prompt,
            tags: definition.tags,
            type: definition.type,
            persona: definition.persona,
            routingRole: definition.routingRole,
            executionProfile: definition.executionProfile,
            capabilities: definition.capabilities,
            domains: definition.domains,
            isGlobal: false,
            visibility: definition.visibility,
            runtimeConfig: definition.runtimeConfig,
            teamId: team.id,
          },
        });
    agents.set(definition.name, { id: agent.id, userCustomized: agent.userCustomized });
    if (knowledge && !knowledge.userCustomized && !agent.userCustomized) {
      await prisma.agentKnowledge.upsert({
        where: {
          agentId_knowledgeSourceId: {
            agentId: agent.id,
            knowledgeSourceId: knowledge.id,
          },
        },
        update: {},
        create: {
          agentId: agent.id,
          knowledgeSourceId: knowledge.id,
        },
      });
    }
  }

  if (existingJumpCloudAgent) {
    agents.set("JumpCloud Directory Analyst", { id: existingJumpCloudAgent.id, userCustomized: existingJumpCloudAgent.userCustomized });
  }

  const coordinator = agents.get("IAM Orchestrator");
  if (!coordinator) return;
  for (const [agentName, agentInfo] of agents.entries()) {
    if (agentName === "IAM Orchestrator") continue;
    if (coordinator.userCustomized || agentInfo.userCustomized) continue;
    await upsertManagedHandoff({
      fromAgentId: coordinator.id,
      toAgentId: agentInfo.id,
      conditionExpr: `iam ${agentName.toLowerCase()} handoff`,
      priority: agentName === "JumpCloud Directory Analyst" ? 92 : 88,
      label: `IAM Orchestrator -> ${agentName}`,
    });
  }

  const existingIamRoutingRule = await prisma.routingRule.findFirst({
    where: { name: "IAM Team routing", ownerTeamId: team.id },
  });
  if (existingIamRoutingRule) {
    await prisma.routingRule.update({
      where: { id: existingIamRoutingRule.id },
      data: {
        ownerTeamId: team.id,
        targetAgentId: coordinator.id,
        fallbackAgentId: null,
        keywords: ["iam", "identity", "access", "role", "permission", "jumpcloud", "iga", "github", "bigquery", "jira", "confluence"],
        tags: ["iam", "identity", "governance"],
        minScore: 0.25,
      },
    });
  } else {
    await prisma.routingRule.create({
      data: {
        name: "IAM Team routing",
        ownerTeamId: team.id,
        targetAgentId: coordinator.id,
        fallbackAgentId: null,
        keywords: ["iam", "identity", "access", "role", "permission", "jumpcloud", "iga", "github", "bigquery", "jira", "confluence"],
        tags: ["iam", "identity", "governance"],
        minScore: 0.25,
      },
    });
  }

  console.log("sync-agno-catalog: IAM Team synchronized.");
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

async function linkWorkflowToAgents(workflowName: string, ownerTeamId: string | null, linkedAgentNames: string[] | null | undefined): Promise<void> {
  if (!linkedAgentNames?.length) return;
  const workflow = await prisma.workflow.findFirst({ where: { name: workflowName, ownerTeamId } });
  if (!workflow) return;
  for (const agentName of linkedAgentNames) {
    const agent = await prisma.agent.findFirst({ where: { name: agentName } });
    if (!agent) continue;
    await prisma.agentWorkflow.upsert({
      where: { agentId_workflowId: { agentId: agent.id, workflowId: workflow.id } },
      update: {},
      create: { agentId: agent.id, workflowId: workflow.id },
    });
  }
}

async function main() {
  await ensureSchema(prisma);
  await cleanupNonIamAgents();
  await ensureJumpCloudDirectoryAnalyst();
  await ensureIamTeam();

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
  let syncedWorkflows = 0;

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

  for (const workflow of catalog.workflows || []) {
    const ownerTeam = workflow.ownerTeamKey ? teamByKey.get(workflow.ownerTeamKey) : null;
    const currentWorkflow = await prisma.workflow.findFirst({
      where: { name: workflow.name, ownerTeamId: ownerTeam?.id || null },
    });
    if (currentWorkflow?.userCustomized) {
      skipped.push(`Workflow "${workflow.name}" preservado por customizacao do usuario.`);
      continue;
    }
    if (currentWorkflow) {
      await prisma.workflow.update({
        where: { id: currentWorkflow.id },
        data: {
          description: workflow.description || workflow.objective,
          objective: workflow.objective,
          preconditions: workflow.preconditions,
          integrationKeys: workflow.integrationKeys,
          steps: workflow.steps,
          successCriteria: workflow.successCriteria,
          outputFormat: workflow.outputFormat,
          failureHandling: workflow.failureHandling,
          setupPoints: workflow.setupPoints,
          enabled: workflow.enabled,
          visibility: workflow.visibility || "shared",
          managedBy: "agno",
          runtimeSource: workflow.runtimeSource || "agno",
          ownerTeamId: ownerTeam?.id || null,
          agentLinks: { deleteMany: {} },
        },
      });
      syncedWorkflows += 1;
      await linkWorkflowToAgents(workflow.name, ownerTeam?.id || null, workflow.linkedAgentNames);
      continue;
    }
    await prisma.workflow.create({
      data: {
        name: workflow.name,
        description: workflow.description || workflow.objective,
        objective: workflow.objective,
        preconditions: workflow.preconditions,
        integrationKeys: workflow.integrationKeys,
        steps: workflow.steps,
        successCriteria: workflow.successCriteria,
        outputFormat: workflow.outputFormat,
        failureHandling: workflow.failureHandling,
        setupPoints: workflow.setupPoints,
        enabled: workflow.enabled,
        visibility: workflow.visibility || "shared",
        managedBy: "agno",
        runtimeSource: workflow.runtimeSource || "agno",
        ownerTeamId: ownerTeam?.id || null,
      },
    });
    syncedWorkflows += 1;
    await linkWorkflowToAgents(workflow.name, ownerTeam?.id || null, workflow.linkedAgentNames);
  }

  const legacyWorkflowSkills = await prisma.skill.findMany({
    where: { managedBy: "agno", category: "workflow" },
    include: { agentLinks: true },
  });
  for (const legacy of legacyWorkflowSkills) {
    const existingWorkflow = await prisma.workflow.findFirst({
      where: { name: legacy.name, ownerTeamId: legacy.ownerTeamId || null },
    });
    if (!existingWorkflow) {
      await prisma.workflow.create({
        data: {
          name: legacy.name,
          description: legacy.description,
          objective: legacy.description,
          preconditions: [],
          integrationKeys: [],
          steps: [legacy.prompt],
          successCriteria: [],
          outputFormat: "structured summary",
          failureHandling: [],
          setupPoints: [],
          enabled: legacy.enabled,
          visibility: legacy.visibility,
          managedBy: legacy.managedBy,
          runtimeSource: legacy.runtimeSource,
          ownerTeamId: legacy.ownerTeamId,
          userCustomized: legacy.userCustomized,
          customizationNote: legacy.customizationNote,
          customizationUpdatedAt: legacy.customizationUpdatedAt,
          agentLinks: legacy.agentLinks.length ? { create: legacy.agentLinks.map((link) => ({ agentId: link.agentId })) } : undefined,
        },
      });
      syncedWorkflows += 1;
    }
    await prisma.agentSkill.deleteMany({ where: { skillId: legacy.id } });
    await prisma.skill.delete({ where: { id: legacy.id } });
  }

  console.log(JSON.stringify({
    ok: true,
    tools: syncedTools,
    skills: syncedSkills,
    workflows: syncedWorkflows,
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
