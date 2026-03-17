import "dotenv/config";
import bcrypt from "bcrypt";
import {
  AgentType,
  DataClassification,
  PrismaClient,
  RiskLevel,
  Role,
  ToolMode,
  ToolPolicy,
  ToolType,
} from "@prisma/client";
import path from "node:path";
import { ensureSchema } from "../src/init-db.js";

const prisma = new PrismaClient();

const TEAM_SEEDS = [
  { key: "HRM", name: "HRM", description: "Human Risk Management" },
  { key: "IAM_IGA", name: "IAM/IGA", description: "Identity and Access Governance" },
  { key: "CLOUDSEC", name: "CloudSec", description: "Cloud Security" },
  { key: "CORPSEC", name: "CorpSec", description: "Corporate Security" },
  { key: "APPSEC", name: "AppSec", description: "Application Security" },
  { key: "OFFSEC", name: "OffSec", description: "Offensive Security" },
  { key: "DNR", name: "Detection&Response", description: "SOC and Incident Response" },
  { key: "VULN_MGMT", name: "Vuln Mgmt", description: "Vulnerability Management" },
];

async function main() {
  await ensureSchema(prisma);
  const repoRoot = path.resolve(process.cwd(), "..");

  const existingTeams = await prisma.team.count();
  if (existingTeams > 0) {
    console.log("Seed skipped: existing data detected, preserving current database state.");
    return;
  }

  await prisma.groupMembership.deleteMany();
  await prisma.group.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.handoff.deleteMany();
  await prisma.agentKnowledge.deleteMany();
  await prisma.agentTool.deleteMany();
  await prisma.routingRule.deleteMany();
  await prisma.knowledgeSource.deleteMany();
  await prisma.tool.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.user.deleteMany();
  await prisma.team.deleteMany();

  const teams = new Map<string, string>();
  for (const seed of TEAM_SEEDS) {
    const created = await prisma.team.create({ data: seed });
    teams.set(seed.key, created.id);
  }

  const supervisor = await prisma.agent.create({
    data: {
      name: "Global Supervisor",
      description: "Ponto unico de contato com usuario, acolhe, confirma entendimento e direciona para especialistas.",
      prompt:
        "Seja o ponto unico de contato com usuario final. Fale de forma gentil e objetiva (nao excessivamente formal). " +
        "Quando houver baixa confianca ou contexto incompleto, faca perguntas de esclarecimento e confirme entendimento antes de direcionar. " +
        "Ao encaminhar, explique motivo e mencione o time responsavel na conversa (ex.: @IAM/IGA). " +
        "Nao afirmar execucao de acoes de escrita sem confirmacao.",
      tags: ["router", "supervisor", "global"],
      type: AgentType.SUPERVISOR,
      isGlobal: true,
      visibility: "shared",
      teamId: null,
    },
  });

  const ticketAgent = await prisma.agent.create({
    data: {
      name: "Global Ticket Agent",
      description: "Responsavel por orientar e preparar abertura de chamado quando dados obrigatorios estiverem completos.",
      prompt:
        "Siga orientacao de documentacao para abertura de chamado. Antes de abrir ticket, valide campos obrigatorios e policy checks. " +
        "Se faltarem informacoes, liste claramente o que falta e nao conclua abertura.",
      tags: ["ticket", "write", "global"],
      type: AgentType.TICKET,
      isGlobal: true,
      visibility: "shared",
      teamId: null,
    },
  });

  const specialists: Array<{ id: string; teamId: string }> = [];
  for (const seed of TEAM_SEEDS) {
    const teamId = teams.get(seed.key)!;
    const specialist = await prisma.agent.create({
      data: {
        name: `${seed.name} Specialist`,
        description: `Especialista de dominio ${seed.name} com foco em orientar usuario e levantar dados faltantes para resolucao.`,
        prompt:
          `Atue como especialista ${seed.name}. Ajude usuario com explicacao clara e passos praticos. ` +
          `Se faltarem dados, faca perguntas objetivas para o supervisor repassar ao usuario. ` +
          `Quando necessario, encaminhe para membro/time responsavel mencionando o time na conversa (ex.: @${seed.name}). ` +
          `Se caso for de abertura de chamado documentada, siga a orientacao e solicite informacoes faltantes antes de prosseguir.`,
        tags: [seed.key.toLowerCase(), "specialist"],
        type: AgentType.SPECIALIST,
        isGlobal: false,
        visibility: "private",
        teamId,
      },
    });
    specialists.push({ id: specialist.id, teamId });

    await prisma.handoff.create({
      data: {
        fromAgentId: supervisor.id,
        toAgentId: specialist.id,
        conditionExpr: `${seed.name.toLowerCase()} keywords`,
        priority: 60,
      },
    });

    await prisma.handoff.create({
      data: {
        fromAgentId: specialist.id,
        toAgentId: ticketAgent.id,
        conditionExpr: "ticket required",
        priority: 80,
      },
    });

    await prisma.routingRule.create({
      data: {
        name: `${seed.name} routing`,
        ownerTeamId: teamId,
        targetAgentId: specialist.id,
        fallbackAgentId: ticketAgent.id,
        keywords: [seed.name.toLowerCase(), seed.key.toLowerCase()],
        tags: [seed.key.toLowerCase()],
        minScore: 0.2,
      },
    });

    await prisma.knowledgeSource.create({
      data: {
        name: `${seed.name} Playbook`,
        url: `https://confluence.local/${seed.key.toLowerCase()}/playbook`,
        tags: [seed.key.toLowerCase(), "runbook"],
        visibility: "private",
        ownerTeamId: teamId,
      },
    });
  }

  const dnrTeamId = teams.get("DNR")!;
  const falconReportsPath = path.join(repoRoot, "docs", "falcon-rag", "vulnerability-reports");
  const falconReportsUrl = `file:///${falconReportsPath.replace(/\\/g, "/").replace(/ /g, "%20")}`;
  const falconEdrAgent = await prisma.agent.create({
    data: {
      name: "Falcon EDR Analyst",
      description: "Analista senior de EDR focado em investigacao, triagem, hunting e correlacao com relatorios de vulnerabilidade no CrowdStrike Falcon.",
      prompt:
        "Atue como analista senior de EDR focado em CrowdStrike Falcon. Trabalhe apenas em modo leitura para investigacao, triagem, hunting e recomendacao. " +
        "Priorize incidentes ativos, deteccoes criticas, persistencia, credential access, lateral movement, beaconing e sinais de ransomware. " +
        "Use a base local de relatorios de vulnerabilidades para contextualizar exposicao, SLA e prioridade quando houver CVEs, advisories ou backlog de remediacao. " +
        "Separe fatos observados de inferencias, hipoteses e recomendacoes. Nunca afirme acao executada se nao houve execucao real.",
      tags: ["dnr", "falcon", "edr", "crowdstrike", "hunting", "specialist", "vuln-context", "cve"],
      type: AgentType.SPECIALIST,
      isGlobal: false,
      visibility: "private",
      teamId: dnrTeamId,
      knowledgeMode: "hybrid",
      knowledgeMaxResults: 6,
      knowledgeAddReferences: true,
      knowledgeContextFormat: "yaml",
    },
  });
  specialists.push({ id: falconEdrAgent.id, teamId: dnrTeamId });

  await prisma.handoff.create({
    data: {
      fromAgentId: supervisor.id,
      toAgentId: falconEdrAgent.id,
      conditionExpr: "falcon edr hunting crowdstrike detections",
      priority: 85,
    },
  });

  await prisma.handoff.create({
    data: {
      fromAgentId: falconEdrAgent.id,
      toAgentId: ticketAgent.id,
      conditionExpr: "ticket required",
      priority: 80,
    },
  });

  const searchKnowledge = await prisma.tool.create({
    data: {
      name: "SearchKnowledge",
      type: ToolType.confluence,
      mode: ToolMode.mock,
      policy: ToolPolicy.read,
      riskLevel: RiskLevel.low,
      dataClassificationIn: DataClassification.internal,
      dataClassificationOut: DataClassification.internal,
      inputSchema: { query: "string", tags: ["string"] },
      outputSchema: { snippets: [{ title: "string", url: "string" }] },
      rateLimitPerMinute: 120,
      visibility: "shared",
      teamId: null,
    },
  });

  const lookupRunbook = await prisma.tool.create({
    data: {
      name: "LookupRunbook",
      type: ToolType.internal,
      mode: ToolMode.mock,
      policy: ToolPolicy.read,
      riskLevel: RiskLevel.low,
      dataClassificationIn: DataClassification.internal,
      dataClassificationOut: DataClassification.internal,
      inputSchema: { control: "string" },
      outputSchema: { steps: ["string"] },
      rateLimitPerMinute: 120,
      visibility: "shared",
      teamId: null,
    },
  });

  const createTicket = await prisma.tool.create({
    data: {
      name: "CreateTicket",
      type: ToolType.jira,
      mode: ToolMode.mock,
      policy: ToolPolicy.write,
      riskLevel: RiskLevel.high,
      dataClassificationIn: DataClassification.confidential,
      dataClassificationOut: DataClassification.internal,
      inputSchema: { title: "string", description: "string", justification: "string" },
      outputSchema: { ticketId: "string", status: "created" },
      rateLimitPerMinute: 20,
      visibility: "shared",
      teamId: null,
    },
  });

  await prisma.agentTool.create({
    data: { agentId: supervisor.id, toolId: searchKnowledge.id, canRead: true, canWrite: false },
  });

  for (const specialist of specialists) {
    await prisma.agentTool.create({
      data: { agentId: specialist.id, toolId: searchKnowledge.id, canRead: true, canWrite: false },
    });
    await prisma.agentTool.create({
      data: { agentId: specialist.id, toolId: lookupRunbook.id, canRead: true, canWrite: false },
    });

    const ks = await prisma.knowledgeSource.findFirst({ where: { ownerTeamId: specialist.teamId } });
    if (ks) {
      await prisma.agentKnowledge.create({ data: { agentId: specialist.id, knowledgeSourceId: ks.id } });
    }
  }

  const falconVulnKnowledge = await prisma.knowledgeSource.create({
    data: {
      name: "Falcon Vulnerability Reports RAG",
      url: falconReportsUrl,
      tags: ["falcon", "edr", "vulnerability", "cve", "remediation", "report", "rag"],
      sourceType: "folder",
      sourceConfig: {
        include: ["**/*.md"],
        description: "Simulated local RAG corpus for Falcon vulnerability report context.",
      },
      chunkSize: 1200,
      chunkOverlap: 150,
      chunkStrategy: "markdown",
      embeddingProvider: "simulated-local",
      embeddingModel: "mock-text-embedding-001",
      vectorStoreProvider: "local-simulated",
      vectorStoreIndex: "falcon-vuln-reports",
      retrievalMode: "hybrid",
      searchType: "hybrid",
      maxResults: 8,
      rerankerProvider: "simulated-local",
      rerankerModel: "mock-reranker-001",
      metadataFilter: { domain: "falcon", corpus: "vulnerability-reports" },
      contextFormat: "yaml",
      addContextInstructions: true,
      addReferences: true,
      visibility: "private",
      ownerTeamId: dnrTeamId,
    },
  });

  await prisma.agentKnowledge.create({
    data: { agentId: falconEdrAgent.id, knowledgeSourceId: falconVulnKnowledge.id },
  });

  await prisma.agentTool.create({ data: { agentId: ticketAgent.id, toolId: createTicket.id, canRead: true, canWrite: true } });

  const adminPassword = await bcrypt.hash("Admin123!", 10);
  const maintainerPassword = await bcrypt.hash("Maintainer123!", 10);
  const operatorPassword = await bcrypt.hash("Operator123!", 10);

  await prisma.user.create({ data: { email: "admin@local", passwordHash: adminPassword, role: Role.ADMIN, teamId: null } });
  await prisma.user.create({ data: { email: "iam.maintainer@local", passwordHash: maintainerPassword, role: Role.TEAM_MAINTAINER, teamId: teams.get("IAM_IGA") } });
  await prisma.user.create({ data: { email: "operator@local", passwordHash: operatorPassword, role: Role.OPERATOR, teamId: null } });

  console.log("Seed complete");
  console.log("admin@local / Admin123!");
  console.log("iam.maintainer@local / Maintainer123!");
  console.log("operator@local / Operator123!");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
