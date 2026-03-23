import "dotenv/config";
import bcrypt from "bcrypt";
import { PrismaClient, Role } from "@prisma/client";
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
  await prisma.agentWorkflow.deleteMany();
  await prisma.agentSkill.deleteMany();
  await prisma.agentTool.deleteMany();
  await prisma.routingRule.deleteMany();
  await prisma.workflow.deleteMany();
  await prisma.skill.deleteMany();
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

  await prisma.knowledgeSource.create({
    data: {
      name: "IAM/IGA Playbook",
      url: "https://confluence.local/iam_iga/playbook",
      tags: ["iam", "iga", "runbook"],
      visibility: "private",
      ownerTeamId: teams.get("IAM_IGA")!,
    },
  });

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
