import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const importFile = process.env.LEGACY_SQLITE_EXPORT_PATH || path.resolve("runtime", "sqlite-export.json");

type ExportBundle = {
  teams?: Record<string, unknown>[];
  users?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  groupMemberships?: Record<string, unknown>[];
  agents?: Record<string, unknown>[];
  tools?: Record<string, unknown>[];
  skills?: Record<string, unknown>[];
  knowledgeSources?: Record<string, unknown>[];
  agentTools?: Record<string, unknown>[];
  agentSkills?: Record<string, unknown>[];
  agentKnowledge?: Record<string, unknown>[];
  handoffs?: Record<string, unknown>[];
  routingRules?: Record<string, unknown>[];
  auditLogs?: Record<string, unknown>[];
};

async function createMany<T extends Record<string, unknown>>(
  rows: T[] | undefined,
  writer: (row: T) => Promise<unknown>,
): Promise<number> {
  let created = 0;
  for (const row of rows || []) {
    await writer(row);
    created += 1;
  }
  return created;
}

async function main() {
  if (!fs.existsSync(importFile)) {
    console.log(`Legacy SQLite export not found at ${importFile}, skipping import.`);
    return;
  }

  const currentTeams = await prisma.team.count();
  if (currentTeams > 0) {
    console.log("PostgreSQL already contains data, skipping legacy import.");
    return;
  }

  const raw = fs.readFileSync(importFile, "utf8");
  const payload = JSON.parse(raw) as ExportBundle;

  await prisma.$transaction(async (tx) => {
    await createMany(payload.teams, (row) => tx.team.create({ data: row as never }));
    await createMany(payload.users, (row) => tx.user.create({ data: row as never }));
    await createMany(payload.groups, (row) => tx.group.create({ data: row as never }));
    await createMany(payload.groupMemberships, (row) => tx.groupMembership.create({ data: row as never }));
    await createMany(payload.agents, (row) => tx.agent.create({ data: row as never }));
    await createMany(payload.tools, (row) => tx.tool.create({ data: row as never }));
    await createMany(payload.skills, (row) => tx.skill.create({ data: row as never }));
    await createMany(payload.knowledgeSources, (row) => tx.knowledgeSource.create({ data: row as never }));
    await createMany(payload.agentTools, (row) => tx.agentTool.create({ data: row as never }));
    await createMany(payload.agentSkills, (row) => tx.agentSkill.create({ data: row as never }));
    await createMany(payload.agentKnowledge, (row) => tx.agentKnowledge.create({ data: row as never }));
    await createMany(payload.handoffs, (row) => tx.handoff.create({ data: row as never }));
    await createMany(payload.routingRules, (row) => tx.routingRule.create({ data: row as never }));
    await createMany(payload.auditLogs, (row) => tx.auditLog.create({ data: row as never }));
  });

  console.log(`Imported legacy SQLite export from ${importFile}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
