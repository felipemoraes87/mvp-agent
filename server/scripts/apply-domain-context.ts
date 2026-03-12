import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DOMAIN_CONTEXT: Record<string, { keywords: string[]; tags: string[]; docFile: string; summary: string }> = {
  HRM: {
    keywords: ["hrm", "human risk", "phishing", "awareness", "insider", "training", "social engineering"],
    tags: ["hrm", "phishing", "awareness", "insider-risk"],
    docFile: "hrm-playbook.md",
    summary: "Human risk operations, phishing awareness, insider risk triage.",
  },
  IAM_IGA: {
    keywords: ["iam", "iga", "access", "entitlement", "sod", "recertification", "revoke", "provisioning"],
    tags: ["iam", "iga", "identity", "access-governance"],
    docFile: "iam-iga-playbook.md",
    summary: "Identity lifecycle, access governance, SoD and recertification.",
  },
  CLOUDSEC: {
    keywords: ["cloud", "aws", "azure", "gcp", "bucket", "security group", "cspm", "cloudtrail"],
    tags: ["cloudsec", "cspm", "misconfiguration", "cloud-iam"],
    docFile: "cloudsec-playbook.md",
    summary: "Cloud posture, misconfiguration triage and remediation.",
  },
  CORPSEC: {
    keywords: ["corpsec", "corporate", "policy violation", "vendor risk", "compliance", "office security"],
    tags: ["corpsec", "policy", "vendor-risk", "compliance"],
    docFile: "corpsec-playbook.md",
    summary: "Corporate policy and enterprise security governance.",
  },
  APPSEC: {
    keywords: ["appsec", "sast", "sca", "owasp", "xss", "sqli", "dependency", "api security", "cve"],
    tags: ["appsec", "secure-sdlc", "sast", "sca"],
    docFile: "appsec-playbook.md",
    summary: "Application security, secure SDLC and vulnerability remediation.",
  },
  OFFSEC: {
    keywords: ["offsec", "pentest", "exploit", "red team", "attack path", "lateral movement", "recon"],
    tags: ["offsec", "pentest", "adversarial", "red-team"],
    docFile: "offsec-playbook.md",
    summary: "Offensive validation and exploit-driven risk assessment.",
  },
  DNR: {
    keywords: ["detection", "response", "soc", "siem", "incident", "ioc", "malware", "containment", "triage"],
    tags: ["dnr", "soc", "incident-response", "detection"],
    docFile: "dnr-playbook.md",
    summary: "SOC triage, incident response and containment.",
  },
  VULN_MGMT: {
    keywords: ["vulnerability", "vuln", "cve", "patch", "remediation", "backlog", "sla", "risk acceptance"],
    tags: ["vuln-mgmt", "cve", "patching", "remediation"],
    docFile: "vuln-mgmt-playbook.md",
    summary: "Vulnerability prioritization, patching and SLA tracking.",
  },
};

async function main() {
  const repoRoot = path.resolve(process.cwd(), "..");

  const teams = await prisma.team.findMany();
  const specialists = await prisma.agent.findMany({ where: { type: "SPECIALIST" } });
  const rules = await prisma.routingRule.findMany();
  const [supervisor, ticketAgent] = await Promise.all([
    prisma.agent.findFirst({ where: { type: "SUPERVISOR", isGlobal: true } }),
    prisma.agent.findFirst({ where: { type: "TICKET", isGlobal: true } }),
  ]);

  if (supervisor) {
    await prisma.agent.update({
      where: { id: supervisor.id },
      data: {
        description: "Ponto unico de contato com usuario, acolhe, confirma entendimento e direciona para especialistas.",
        prompt:
          "Seja o ponto unico de contato com usuario final. Fale de forma gentil e objetiva (nao excessivamente formal). " +
          "Quando houver baixa confianca ou contexto incompleto, faca perguntas de esclarecimento e confirme entendimento antes de direcionar. " +
          "Ao encaminhar, explique motivo e mencione o time responsavel na conversa (ex.: @IAM/IGA). " +
          "Nao afirmar execucao de acoes de escrita sem confirmacao.",
      },
    });
  }

  if (ticketAgent) {
    await prisma.agent.update({
      where: { id: ticketAgent.id },
      data: {
        description: "Responsavel por orientar e preparar abertura de chamado quando dados obrigatorios estiverem completos.",
        prompt:
          "Siga orientacao de documentacao para abertura de chamado. Antes de abrir ticket, valide campos obrigatorios e policy checks. " +
          "Se faltarem informacoes, liste claramente o que falta e nao conclua abertura.",
      },
    });
  }

  for (const team of teams) {
    const ctx = DOMAIN_CONTEXT[team.key];
    if (!ctx) continue;

    const specialist = specialists.find((a) => a.teamId === team.id);
    const rule = rules.find((r) => r.ownerTeamId === team.id);
    if (!specialist || !rule) continue;

    const docPath = path.join(repoRoot, "docs", "team-playbooks", ctx.docFile);
    const fileUrl = `file:///${docPath.replace(/\\/g, "/").replace(/ /g, "%20")}`;

    const currentKnowledge = await prisma.knowledgeSource.findFirst({ where: { ownerTeamId: team.id } });
    const knowledge = currentKnowledge
      ? await prisma.knowledgeSource.update({
          where: { id: currentKnowledge.id },
          data: {
            name: `${team.name} Playbook`,
            url: fileUrl,
            tags: [...new Set([...ctx.tags, "runbook", "playbook"])],
          },
        })
      : await prisma.knowledgeSource.create({
          data: {
            name: `${team.name} Playbook`,
            url: fileUrl,
            tags: [...new Set([...ctx.tags, "runbook", "playbook"])],
            ownerTeamId: team.id,
          },
        });

    await prisma.agent.update({
      where: { id: specialist.id },
      data: {
        tags: [...new Set([...(Array.isArray(specialist.tags) ? (specialist.tags as string[]) : []), ...ctx.tags, team.key.toLowerCase(), "specialist"])],
        prompt:
          `Atue como especialista ${team.name}. Contexto principal: ${ctx.summary}. ` +
          "Ajude usuario com linguagem simples e pratica. " +
          "Se faltarem dados, faca perguntas objetivas para o supervisor repassar ao usuario. " +
          "Quando necessario, encaminhe para o time/membro correto com mencao de time na conversa (ex.: @Time). " +
          "Se caso for de abertura de chamado documentada, siga o playbook e solicite informacoes obrigatorias antes de prosseguir.",
        description: `Especialista de dominio ${team.name}. ${ctx.summary}`,
      },
    });

    await prisma.routingRule.update({
      where: { id: rule.id },
      data: {
        keywords: [...new Set(ctx.keywords)],
        tags: [...new Set(ctx.tags)],
      },
    });

    await prisma.agentKnowledge.upsert({
      where: { agentId_knowledgeSourceId: { agentId: specialist.id, knowledgeSourceId: knowledge.id } },
      update: {},
      create: { agentId: specialist.id, knowledgeSourceId: knowledge.id },
    });
  }

  console.log("Domain context applied to specialists, routing rules, and knowledge sources.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
