import crypto from "node:crypto";
import type { Role } from "@prisma/client";
import { db } from "./db.js";

type AuditInput = {
  actorId?: string;
  actorRole: Role | "ANON";
  actorTeam?: string | null;
  action: string;
  entityType: string;
  entityId?: string;
  beforeJson?: unknown;
  afterJson?: unknown;
  correlationId: string;
  denied?: boolean;
  reason?: string;
};

export async function computeConfigVersionHash(): Promise<string> {
  const data = {
    teams: await db.team.findMany({ include: { agents: true, tools: true, knowledgeSources: true, routingRules: true } }),
    agents: await db.agent.findMany({ include: { toolLinks: true, knowledgeLinks: true, outgoingHandoffs: true } }),
    tools: await db.tool.findMany(),
  };
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const version = await computeConfigVersionHash();
  await db.auditLog.create({
    data: {
      actorId: input.actorId,
      actorRole: input.actorRole,
      actorTeam: input.actorTeam || null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.beforeJson ? JSON.stringify(input.beforeJson) : null,
      afterJson: input.afterJson ? JSON.stringify(input.afterJson) : null,
      correlationId: input.correlationId,
      configVersionHash: version,
      denied: input.denied || false,
      reason: input.reason,
    },
  });
}
