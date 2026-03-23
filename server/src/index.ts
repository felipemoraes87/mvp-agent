import "dotenv/config";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import session from "express-session";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { nanoid } from "nanoid";
import pinoHttp from "pino-http";
import YAML from "yaml";
import { Prisma, ToolPolicy, type Role } from "@prisma/client";
import { ZodError } from "zod";
import { config, validateConfigForRuntime } from "./config.js";
import { db } from "./db.js";
import { logger } from "./logger.js";
import type { AuthedRequest, SessionUser } from "./types.js";
import { evaluatePolicy } from "./policy.js";
import { writeAudit, computeConfigVersionHash } from "./audit.js";
import { ensureSchema } from "./init-db.js";
import {
  agnoChatSchema,
  accessGroupMembershipSchema,
  accessGroupSchema,
  accessPasswordResetSchema,
  accessUserCreateSchema,
  accessUserUpdateSchema,
  agentSchema,
  assignKnowledgeSchema,
  skillSchema,
  workflowSchema,
  assignToolSchema,
  configImportSchema,
  customizationProtectionSchema,
  handoffSchema,
  knowledgeSchema,
  loginSchema,
  routingRuleSchema,
  simulatorSchema,
  toolSchema,
} from "./validation.js";
import { runSimulation } from "./simulator.js";
import { sha256, validateSafeSimulationInput } from "./security.js";
import { callAgnoCatalog, callAgnoChat, callAgnoModels, callAgnoSimulate, callAgnoWorkflowSetupCheck } from "./agno.js";
import {
  canAgentUseWriteTools,
  classifyAgentFromLegacyType,
} from "./agent-classification.js";

type ZodSchemaLike<T> = { parse: (data: unknown) => T };

const app = express();
const workflowDb = db as typeof db & { workflow: any; agentWorkflow: any };
const pinoHttpLogger = pinoHttp as unknown as (opts: unknown) => express.RequestHandler;
const allowedOrigins = new Set([config.appOrigin, ...config.appOrigins]);

app.use(
  pinoHttpLogger({
    logger,
    genReqId: (req: express.Request, res: express.Response) => {
      const existing = req.headers["x-correlation-id"];
      const id = (Array.isArray(existing) ? existing[0] : existing) || nanoid();
      res.setHeader("x-correlation-id", id);
      return id;
    },
  }),
);

app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS origin denied: ${origin}`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  session({
    name: "mvp.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);
app.use(rateLimit({ windowMs: 60_000, limit: 200 }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const sensitiveLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
});

function getReq(req: express.Request): AuthedRequest {
  const sessionUser = "session" in req && req.session ? req.session.user : undefined;
  return Object.assign(req, {
    user: sessionUser,
    correlationId: String(req.id || nanoid()),
  });
}

function parse<T>(schema: ZodSchemaLike<T>, data: unknown): T {
  return schema.parse(data);
}

function safeJsonParse(raw: string | null): unknown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function fallbackAgentReply(
  type: string,
  agentName: string,
  text: string,
  overrides?: { persona?: string | null; routingRole?: string | null; executionProfile?: string | null },
): string {
  const classification = {
    ...classifyAgentFromLegacyType(type),
    ...(overrides || {}),
  };
  const lower = text.toLowerCase();
  const urgent = ["urgente", "critical", "incidente", "outage"].some((x) => lower.includes(x));
  const ticket = ["ticket", "chamado", "jira", "abrir"].some((x) => lower.includes(x));

  if (classification.persona === "SUPERVISOR" || classification.routingRole === "ENTRYPOINT") {
    return `Entendi o contexto inicial e vou te ajudar com isso. ${urgent ? "Percebi sinais de prioridade alta." : "Parece um caso de prioridade normal."} Antes de direcionar para o especialista, quero confirmar: meu entendimento do problema esta correto?`;
  }
  if (classification.routingRole === "TERMINAL" || classification.executionProfile !== "READ_ONLY") {
    return ticket
      ? "Posso preparar o chamado seguindo a documentacao, mas preciso confirmar se temos todos os dados obrigatorios (justificativa, impacto e evidencias)."
      : "Posso apoiar abertura de chamado quando o caso for documentado. Se quiser, te passo os dados obrigatorios que ainda faltam.";
  }
  return `${agentName}: posso te orientar tecnicamente com passos praticos. Se faltar contexto, vou te fazer perguntas objetivas para confirmar o entendimento antes de recomendar proximo passo.${ticket ? " Se o caso exigir, direciono para @Ticket Agent com o contexto consolidado." : ""}`;
}

function fallbackReasoningSummary(
  type: string,
  text: string,
  overrides?: { persona?: string | null; routingRole?: string | null; executionProfile?: string | null },
): string[] {
  const classification = {
    ...classifyAgentFromLegacyType(type),
    ...(overrides || {}),
  };
  const lower = text.toLowerCase();
  const signals = ["acesso", "revoke", "ticket", "incidente", "cloud", "iam", "phishing"].filter((x) => lower.includes(x));
  const signalLabel = signals.length ? signals.join(", ") : "sinais gerais do texto";

  if (classification.persona === "SUPERVISOR" || classification.routingRole === "ENTRYPOINT") {
    return [
      "Classificacao inicial da demanda por risco e dominio.",
      `Sinais usados para decisao: ${signalLabel}.`,
      "Encaminhamento para especialista mais aderente.",
    ];
  }
  if (classification.routingRole === "TERMINAL" || classification.executionProfile !== "READ_ONLY") {
    return [
      "Avaliacao de pre-condicoes para acao de escrita.",
      `Elementos considerados: ${signalLabel}.`,
      "Preparacao de ticket com justificativa e impacto.",
    ];
  }
  return [
    "Analise tecnica do contexto informado.",
    `Pontos centrais considerados: ${signalLabel}.`,
    "Definicao de recomendacoes e eventual escalonamento.",
  ];
}

function normalizeAgentPayload(input: ReturnType<typeof agentSchema.parse>) {
  const fallback = classifyAgentFromLegacyType(input.type);
  return {
    ...input,
    teamId: input.teamId || null,
    tags: input.tags,
    visibility: input.visibility,
    persona: input.persona || fallback.persona,
    routingRole: input.routingRole || fallback.routingRole,
    executionProfile: input.executionProfile || fallback.executionProfile,
    capabilities: input.capabilities.length ? input.capabilities : fallback.capabilities,
    domains: input.domains.length ? input.domains : input.tags,
  };
}

function isRuntimeManaged(managedBy?: string | null): boolean {
  return managedBy === "agno";
}

function isUserCustomized(entity: { userCustomized?: boolean | null } | null | undefined): boolean {
  return Boolean(entity?.userCustomized);
}

function formatCustomizationWarning(entityType: string, entityName: string, note?: string | null): string {
  return `${entityType} "${entityName}" foi preservado porque esta marcado como customizacao do usuario${note ? ` (${note})` : ""}.`;
}

function serializeWorkflow(
  item: {
    agentLinks?: Array<{ agentId: string }>;
    [key: string]: unknown;
  },
) {
  return {
    ...item,
    participantAgentIds: (item.agentLinks || []).map((link) => link.agentId),
  };
}

function ensureCsrf(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  if (req.path.startsWith("/api/auth/login")) {
    next();
    return;
  }
  const token = req.headers["x-csrf-token"];
  if (!req.session.csrfToken || token !== req.session.csrfToken) {
    res.status(403).json({ error: "Invalid CSRF token" });
    return;
  }
  next();
}

function ensureAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

function ensureAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!req.session.user || req.session.user.role !== "ADMIN") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  next();
}

function canMutateTeamResource(user: SessionUser, ownerTeamId?: string | null, isGlobal?: boolean): boolean {
  if (user.role === "ADMIN") return true;
  if (user.role === "OPERATOR") return false;
  if (user.role === "TEAM_MAINTAINER") {
    if (isGlobal) return false;
    return !!ownerTeamId && user.teamId === ownerTeamId;
  }
  return false;
}

function canReadTeamResource(user: SessionUser, ownerTeamId?: string | null, visibility?: string | null, isGlobal?: boolean): boolean {
  if (user.role === "ADMIN" || user.role === "OPERATOR") return true;
  if (user.role === "TEAM_MAINTAINER") {
    if (isGlobal || visibility === "shared") return true;
    return !!ownerTeamId && user.teamId === ownerTeamId;
  }
  return false;
}

function signPayload(raw: string): string {
  return crypto.createHmac("sha256", config.configHmacSecret).update(raw).digest("hex");
}

async function auditDenied(req: AuthedRequest, action: string, reason: string, entityType = "policy"): Promise<void> {
  await writeAudit({
    actorId: req.user?.id,
    actorRole: (req.user?.role || "ANON") as Role | "ANON",
    actorTeam: req.user?.teamId,
    action,
    entityType,
    correlationId: req.correlationId,
    denied: true,
    reason,
  });
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "team-agent-mvp-server" });
});

app.get("/api/auth/csrf", (req, res) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = nanoid(24);
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const body = parse(loginSchema, req.body);
  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  req.session.user = {
    id: user.id,
    email: user.email,
    role: user.role,
    teamId: user.teamId,
  };
  req.session.csrfToken = nanoid(24);
  res.json({ user: req.session.user, csrfToken: req.session.csrfToken });
});

app.post("/api/auth/logout", ensureCsrf, (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({ user: req.session.user });
});

app.use(ensureCsrf);
app.use(ensureAuth);
app.use(sensitiveLimiter);

app.get("/api/dashboard", async (req, res) => { // NOSONAR
  const user = getReq(req);
  const teamWhere: Prisma.TeamWhereInput = user.user?.role === "TEAM_MAINTAINER" ? { id: user.user.teamId || "" } : {};
  const [teams, visibleAgents, visibleTools, logs] = await Promise.all([
    db.team.findMany({ where: teamWhere, orderBy: { name: "asc" } }),
    db.agent.findMany({
      where: user.user?.role === "TEAM_MAINTAINER" ? { OR: [{ teamId: user.user.teamId || "" }, { visibility: "shared" }, { isGlobal: true }] } : {},
      select: { id: true, name: true, type: true, teamId: true, isGlobal: true, visibility: true },
    }),
    db.tool.findMany({
      where: user.user?.role === "TEAM_MAINTAINER" ? { OR: [{ teamId: user.user.teamId || "" }, { visibility: "shared" }, { teamId: null }] } : {},
      include: { _count: { select: { agentLinks: true } } },
      orderBy: { name: "asc" },
    }),
    db.auditLog.findMany({
      where: user.user?.role === "TEAM_MAINTAINER" ? { actorTeam: user.user.teamId || "" } : {},
      orderBy: { createdAt: "desc" },
      take: 3000,
    }),
  ]);

  const cards = await Promise.all(
    teams.map(async (team) => {
      const [agents, tools, routes] = await Promise.all([
        db.agent.count({ where: { teamId: team.id } }),
        db.tool.count({ where: { teamId: team.id } }),
        db.routingRule.count({ where: { ownerTeamId: team.id } }),
      ]);
      return { teamId: team.id, teamKey: team.key, teamName: team.name, agents, tools, routes };
    }),
  );

  const teamMap = new Map(teams.map((team) => [team.id, team.key]));
  const agentMap = new Map(visibleAgents.map((agent) => [agent.id, agent]));
  const toolMap = new Map(visibleTools.map((tool) => [tool.id, tool]));

  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const dailyMap = new Map(days.map((d) => [d, { date: d, simulations: 0, deniedEvents: 0 }]));

  const agentUsageMap = new Map<string, { runs: number; confidenceSum: number }>();
  const toolAssignmentMap = new Map<string, { assignments: number; writeAssignments: number }>();
  const llmUsageMap = new Map<string, { simulations: number; chats: number }>();

  let totalSimulations = 0;
  let simulationsLast24h = 0;
  let deniedEventsLast24h = 0;
  let auditEventsLast24h = 0;
  let writeToolAssignments = 0;

  for (const log of logs) {
    const logDate = log.createdAt.toISOString().slice(0, 10);
    if (log.createdAt >= cutoff24h) auditEventsLast24h += 1;
    if (log.denied && log.createdAt >= cutoff24h) {
      deniedEventsLast24h += 1;
      const day = dailyMap.get(logDate);
      if (day) day.deniedEvents += 1;
    }

    if (log.action === "simulate:run") {
      const parsed = safeJsonParse(log.afterJson) as { result?: { chosenAgent?: { id?: string }; confidence?: number }; usedAgno?: boolean; modelId?: string | null; modelProvider?: string | null } | null;
      const chosenAgentId = parsed?.result?.chosenAgent?.id;
      if (!chosenAgentId || !agentMap.has(chosenAgentId)) continue;

      totalSimulations += 1;
      if (log.createdAt >= cutoff24h) simulationsLast24h += 1;
      const day = dailyMap.get(logDate);
      if (day) day.simulations += 1;

      const current = agentUsageMap.get(chosenAgentId) || { runs: 0, confidenceSum: 0 };
      current.runs += 1;
      current.confidenceSum += parsed?.result?.confidence || 0;
      agentUsageMap.set(chosenAgentId, current);

      const provider = parsed?.modelProvider || "ollama";
      const modelKey = parsed?.usedAgno ? `${provider}:${parsed?.modelId || "default"}` : "local-fallback";
      const llmCurrent = llmUsageMap.get(modelKey) || { simulations: 0, chats: 0 };
      llmCurrent.simulations += 1;
      llmUsageMap.set(modelKey, llmCurrent);
    }

    if (log.action === "agno:chat") {
      const parsed = safeJsonParse(log.afterJson) as { usedAgno?: boolean; modelId?: string | null; modelProvider?: string | null } | null;
      const provider = parsed?.modelProvider || "ollama";
      const modelKey = parsed?.usedAgno ? `${provider}:${parsed?.modelId || "default"}` : "local-fallback";
      const llmCurrent = llmUsageMap.get(modelKey) || { simulations: 0, chats: 0 };
      llmCurrent.chats += 1;
      llmUsageMap.set(modelKey, llmCurrent);
    }

    if (log.action === "agent:assign-tool") {
      const parsed = safeJsonParse(log.afterJson) as { toolId?: string; canWrite?: boolean } | null;
      const toolId = parsed?.toolId;
      if (!toolId || !toolMap.has(toolId)) continue;

      const current = toolAssignmentMap.get(toolId) || { assignments: 0, writeAssignments: 0 };
      current.assignments += 1;
      if (parsed?.canWrite) {
        current.writeAssignments += 1;
        writeToolAssignments += 1;
      }
      toolAssignmentMap.set(toolId, current);
    }
  }

  const agentUsage = Array.from(agentUsageMap.entries())
    .map(([agentId, data]) => {
      const agent = agentMap.get(agentId)!;
      return {
        agentId,
        agentName: agent.name,
        type: agent.type,
        teamKey: agent.teamId ? teamMap.get(agent.teamId) || "UNKNOWN" : "GLOBAL",
        runs: data.runs,
        avgConfidence: data.runs ? Number((data.confidenceSum / data.runs).toFixed(3)) : 0,
      };
    })
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 10);

  const toolConsumption = visibleTools.map((tool) => {
    const usage = toolAssignmentMap.get(tool.id) || { assignments: 0, writeAssignments: 0 };
    return {
      toolId: tool.id,
      toolName: tool.name,
      type: tool.type,
      policy: tool.policy,
      teamKey: tool.teamId ? teamMap.get(tool.teamId) || "UNKNOWN" : "GLOBAL",
      linkedAgents: tool._count.agentLinks,
      assignments: usage.assignments,
      writeAssignments: usage.writeAssignments,
      rateLimitPerMinute: tool.rateLimitPerMinute,
    };
  });

  const llmConsumption = Array.from(llmUsageMap.entries())
    .map(([modelId, usage]) => ({
      modelId,
      simulations: usage.simulations,
      chats: usage.chats,
      total: usage.simulations + usage.chats,
    }))
    .sort((a, b) => b.total - a.total);

  const mcpToolConsumption = Array.from(
    visibleTools.reduce((acc, tool) => {
      const usage = toolAssignmentMap.get(tool.id) || { assignments: 0, writeAssignments: 0 };
      const current = acc.get(tool.type) || { type: tool.type, tools: 0, linkedAgents: 0, assignments: 0, writeAssignments: 0, totalRateLimitPerMinute: 0 };
      current.tools += 1;
      current.linkedAgents += tool._count.agentLinks;
      current.assignments += usage.assignments;
      current.writeAssignments += usage.writeAssignments;
      current.totalRateLimitPerMinute += tool.rateLimitPerMinute;
      acc.set(tool.type, current);
      return acc;
    }, new Map<string, { type: string; tools: number; linkedAgents: number; assignments: number; writeAssignments: number; totalRateLimitPerMinute: number }>()),
  )
    .map(([, value]) => value)
    .sort((a, b) => b.assignments - a.assignments);

  res.json({
    cards,
    usageSummary: {
      totalSimulations,
      simulationsLast24h,
      deniedEventsLast24h,
      auditEventsLast24h,
      writeToolAssignments,
      configuredToolCapacityPerMin: visibleTools.reduce((sum, tool) => sum + tool.rateLimitPerMinute, 0),
    },
    agentUsage,
    toolConsumption,
    llmConsumption,
    mcpToolConsumption,
    dailyConsumption: days.map((day) => dailyMap.get(day)),
  });
});

app.get("/api/teams", async (req, res) => {
  const user = getReq(req).user!;
  const teams = await db.team.findMany({ where: user.role === "TEAM_MAINTAINER" ? { id: user.teamId || "" } : {}, orderBy: { name: "asc" } });
  res.json({ teams });
});

app.get("/api/access/users", ensureAdmin, async (_req, res) => {
  const users = await db.user.findMany({
    select: { id: true, email: true, role: true, teamId: true, createdAt: true, updatedAt: true, team: { select: { key: true, name: true } } },
    orderBy: { email: "asc" },
  });
  res.json({ users });
});

app.post("/api/access/users", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const input = parse(accessUserCreateSchema, req.body);
  const passwordHash = await bcrypt.hash(input.password, 10);
  const created = await db.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash,
      role: input.role,
      teamId: input.teamId || null,
    },
    select: { id: true, email: true, role: true, teamId: true, createdAt: true, updatedAt: true },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:user:create",
    entityType: "user",
    entityId: created.id,
    afterJson: created,
    correlationId: r.correlationId,
  });
  res.status(201).json({ user: created });
});

app.put("/api/access/users/:id", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const userId = firstParam(req.params.id);
  const current = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true, role: true, teamId: true } });
  if (!current) return res.status(404).json({ error: "User not found" });
  const input = parse(accessUserUpdateSchema, req.body);
  const updated = await db.user.update({
    where: { id: current.id },
    data: {
      role: input.role ?? current.role,
      teamId: input.teamId === undefined ? current.teamId : input.teamId || null,
    },
    select: { id: true, email: true, role: true, teamId: true, createdAt: true, updatedAt: true },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:user:update",
    entityType: "user",
    entityId: updated.id,
    beforeJson: current,
    afterJson: updated,
    correlationId: r.correlationId,
  });
  res.json({ user: updated });
});

app.post("/api/access/users/:id/reset-password", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const userId = firstParam(req.params.id);
  const current = await db.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
  if (!current) return res.status(404).json({ error: "User not found" });
  const input = parse(accessPasswordResetSchema, req.body);
  const passwordHash = await bcrypt.hash(input.newPassword, 10);
  await db.user.update({ where: { id: current.id }, data: { passwordHash } });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:user:reset-password",
    entityType: "user",
    entityId: current.id,
    afterJson: { id: current.id, email: current.email, passwordReset: true },
    correlationId: r.correlationId,
  });
  res.json({ ok: true });
});

app.get("/api/access/groups", ensureAdmin, async (_req, res) => {
  const groups = await db.group.findMany({
    include: {
      team: { select: { id: true, key: true, name: true } },
      memberships: { include: { user: { select: { id: true, email: true, role: true, teamId: true } } } },
      _count: { select: { memberships: true } },
    },
    orderBy: [{ teamId: "asc" }, { name: "asc" }],
  });
  res.json({ groups });
});

app.post("/api/access/groups", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const input = parse(accessGroupSchema, req.body);
  const group = await db.group.create({
    data: {
      name: input.name,
      description: input.description || null,
      teamId: input.teamId || null,
    },
    include: { team: { select: { id: true, key: true, name: true } }, _count: { select: { memberships: true } } },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:group:create",
    entityType: "group",
    entityId: group.id,
    afterJson: group,
    correlationId: r.correlationId,
  });
  res.status(201).json({ group });
});

app.put("/api/access/groups/:id", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const groupId = firstParam(req.params.id);
  const current = await db.group.findUnique({ where: { id: groupId } });
  if (!current) return res.status(404).json({ error: "Group not found" });
  const input = parse(accessGroupSchema, req.body);
  const group = await db.group.update({
    where: { id: current.id },
    data: { name: input.name, description: input.description || null, teamId: input.teamId || null },
    include: { team: { select: { id: true, key: true, name: true } }, _count: { select: { memberships: true } } },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:group:update",
    entityType: "group",
    entityId: group.id,
    beforeJson: current,
    afterJson: group,
    correlationId: r.correlationId,
  });
  res.json({ group });
});

app.delete("/api/access/groups/:id", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const groupId = firstParam(req.params.id);
  const current = await db.group.findUnique({ where: { id: groupId } });
  if (!current) return res.status(404).json({ error: "Group not found" });
  await db.groupMembership.deleteMany({ where: { groupId: current.id } });
  await db.group.delete({ where: { id: current.id } });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:group:delete",
    entityType: "group",
    entityId: current.id,
    beforeJson: current,
    correlationId: r.correlationId,
  });
  res.json({ ok: true });
});

app.post("/api/access/groups/:id/members", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const groupId = firstParam(req.params.id);
  const group = await db.group.findUnique({ where: { id: groupId } });
  if (!group) return res.status(404).json({ error: "Group not found" });
  const input = parse(accessGroupMembershipSchema, req.body);
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  const membership = await db.groupMembership.upsert({
    where: { groupId_userId: { groupId: group.id, userId: user.id } },
    update: {},
    create: { groupId: group.id, userId: user.id },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:group:add-member",
    entityType: "group_membership",
    entityId: membership.id,
    afterJson: membership,
    correlationId: r.correlationId,
  });
  res.status(201).json({ membership });
});

app.delete("/api/access/groups/:id/members/:userId", ensureAdmin, async (req, res) => {
  const r = getReq(req);
  const groupId = firstParam(req.params.id);
  const userId = firstParam(req.params.userId);
  const current = await db.groupMembership.findUnique({ where: { groupId_userId: { groupId, userId } } });
  if (!current) return res.status(404).json({ error: "Membership not found" });
  await db.groupMembership.delete({ where: { groupId_userId: { groupId, userId } } });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "access:group:remove-member",
    entityType: "group_membership",
    entityId: current.id,
    beforeJson: current,
    correlationId: r.correlationId,
  });
  res.json({ ok: true });
});

app.get("/api/agents", async (req, res) => {
  const user = getReq(req).user!;
  const agents = await db.agent.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { OR: [{ teamId: user.teamId || "" }, { visibility: "shared" }, { isGlobal: true }] } : {},
    include: {
      toolLinks: { include: { tool: true } },
      knowledgeLinks: { include: { knowledgeSource: true } },
      skillLinks: { include: { skill: true } },
    },
    orderBy: [{ visibility: "desc" }, { isGlobal: "desc" }, { name: "asc" }],
  });
  res.json({ agents });
});

app.post("/api/agents", async (req, res) => {
  const r = getReq(req);
  const input = parse(agentSchema, req.body);
  const payload = normalizeAgentPayload(input);
  const ownerTeamId = payload.teamId || null;

  if (!canMutateTeamResource(r.user!, ownerTeamId, payload.isGlobal)) {
    await auditDenied(r, "agent:create", "Not allowed for this team/global scope", "agent");
    res.status(403).json({ error: "Policy denied" });
    return;
  }

  const agent = await db.agent.create({ data: payload });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:create",
    entityType: "agent",
    entityId: agent.id,
    afterJson: agent,
    correlationId: r.correlationId,
  });
  res.status(201).json({ agent });
});

app.put("/api/agents/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Agent not found" });

  if (!canMutateTeamResource(r.user!, current.teamId, current.isGlobal)) {
    await auditDenied(r, "agent:update", "Not allowed for this team/global scope", "agent");
    return res.status(403).json({ error: "Policy denied" });
  }

  const pol = evaluatePolicy({ actor: r.user!, action: "agent:update", ownerTeamId: current.teamId, agent: current });
  if (!pol.allow) {
    await auditDenied(r, "agent:update", pol.reason || "Denied", "agent");
    return res.status(403).json({ error: pol.reason || "Denied" });
  }

  const input = parse(agentSchema, req.body);
  const updated = await db.agent.update({ where: { id: current.id }, data: normalizeAgentPayload(input) });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:update",
    entityType: "agent",
    entityId: updated.id,
    beforeJson: current,
    afterJson: updated,
    correlationId: r.correlationId,
  });
  res.json({ agent: updated });
});

app.put("/api/agents/:id/customization", async (req, res) => {
  const r = getReq(req);
  const current = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Agent not found" });

  if (!canMutateTeamResource(r.user!, current.teamId, current.isGlobal)) {
    await auditDenied(r, "agent:customization", "Not allowed for this team/global scope", "agent");
    return res.status(403).json({ error: "Policy denied" });
  }

  const pol = evaluatePolicy({ actor: r.user!, action: "agent:update", ownerTeamId: current.teamId, agent: current });
  if (!pol.allow) {
    await auditDenied(r, "agent:customization", pol.reason || "Denied", "agent");
    return res.status(403).json({ error: pol.reason || "Denied" });
  }

  const input = parse(customizationProtectionSchema, req.body);
  const updated = await db.agent.update({
    where: { id: current.id },
    data: {
      userCustomized: input.userCustomized,
      customizationNote: input.customizationNote?.trim() || null,
      customizationUpdatedAt: input.userCustomized ? new Date() : null,
    },
  });
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:customization",
    entityType: "agent",
    entityId: updated.id,
    beforeJson: current,
    afterJson: updated,
    correlationId: r.correlationId,
  });
  res.json({ agent: updated });
});

app.delete("/api/agents/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, current.teamId, current.isGlobal)) {
    await auditDenied(r, "agent:delete", "Not allowed for this team/global scope", "agent");
    return res.status(403).json({ error: "Policy denied" });
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.agentTool.deleteMany({ where: { agentId: current.id } });
      await tx.agentSkill.deleteMany({ where: { agentId: current.id } });
      await tx.agentKnowledge.deleteMany({ where: { agentId: current.id } });
      await tx.handoff.deleteMany({
        where: {
          OR: [{ fromAgentId: current.id }, { toAgentId: current.id }],
        },
      });
      await tx.routingRule.deleteMany({ where: { targetAgentId: current.id } });
      await tx.routingRule.updateMany({
        where: { fallbackAgentId: current.id },
        data: { fallbackAgentId: null },
      });
      await tx.agent.delete({ where: { id: current.id } });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return res.status(409).json({
        error: "Agent cannot be removed because it is still referenced by other records.",
        correlationId: r.correlationId,
      });
    }
    throw error;
  }
  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:delete",
    entityType: "agent",
    entityId: current.id,
    beforeJson: current,
    correlationId: r.correlationId,
  });
  res.json({ ok: true });
});

app.post("/api/agents/:id/tools", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  const input = parse(assignToolSchema, req.body);
  const tool = await db.tool.findUnique({ where: { id: input.toolId } });
  if (!tool) return res.status(404).json({ error: "Tool not found" });

  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) {
    await auditDenied(r, "agent:assign-tool", "Scope denied", "agent_tool");
    return res.status(403).json({ error: "Policy denied" });
  }
  if (!canReadTeamResource(r.user!, tool.teamId, tool.visibility, false)) {
    return res.status(403).json({ error: "Tool visibility denied" });
  }

  if (tool.policy === ToolPolicy.write && !canAgentUseWriteTools(agent)) {
    return res.status(400).json({ error: "Only agents with write-capable execution profile may receive write tools." });
  }

  if (tool.policy === ToolPolicy.write) {
    const pol = evaluatePolicy({ actor: r.user!, action: "tool:write-assign", ownerTeamId: agent.teamId, tool, requiresWrite: true, justification: input.justification });
    if (!pol.allow) {
      await auditDenied(r, "tool:write-assign", pol.reason || "Denied", "agent_tool");
      return res.status(403).json({ error: pol.reason || "Denied" });
    }
  }

  const link = await db.agentTool.upsert({
    where: { agentId_toolId: { agentId: agent.id, toolId: tool.id } },
    update: { canRead: input.canRead, canWrite: input.canWrite },
    create: { agentId: agent.id, toolId: tool.id, canRead: input.canRead, canWrite: input.canWrite },
  });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:assign-tool",
    entityType: "agent_tool",
    entityId: link.id,
    afterJson: link,
    correlationId: r.correlationId,
  });

  res.status(201).json({ link });
});

app.delete("/api/agents/:id/tools/:toolId", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) return res.status(403).json({ error: "Policy denied" });
  await db.agentTool.delete({ where: { agentId_toolId: { agentId: req.params.id, toolId: req.params.toolId } } });
  res.json({ ok: true });
});

app.post("/api/agents/:id/knowledge", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) {
    await auditDenied(r, "agent:assign-knowledge", "Scope denied", "agent_knowledge");
    return res.status(403).json({ error: "Policy denied" });
  }

  const input = parse(assignKnowledgeSchema, req.body);
  const source = await db.knowledgeSource.findUnique({ where: { id: input.knowledgeSourceId } });
  if (!source) return res.status(404).json({ error: "Knowledge source not found" });
  if (!canReadTeamResource(r.user!, source.ownerTeamId, source.visibility, false)) {
    return res.status(403).json({ error: "Knowledge source visibility denied" });
  }

  const link = await db.agentKnowledge.upsert({
    where: { agentId_knowledgeSourceId: { agentId: agent.id, knowledgeSourceId: source.id } },
    update: {},
    create: { agentId: agent.id, knowledgeSourceId: source.id },
  });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:assign-knowledge",
    entityType: "agent_knowledge",
    entityId: link.id,
    afterJson: link,
    correlationId: r.correlationId,
  });
  res.status(201).json({ link });
});

app.delete("/api/agents/:id/knowledge/:knowledgeSourceId", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) return res.status(403).json({ error: "Policy denied" });
  await db.agentKnowledge.delete({
    where: { agentId_knowledgeSourceId: { agentId: req.params.id, knowledgeSourceId: req.params.knowledgeSourceId } },
  });
  res.json({ ok: true });
});

app.post("/api/agents/:id/skills", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) {
    await auditDenied(r, "agent:assign-skill", "Scope denied", "agent_skill");
    return res.status(403).json({ error: "Policy denied" });
  }

  const skillId = typeof req.body?.skillId === "string" ? req.body.skillId : "";
  if (!skillId) return res.status(400).json({ error: "skillId is required" });

  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill) return res.status(404).json({ error: "Skill not found" });
  if (!canReadTeamResource(r.user!, skill.ownerTeamId, skill.visibility, false)) {
    return res.status(403).json({ error: "Skill visibility denied" });
  }

  const link = await db.agentSkill.upsert({
    where: { agentId_skillId: { agentId: agent.id, skillId: skill.id } },
    update: {},
    create: { agentId: agent.id, skillId: skill.id },
  });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agent:assign-skill",
    entityType: "agent_skill",
    entityId: link.id,
    afterJson: link,
    correlationId: r.correlationId,
  });
  res.status(201).json({ link });
});

app.delete("/api/agents/:id/skills/:skillId", async (req, res) => {
  const r = getReq(req);
  const agent = await db.agent.findUnique({ where: { id: req.params.id } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, agent.teamId, agent.isGlobal)) return res.status(403).json({ error: "Policy denied" });
  await db.agentSkill.delete({ where: { agentId_skillId: { agentId: req.params.id, skillId: req.params.skillId } } });
  res.json({ ok: true });
});

app.get("/api/tools", async (req, res) => {
  const user = getReq(req).user!;
  const tools = await db.tool.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { OR: [{ teamId: user.teamId || "" }, { visibility: "shared" }, { teamId: null }] } : {},
    orderBy: { name: "asc" },
  });
  res.json({ tools });
});

app.post("/api/tools", async (req, res) => {
  const r = getReq(req);
  const input = parse(toolSchema, req.body);

  const pol = evaluatePolicy({ actor: r.user!, action: "tool:create", ownerTeamId: input.teamId || null, tool: { policy: input.policy } as never });
  if (!pol.allow) {
    await auditDenied(r, "tool:create", pol.reason || "Denied", "tool");
    return res.status(403).json({ error: pol.reason || "Denied" });
  }

  if (r.user!.role === "TEAM_MAINTAINER" && input.teamId !== r.user!.teamId) {
    return res.status(403).json({ error: "Team scope denied" });
  }

  const tool = await db.tool.create({ data: { ...input, teamId: input.teamId || null, visibility: input.visibility } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "tool:create", entityType: "tool", entityId: tool.id, afterJson: tool, correlationId: r.correlationId });
  res.status(201).json({ tool });
});

app.put("/api/tools/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.tool.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Tool not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed tools must be changed in Agno/MCP runtime, not in the portal." });
  }
  const input = parse(toolSchema, req.body);

  const pol = evaluatePolicy({ actor: r.user!, action: "tool:update", ownerTeamId: current.teamId, tool: current });
  if (!pol.allow) {
    await auditDenied(r, "tool:update", pol.reason || "Denied", "tool");
    return res.status(403).json({ error: pol.reason || "Denied" });
  }
  if (r.user!.role === "TEAM_MAINTAINER" && current.teamId !== r.user!.teamId) {
    return res.status(403).json({ error: "Team scope denied" });
  }

  const updated = await db.tool.update({ where: { id: current.id }, data: { ...input, teamId: input.teamId || null, visibility: input.visibility } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "tool:update", entityType: "tool", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ tool: updated });
});

app.put("/api/tools/:id/customization", async (req, res) => {
  const r = getReq(req);
  const current = await db.tool.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Tool not found" });

  const pol = evaluatePolicy({ actor: r.user!, action: "tool:update", ownerTeamId: current.teamId, tool: current });
  if (!pol.allow) {
    await auditDenied(r, "tool:customization", pol.reason || "Denied", "tool");
    return res.status(403).json({ error: pol.reason || "Denied" });
  }
  if (r.user!.role === "TEAM_MAINTAINER" && current.teamId !== r.user!.teamId) {
    return res.status(403).json({ error: "Team scope denied" });
  }

  const input = parse(customizationProtectionSchema, req.body);
  const updated = await db.tool.update({
    where: { id: current.id },
    data: {
      userCustomized: input.userCustomized,
      customizationNote: input.customizationNote?.trim() || null,
      customizationUpdatedAt: input.userCustomized ? new Date() : null,
    },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "tool:customization", entityType: "tool", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ tool: updated });
});

app.delete("/api/tools/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.tool.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Tool not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed tools cannot be deleted from the portal." });
  }
  if (!canMutateTeamResource(r.user!, current.teamId, false)) return res.status(403).json({ error: "Policy denied" });
  await db.tool.delete({ where: { id: current.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "tool:delete", entityType: "tool", entityId: current.id, beforeJson: current, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.get("/api/knowledge-sources", async (req, res) => {
  const user = getReq(req).user!;
  const items = await db.knowledgeSource.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { OR: [{ ownerTeamId: user.teamId || "" }, { visibility: "shared" }] } : {},
    orderBy: { name: "asc" },
  });
  res.json({ knowledgeSources: items });
});

app.get("/api/skills", async (req, res) => {
  const user = getReq(req).user!;
  const items = await db.skill.findMany({
    where: user.role === "TEAM_MAINTAINER"
      ? { AND: [{ category: { not: "workflow" } }, { OR: [{ ownerTeamId: user.teamId || "" }, { visibility: "shared" }] }] }
      : { category: { not: "workflow" } },
    include: { agentLinks: true },
    orderBy: { name: "asc" },
  });
  res.json({
    skills: items.map((item) => ({
      ...item,
      linkedAgentIds: item.agentLinks.map((link: { agentId: string }) => link.agentId),
    })),
  });
});

app.post("/api/skills", async (req, res) => {
  const r = getReq(req);
  const input = parse(skillSchema, req.body);
  if (!canMutateTeamResource(r.user!, input.ownerTeamId || null, false)) return res.status(403).json({ error: "Policy denied" });

  const skill = await db.skill.create({
    data: {
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      runbookUrl: input.runbookUrl || null,
      category: input.category,
      enabled: input.enabled,
      visibility: input.visibility,
      ownerTeamId: input.ownerTeamId || null,
      managedBy: "portal",
      runtimeSource: null,
      agentLinks: input.linkedAgentIds.length
        ? { create: input.linkedAgentIds.map((agentId) => ({ agentId })) }
        : undefined,
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "skill:create", entityType: "skill", entityId: skill.id, afterJson: skill, correlationId: r.correlationId });
  res.status(201).json({ skill: { ...skill, linkedAgentIds: skill.agentLinks.map((link: { agentId: string }) => link.agentId) } });
});

app.put("/api/skills/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.skill.findUnique({ where: { id: req.params.id }, include: { agentLinks: true } });
  if (!current) return res.status(404).json({ error: "Skill not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed skills must be changed in Agno runtime, not in the portal." });
  }
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });

  const input = parse(skillSchema, req.body);
  const updated = await db.skill.update({
    where: { id: current.id },
    data: {
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      runbookUrl: input.runbookUrl || null,
      category: input.category,
      enabled: input.enabled,
      visibility: input.visibility,
      ownerTeamId: input.ownerTeamId || null,
      managedBy: current.managedBy || "portal",
      runtimeSource: current.runtimeSource || null,
      agentLinks: {
        deleteMany: {},
        create: input.linkedAgentIds.map((agentId) => ({ agentId })),
      },
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "skill:update", entityType: "skill", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ skill: { ...updated, linkedAgentIds: updated.agentLinks.map((link: { agentId: string }) => link.agentId) } });
});

app.put("/api/skills/:id/customization", async (req, res) => {
  const r = getReq(req);
  const current = await db.skill.findUnique({ where: { id: req.params.id }, include: { agentLinks: true } });
  if (!current) return res.status(404).json({ error: "Skill not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });

  const input = parse(customizationProtectionSchema, req.body);
  const updated = await db.skill.update({
    where: { id: current.id },
    data: {
      userCustomized: input.userCustomized,
      customizationNote: input.customizationNote?.trim() || null,
      customizationUpdatedAt: input.userCustomized ? new Date() : null,
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "skill:customization", entityType: "skill", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ skill: { ...updated, linkedAgentIds: updated.agentLinks.map((link: { agentId: string }) => link.agentId) } });
});

app.delete("/api/skills/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.skill.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Skill not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed skills cannot be deleted from the portal." });
  }
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  await db.skill.delete({ where: { id: current.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "skill:delete", entityType: "skill", entityId: current.id, beforeJson: current, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.get("/api/workflows", async (req, res) => {
  const user = getReq(req).user!;
  const items = await workflowDb.workflow.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { OR: [{ ownerTeamId: user.teamId || "" }, { visibility: "shared" }] } : {},
    include: { agentLinks: true },
    orderBy: { name: "asc" },
  });
  res.json({ workflows: items.map((item: any) => serializeWorkflow(item)) });
});

app.post("/api/workflows", async (req, res) => {
  const r = getReq(req);
  const input = parse(workflowSchema, req.body);
  if (!canMutateTeamResource(r.user!, input.ownerTeamId || null, false)) return res.status(403).json({ error: "Policy denied" });

  const workflow = await workflowDb.workflow.create({
    data: {
      name: input.name,
      description: input.description,
      objective: input.objective,
      preconditions: input.preconditions,
      integrationKeys: input.integrationKeys,
      steps: input.steps,
      successCriteria: input.successCriteria,
      outputFormat: input.outputFormat,
      failureHandling: input.failureHandling,
      setupPoints: input.setupPoints,
      enabled: input.enabled,
      visibility: input.visibility,
      ownerTeamId: input.ownerTeamId || null,
      managedBy: "portal",
      runtimeSource: null,
      agentLinks: input.participantAgentIds.length ? { create: input.participantAgentIds.map((agentId) => ({ agentId })) } : undefined,
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "workflow:create", entityType: "workflow", entityId: workflow.id, afterJson: workflow, correlationId: r.correlationId });
  res.status(201).json({ workflow: serializeWorkflow(workflow) });
});

app.put("/api/workflows/:id", async (req, res) => {
  const r = getReq(req);
  const current = await workflowDb.workflow.findUnique({ where: { id: req.params.id }, include: { agentLinks: true } });
  if (!current) return res.status(404).json({ error: "Workflow not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed workflows must be changed in Agno runtime, not in the portal." });
  }
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  const input = parse(workflowSchema, req.body);
  const updated = await workflowDb.workflow.update({
    where: { id: current.id },
    data: {
      name: input.name,
      description: input.description,
      objective: input.objective,
      preconditions: input.preconditions,
      integrationKeys: input.integrationKeys,
      steps: input.steps,
      successCriteria: input.successCriteria,
      outputFormat: input.outputFormat,
      failureHandling: input.failureHandling,
      setupPoints: input.setupPoints,
      enabled: input.enabled,
      visibility: input.visibility,
      ownerTeamId: input.ownerTeamId || null,
      managedBy: current.managedBy || "portal",
      runtimeSource: current.runtimeSource || null,
      agentLinks: {
        deleteMany: {},
        create: input.participantAgentIds.map((agentId) => ({ agentId })),
      },
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "workflow:update", entityType: "workflow", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ workflow: serializeWorkflow(updated) });
});

app.put("/api/workflows/:id/customization", async (req, res) => {
  const r = getReq(req);
  const current = await workflowDb.workflow.findUnique({ where: { id: req.params.id }, include: { agentLinks: true } });
  if (!current) return res.status(404).json({ error: "Workflow not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  const input = parse(customizationProtectionSchema, req.body);
  const updated = await workflowDb.workflow.update({
    where: { id: current.id },
    data: {
      userCustomized: input.userCustomized,
      customizationNote: input.customizationNote?.trim() || null,
      customizationUpdatedAt: input.userCustomized ? new Date() : null,
    },
    include: { agentLinks: true },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "workflow:customization", entityType: "workflow", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ workflow: serializeWorkflow(updated) });
});

app.delete("/api/workflows/:id", async (req, res) => {
  const r = getReq(req);
  const current = await workflowDb.workflow.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Workflow not found" });
  if (isRuntimeManaged(current.managedBy)) {
    return res.status(409).json({ error: "Runtime-managed workflows cannot be deleted from the portal." });
  }
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  await workflowDb.workflow.delete({ where: { id: current.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "workflow:delete", entityType: "workflow", entityId: current.id, beforeJson: current, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.post("/api/workflows/:id/setup-check", async (req, res) => {
  const r = getReq(req);
  const workflow = await workflowDb.workflow.findUnique({ where: { id: req.params.id } });
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });
  if (!canReadTeamResource(r.user!, workflow.ownerTeamId, workflow.visibility, false)) {
    return res.status(403).json({ error: "Policy denied" });
  }
  if (!config.agnoEnabled) return res.status(400).json({ error: "Agno integration disabled" });
  const integrationKeys = Array.isArray(workflow.integrationKeys) ? workflow.integrationKeys.map((item: unknown) => String(item)) : [];
  const setupCheck = await callAgnoWorkflowSetupCheck(config.agnoBaseUrl, { integrationKeys }, r.correlationId);
  if (!setupCheck.data) {
    return res.status(502).json({ error: setupCheck.error || "Failed to validate workflow setup" });
  }
  res.json(setupCheck.data);
});

app.post("/api/knowledge-sources", async (req, res) => {
  const r = getReq(req);
  const input = parse(knowledgeSchema, req.body);
  if (!canMutateTeamResource(r.user!, input.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  const item = await db.knowledgeSource.create({ data: { ...input, tags: input.tags, visibility: input.visibility } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "knowledge:create", entityType: "knowledge_source", entityId: item.id, afterJson: item, correlationId: r.correlationId });
  res.status(201).json({ knowledgeSource: item });
});

app.put("/api/knowledge-sources/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.knowledgeSource.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Knowledge source not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  const input = parse(knowledgeSchema, req.body);
  const updated = await db.knowledgeSource.update({ where: { id: current.id }, data: { ...input, tags: input.tags, visibility: input.visibility } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "knowledge:update", entityType: "knowledge_source", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ knowledgeSource: updated });
});

app.put("/api/knowledge-sources/:id/customization", async (req, res) => {
  const r = getReq(req);
  const current = await db.knowledgeSource.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Knowledge source not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });

  const input = parse(customizationProtectionSchema, req.body);
  const updated = await db.knowledgeSource.update({
    where: { id: current.id },
    data: {
      userCustomized: input.userCustomized,
      customizationNote: input.customizationNote?.trim() || null,
      customizationUpdatedAt: input.userCustomized ? new Date() : null,
    },
  });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "knowledge:customization", entityType: "knowledge_source", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ knowledgeSource: updated });
});

app.delete("/api/knowledge-sources/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.knowledgeSource.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Knowledge source not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  await db.knowledgeSource.delete({ where: { id: current.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "knowledge:delete", entityType: "knowledge_source", entityId: current.id, beforeJson: current, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.post("/api/knowledge-sources/:id/sync", async (req, res) => {
  const r = getReq(req);
  const current = await db.knowledgeSource.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Knowledge source not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });

  const simulatedDocs = Math.max(current.indexedDocuments || 0, 20) + crypto.randomInt(0, 15);
  const updated = await db.knowledgeSource.update({
    where: { id: current.id },
    data: {
      syncStatus: "synced",
      lastSyncedAt: new Date(),
      lastSyncError: null,
      indexedDocuments: simulatedDocs,
    },
  });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "knowledge:sync",
    entityType: "knowledge_source",
    entityId: updated.id,
    beforeJson: current,
    afterJson: updated,
    correlationId: r.correlationId,
  });
  res.json({ knowledgeSource: updated });
});

app.get("/api/graph", async (req, res) => {
  const user = getReq(req).user!;
  const teamId = typeof req.query.teamId === "string" ? req.query.teamId : undefined;
  const where: Prisma.AgentWhereInput = user.role === "TEAM_MAINTAINER"
    ? { OR: [{ teamId: user.teamId || "" }, { visibility: "shared" }, { isGlobal: true }] }
    : teamId
      ? { OR: [{ teamId }, { visibility: "shared" }, { isGlobal: true }] }
      : {};
  const agents = await db.agent.findMany({ where, orderBy: [{ visibility: "desc" }, { isGlobal: "desc" }, { name: "asc" }] });
  const ids = agents.map((a) => a.id);
  const edges = await db.handoff.findMany({ where: { fromAgentId: { in: ids }, toAgentId: { in: ids } } });
  res.json({ nodes: agents, edges });
});

app.post("/api/handoffs", async (req, res) => {
  const r = getReq(req);
  const input = parse(handoffSchema, req.body);
  const [from, to] = await Promise.all([
    db.agent.findUnique({ where: { id: input.fromAgentId } }),
    db.agent.findUnique({ where: { id: input.toAgentId } }),
  ]);
  if (!from || !to) return res.status(404).json({ error: "Agent not found" });
  if (!canMutateTeamResource(r.user!, from.teamId, from.isGlobal)) return res.status(403).json({ error: "Policy denied" });
  const edge = await db.handoff.create({ data: input });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "handoff:create", entityType: "handoff", entityId: edge.id, afterJson: edge, correlationId: r.correlationId });
  res.status(201).json({ handoff: edge });
});

app.delete("/api/handoffs/:id", async (req, res) => {
  const r = getReq(req);
  const edge = await db.handoff.findUnique({ where: { id: req.params.id }, include: { fromAgent: true } });
  if (!edge) return res.status(404).json({ error: "Handoff not found" });
  if (!canMutateTeamResource(r.user!, edge.fromAgent.teamId, edge.fromAgent.isGlobal)) return res.status(403).json({ error: "Policy denied" });
  await db.handoff.delete({ where: { id: edge.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "handoff:delete", entityType: "handoff", entityId: edge.id, beforeJson: edge, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.get("/api/routing-rules", async (req, res) => {
  const user = getReq(req).user!;
  const items = await db.routingRule.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { OR: [{ ownerTeamId: user.teamId || "" }, { ownerTeamId: null }] } : {},
    orderBy: { name: "asc" },
  });
  res.json({ rules: items });
});

app.post("/api/routing-rules", async (req, res) => {
  const r = getReq(req);
  const input = parse(routingRuleSchema, req.body);
  if (!canMutateTeamResource(r.user!, input.ownerTeamId || null, false)) return res.status(403).json({ error: "Policy denied" });
  const created = await db.routingRule.create({ data: { ...input, ownerTeamId: input.ownerTeamId || null, fallbackAgentId: input.fallbackAgentId || null } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "routing:create", entityType: "routing_rule", entityId: created.id, afterJson: created, correlationId: r.correlationId });
  res.status(201).json({ rule: created });
});

app.put("/api/routing-rules/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.routingRule.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Rule not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  const input = parse(routingRuleSchema, req.body);
  const updated = await db.routingRule.update({ where: { id: current.id }, data: { ...input, ownerTeamId: input.ownerTeamId || null, fallbackAgentId: input.fallbackAgentId || null } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "routing:update", entityType: "routing_rule", entityId: updated.id, beforeJson: current, afterJson: updated, correlationId: r.correlationId });
  res.json({ rule: updated });
});

app.delete("/api/routing-rules/:id", async (req, res) => {
  const r = getReq(req);
  const current = await db.routingRule.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: "Rule not found" });
  if (!canMutateTeamResource(r.user!, current.ownerTeamId, false)) return res.status(403).json({ error: "Policy denied" });
  await db.routingRule.delete({ where: { id: current.id } });
  await writeAudit({ actorId: r.user!.id, actorRole: r.user!.role, actorTeam: r.user!.teamId, action: "routing:delete", entityType: "routing_rule", entityId: current.id, beforeJson: current, correlationId: r.correlationId });
  res.json({ ok: true });
});

app.post("/api/simulator/run", async (req, res) => {
  const r = getReq(req);
  const input = parse(simulatorSchema, req.body);
  const safety = validateSafeSimulationInput(input.message);
  if (!safety.ok) {
    await auditDenied(r, "simulate:run", safety.reason || "Unsafe input", "simulation");
    return res.status(400).json({ error: safety.reason, sanitized: safety.sanitized });
  }

  const [teams, agents, handoffs, rules] = await Promise.all([
    db.team.findMany(),
    db.agent.findMany(),
    db.handoff.findMany(),
    db.routingRule.findMany(),
  ]);

  const forcedAgent = input.forcedAgentId ? agents.find((agent) => agent.id === input.forcedAgentId) || null : null;
  if (input.forcedAgentId && !forcedAgent) {
    return res.status(404).json({ error: "Forced agent not found" });
  }
  if (forcedAgent && !canReadTeamResource(r.user!, forcedAgent.teamId, forcedAgent.visibility, forcedAgent.isGlobal)) {
    return res.status(403).json({ error: "Policy denied" });
  }

  const agnoResponse = config.agnoEnabled && !forcedAgent
    ? await callAgnoSimulate(config.agnoBaseUrl, {
        message: safety.sanitized,
        suggestedTeamId: input.suggestedTeamId,
        contextTags: input.contextTags,
        teams: teams.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description })),
        agents: agents.map((a) => ({
          id: a.id,
          name: a.name,
          type: a.type,
          persona: a.persona,
          routingRole: a.routingRole,
          executionProfile: a.executionProfile,
          capabilities: a.capabilities,
          domains: a.domains,
          description: a.description,
          prompt: a.prompt,
          tags: a.tags,
          isGlobal: a.isGlobal,
          visibility: a.visibility,
          teamId: a.teamId,
        })),
        handoffs: handoffs.map((h) => ({ fromAgentId: h.fromAgentId, toAgentId: h.toAgentId })),
        rules: rules.map((rule) => ({
          ownerTeamId: rule.ownerTeamId,
          targetAgentId: rule.targetAgentId,
          fallbackAgentId: rule.fallbackAgentId,
          keywords: rule.keywords,
          tags: rule.tags,
        })),
        advanced: input.advanced,
      }, r.correlationId)
    : null;
  const agnoResult = agnoResponse?.data || null;
  if (agnoResponse?.error) {
    logger.warn({ correlationId: r.correlationId, error: agnoResponse.error }, "agno_simulate_fallback");
  }

  let result =
    agnoResult ||
    runSimulation({
      message: safety.sanitized,
      teams,
      agents,
      handoffs,
      rules,
      suggestedTeamId: input.suggestedTeamId,
      forcedAgentId: input.forcedAgentId,
      contextTags: input.contextTags,
    });

  if (result.chosenAgent?.id) {
    const sources = await db.agentKnowledge.findMany({ where: { agentId: result.chosenAgent.id }, include: { knowledgeSource: true } });
    result.usedSources = sources.map((s) => ({ id: s.knowledgeSource.id, name: s.knowledgeSource.name, url: s.knowledgeSource.url }));
  }

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "simulate:run",
    entityType: "simulation",
    correlationId: r.correlationId,
    afterJson: {
      messageHash: sha256(safety.sanitized),
      usedAgno: Boolean(agnoResult),
      agnoError: agnoResponse?.error || null,
      forcedAgentId: input.forcedAgentId || null,
      modelProvider: input.advanced?.modelProvider || null,
      modelId: input.advanced?.modelId || null,
      result,
    },
  });

  res.json(result);
});

app.post("/api/agno/chat", async (req, res) => {
  const r = getReq(req);
  const input = parse(agnoChatSchema, req.body);
  const safety = validateSafeSimulationInput(input.message);
  if (!safety.ok) return res.status(400).json({ error: safety.reason, sanitized: safety.sanitized });

  const agent = await db.agent.findUnique({ where: { id: input.agentId } });
  if (!agent) return res.status(404).json({ error: "Agent not found" });

  if (!canReadTeamResource(r.user!, agent.teamId, agent.visibility, agent.isGlobal)) {
    return res.status(403).json({ error: "Policy denied" });
  }

  const team = agent.teamId ? await db.team.findUnique({ where: { id: agent.teamId } }) : null;
  const [toolLinks, knowledgeLinks, skillLinks] = await Promise.all([
    db.agentTool.findMany({ where: { agentId: agent.id }, include: { tool: true } }),
    db.agentKnowledge.findMany({ where: { agentId: agent.id }, include: { knowledgeSource: true } }),
    db.agentSkill.findMany({ where: { agentId: agent.id }, include: { skill: true } }),
  ]);
  const agnoResponse = config.agnoEnabled
    ? await callAgnoChat(config.agnoBaseUrl, {
        message: safety.sanitized,
        history: input.history,
        advanced: input.advanced,
        agent: {
          id: agent.id,
          name: agent.name,
          type: agent.type,
          persona: agent.persona,
          routingRole: agent.routingRole,
          executionProfile: agent.executionProfile,
          capabilities: agent.capabilities,
          domains: agent.domains,
          description: agent.description,
          prompt: agent.prompt,
          tags: agent.tags,
          teamKey: team?.key,
          tools: toolLinks.map((link) => ({
            id: link.tool.id,
            name: link.tool.name,
            description: link.tool.description,
            callName: link.tool.callName,
            policy: link.tool.policy,
            type: link.tool.type,
            transport: link.tool.transport,
            mode: link.tool.mode,
            canRead: link.canRead,
            canWrite: link.canWrite,
            managedBy: link.tool.managedBy || "portal",
            runtimeSource: link.tool.runtimeSource || null,
          })),
          knowledgeSources: knowledgeLinks.map((link) => ({
            id: link.knowledgeSource.id,
            name: link.knowledgeSource.name,
            url: link.knowledgeSource.url,
            tags: link.knowledgeSource.tags,
            sourceType: link.knowledgeSource.sourceType,
          })),
          runtimeConfig: agent.runtimeConfig,
          skills: skillLinks.map((link) => ({
            id: link.skill.id,
            name: link.skill.name,
            description: link.skill.description,
            prompt: link.skill.prompt,
            category: link.skill.category,
            enabled: link.skill.enabled,
            runbookUrl: link.skill.runbookUrl,
            managedBy: link.skill.managedBy,
            runtimeSource: link.skill.runtimeSource,
          })),
        },
      }, r.correlationId)
    : null;
  const agno = agnoResponse?.data || null;
  if (agnoResponse?.error) {
    logger.warn({ correlationId: r.correlationId, agentId: agent.id, error: agnoResponse.error }, "agno_chat_fallback");
  }

  const reply = agno?.reply || fallbackAgentReply(agent.type, agent.name, safety.sanitized, {
    persona: agent.persona,
    routingRole: agent.routingRole,
    executionProfile: agent.executionProfile,
  });
  const reasoningSummary = agno?.reasoningSummary?.length
    ? agno.reasoningSummary
    : fallbackReasoningSummary(agent.type, safety.sanitized, {
      persona: agent.persona,
      routingRole: agent.routingRole,
      executionProfile: agent.executionProfile,
    });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "agno:chat",
    entityType: "simulation",
    correlationId: r.correlationId,
    afterJson: {
      agentId: agent.id,
      messageHash: sha256(safety.sanitized),
      usedAgno: Boolean(agno),
      agnoError: agnoResponse?.error || null,
      modelProvider: input.advanced?.modelProvider || null,
      modelId: input.advanced?.modelId || null,
    },
  });

  res.json({
    reply,
    reasoningSummary,
    meta: {
      ...(agno?.meta || { usedAgno: false }),
      degraded: Boolean(agnoResponse?.error),
      agnoError: agnoResponse?.error || null,
    },
  });
});

async function exportConfigBundle() {
  const [teams, users, agents, tools, skills, workflows, agentTools, agentKnowledge, agentSkills, agentWorkflows, knowledgeSources, handoffs, routingRules] = await Promise.all([
    db.team.findMany(),
    db.user.findMany({ select: { id: true, email: true, role: true, teamId: true } }),
    db.agent.findMany(),
    db.tool.findMany(),
    db.skill.findMany(),
    workflowDb.workflow.findMany(),
    db.agentTool.findMany(),
    db.agentKnowledge.findMany(),
    db.agentSkill.findMany(),
    workflowDb.agentWorkflow.findMany(),
    db.knowledgeSource.findMany(),
    db.handoff.findMany(),
    db.routingRule.findMany(),
  ]);

  const payload = { teams, users, agents, tools, skills, workflows, agentTools, knowledgeSources, agentKnowledge, agentSkills, agentWorkflows, handoffs, routingRules };
  const raw = JSON.stringify(payload);
  return {
    exportedAt: new Date().toISOString(),
    configVersionHash: await computeConfigVersionHash(),
    signature: signPayload(raw),
    payload,
  };
}

app.get("/api/config/export", async (_req, res) => {
  const format = _req.query.format === "yaml" ? "yaml" : "json";
  const bundle = await exportConfigBundle();
  if (format === "yaml") {
    res.type("text/yaml").send(YAML.stringify(bundle));
    return;
  }
  res.json(bundle);
});

app.post("/api/config/import", async (req, res) => {
  const r = getReq(req);
  if (r.user!.role !== "ADMIN") {
    await auditDenied(r, "config:import", "Only admin may import configuration", "config");
    return res.status(403).json({ error: "Only admin may import configuration" });
  }

  const input = parse(configImportSchema, req.body);
  const parsed = input.format === "yaml" ? YAML.parse(input.payload) : JSON.parse(input.payload);

  if (!parsed?.payload || !parsed?.signature) {
    return res.status(400).json({ error: "Invalid config payload" });
  }

  const expected = signPayload(JSON.stringify(parsed.payload));
  if (expected !== parsed.signature) {
    return res.status(400).json({ error: "Config signature mismatch" });
  }

  const tools = parsed.payload.tools as Array<{ id: string; policy: string; name: string }>;
  const agents = parsed.payload.agents as Array<{ id: string; type: string; executionProfile?: string | null; capabilities?: unknown }>;
  const links = parsed.payload.agentTools as Array<{ agentId: string; toolId: string; canWrite: boolean }>;

  for (const link of links) {
    const agent = agents.find((a) => a.id === link.agentId);
    const tool = tools.find((t) => t.id === link.toolId);
    if (link.canWrite && agent && !canAgentUseWriteTools(agent)) {
      return res.status(400).json({ error: "Import policy violation: write tool assigned to non-write-capable agent." });
    }
    if (!agent || !tool) {
      return res.status(400).json({ error: "Import policy violation: invalid agent/tool link detected." });
    }
  }

  await db.$transaction(async (tx) => {
    await tx.handoff.deleteMany();
    await tx.agentKnowledge.deleteMany();
    await tx.agentSkill.deleteMany();
    const workflowTx = tx as typeof tx & { workflow: any; agentWorkflow: any };
    await workflowTx.agentWorkflow.deleteMany();
    await tx.agentTool.deleteMany();
    await tx.routingRule.deleteMany();
    await tx.knowledgeSource.deleteMany();
    await workflowTx.workflow.deleteMany();
    await tx.skill.deleteMany();
    await tx.tool.deleteMany();
    await tx.agent.deleteMany();
    await tx.team.deleteMany();

    for (const t of parsed.payload.teams) await tx.team.create({ data: t });
    for (const a of parsed.payload.agents) await tx.agent.create({ data: a });
    for (const t of parsed.payload.tools) await tx.tool.create({ data: t });
    for (const s of parsed.payload.skills || []) await tx.skill.create({ data: s });
    for (const workflow of parsed.payload.workflows || []) await workflowTx.workflow.create({ data: workflow });
    for (const k of parsed.payload.knowledgeSources) await tx.knowledgeSource.create({ data: k });
    for (const at of parsed.payload.agentTools) await tx.agentTool.create({ data: at });
    for (const ak of parsed.payload.agentKnowledge) await tx.agentKnowledge.create({ data: ak });
    for (const ask of parsed.payload.agentSkills || []) await tx.agentSkill.create({ data: ask });
    for (const aw of parsed.payload.agentWorkflows || []) await workflowTx.agentWorkflow.create({ data: aw });
    for (const h of parsed.payload.handoffs) await tx.handoff.create({ data: h });
    for (const rr of parsed.payload.routingRules) await tx.routingRule.create({ data: rr });
  });

  await writeAudit({
    actorId: r.user!.id,
    actorRole: r.user!.role,
    actorTeam: r.user!.teamId,
    action: "config:import",
    entityType: "config",
    correlationId: r.correlationId,
    afterJson: { importedAt: new Date().toISOString(), hash: parsed.configVersionHash },
  });

  res.json({ ok: true });
});

app.post("/api/catalog/sync", ensureAdmin, async (req, res) => {
  if (!config.agnoEnabled) return res.status(400).json({ error: "Agno integration disabled" });
  const catalogResponse = await callAgnoCatalog(config.agnoBaseUrl, getReq(req).correlationId);
  const catalog = catalogResponse.data;
  if (!catalog) return res.status(502).json({ error: catalogResponse.error || "Failed to fetch Agno catalog" });

  const teamByKey = new Map((await db.team.findMany()).map((team) => [team.key, team]));
  const skipped: string[] = [];
  let syncedTools = 0;
  let syncedSkills = 0;
  let syncedWorkflows = 0;

  for (const tool of catalog.tools) {
    const ownerTeam = tool.ownerTeamKey ? teamByKey.get(tool.ownerTeamKey) : null;
    const currentTool = await db.tool.findUnique({ where: { name: tool.name } });
    if (isUserCustomized(currentTool)) {
      skipped.push(formatCustomizationWarning("Tool", tool.name, currentTool?.customizationNote));
      continue;
    }
    await db.tool.upsert({
      where: { name: tool.name },
      update: {
        description: tool.description || null,
        callName: tool.callName || null,
        transport: tool.transport || "internal",
        endpoint: null,
        method: "POST",
        authRef: null,
        timeoutMs: 30000,
        type: tool.type as Prisma.ToolUncheckedCreateInput["type"],
        mode: (tool.mode || "real") as Prisma.ToolUncheckedCreateInput["mode"],
        policy: tool.policy as Prisma.ToolUncheckedCreateInput["policy"],
        riskLevel: "low",
        dataClassificationIn: "internal",
        dataClassificationOut: "internal",
        inputSchema: {},
        outputSchema: {},
        rateLimitPerMinute: 120,
        visibility: tool.visibility === "shared" ? "shared" : "private",
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
        type: tool.type as Prisma.ToolUncheckedCreateInput["type"],
        mode: (tool.mode || "real") as Prisma.ToolUncheckedCreateInput["mode"],
        policy: tool.policy as Prisma.ToolUncheckedCreateInput["policy"],
        riskLevel: "low",
        dataClassificationIn: "internal",
        dataClassificationOut: "internal",
        inputSchema: {},
        outputSchema: {},
        rateLimitPerMinute: 120,
        visibility: tool.visibility === "shared" ? "shared" : "private",
        managedBy: "agno",
        runtimeSource: tool.runtimeSource || "agno",
        teamId: ownerTeam?.id || null,
      },
    });
    syncedTools += 1;
  }

  for (const skill of catalog.skills) {
    const ownerTeam = skill.ownerTeamKey ? teamByKey.get(skill.ownerTeamKey) : null;
    const currentSkill = await db.skill.findFirst({
      where: { name: skill.name, ownerTeamId: ownerTeam?.id || null },
    });
    if (isUserCustomized(currentSkill)) {
      skipped.push(formatCustomizationWarning("Skill", skill.name, currentSkill?.customizationNote));
      continue;
    }
    if (currentSkill) {
      await db.skill.update({
        where: { id: currentSkill.id },
        data: {
          description: skill.description || "",
          prompt: skill.prompt,
          runbookUrl: skill.runbookUrl || null,
          category: skill.category as Prisma.SkillUncheckedCreateInput["category"],
          enabled: skill.enabled,
          visibility: skill.visibility === "shared" ? "shared" : "private",
          ownerTeamId: ownerTeam?.id || null,
          managedBy: "agno",
          runtimeSource: skill.runtimeSource || "agno",
        },
      });
      syncedSkills += 1;
      continue;
    }
    await db.skill.create({
      data: {
        description: skill.description || "",
        prompt: skill.prompt,
        runbookUrl: skill.runbookUrl || null,
        category: skill.category as Prisma.SkillUncheckedCreateInput["category"],
        enabled: skill.enabled,
        visibility: skill.visibility === "shared" ? "shared" : "private",
        ownerTeamId: ownerTeam?.id || null,
        managedBy: "agno",
        runtimeSource: skill.runtimeSource || "agno",
        name: skill.name,
      },
    });
    syncedSkills += 1;
  }

  for (const workflow of catalog.workflows || []) {
    const ownerTeam = workflow.ownerTeamKey ? teamByKey.get(workflow.ownerTeamKey) : null;
    const currentWorkflow = await workflowDb.workflow.findFirst({
      where: { name: workflow.name, ownerTeamId: ownerTeam?.id || null },
      include: { agentLinks: true },
    });
    if (isUserCustomized(currentWorkflow)) {
      skipped.push(formatCustomizationWarning("Workflow", workflow.name, currentWorkflow?.customizationNote));
      continue;
    }
    const participantAgentIds = workflow.linkedAgentNames?.length
      ? (await db.agent.findMany({ where: { name: { in: workflow.linkedAgentNames } }, select: { id: true } })).map((agent) => ({ agentId: agent.id }))
      : [];
    if (currentWorkflow) {
      await workflowDb.workflow.update({
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
          visibility: workflow.visibility === "shared" ? "shared" : "private",
          ownerTeamId: ownerTeam?.id || null,
          managedBy: "agno",
          runtimeSource: workflow.runtimeSource || "agno",
          agentLinks: {
            deleteMany: {},
            create: participantAgentIds,
          },
        },
      });
      syncedWorkflows += 1;
      continue;
    }
    await workflowDb.workflow.create({
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
        visibility: workflow.visibility === "shared" ? "shared" : "private",
        ownerTeamId: ownerTeam?.id || null,
        managedBy: "agno",
        runtimeSource: workflow.runtimeSource || "agno",
        agentLinks: participantAgentIds.length ? { create: participantAgentIds } : undefined,
      },
    });
    syncedWorkflows += 1;
  }

  const legacyWorkflowSkills = await db.skill.findMany({
    where: { managedBy: "agno", category: "workflow" },
    include: { agentLinks: true },
  });
  for (const legacy of legacyWorkflowSkills) {
    const existingWorkflow = await workflowDb.workflow.findFirst({
      where: { name: legacy.name, ownerTeamId: legacy.ownerTeamId || null },
    });
    if (!existingWorkflow) {
      await workflowDb.workflow.create({
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
          ownerTeamId: legacy.ownerTeamId || null,
          managedBy: legacy.managedBy,
          runtimeSource: legacy.runtimeSource,
          userCustomized: legacy.userCustomized,
          customizationNote: legacy.customizationNote,
          customizationUpdatedAt: legacy.customizationUpdatedAt,
          agentLinks: legacy.agentLinks.length ? { create: legacy.agentLinks.map((link) => ({ agentId: link.agentId })) } : undefined,
        },
      });
      syncedWorkflows += 1;
    }
    await db.agentSkill.deleteMany({ where: { skillId: legacy.id } });
    await db.skill.delete({ where: { id: legacy.id } });
  }

  res.json({
    ok: true,
    tools: syncedTools,
    skills: syncedSkills,
    workflows: syncedWorkflows,
    knowledgeSources: catalog.knowledgeSources.length,
    skipped,
  });
});

app.get("/api/agno/models", async (req, res) => {
  if (!config.agnoEnabled) return res.status(400).json({ error: "Agno integration disabled" });
  const modelsResponse = await callAgnoModels(config.agnoBaseUrl, getReq(req).correlationId);
  if (!modelsResponse.data) {
    return res.status(502).json({ error: modelsResponse.error || "Failed to fetch Agno models" });
  }
  res.json(modelsResponse.data);
});

app.get("/api/audit-logs", async (req, res) => {
  const user = getReq(req).user!;
  const logs = await db.auditLog.findMany({
    where: user.role === "TEAM_MAINTAINER" ? { actorTeam: user.teamId || "" } : {},
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ logs });
});

app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const r = getReq(req);
  if (error instanceof ZodError) {
    res.status(400).json({ error: "Validation error", details: error.issues, correlationId: r.correlationId });
    return;
  }
  logger.error({ err: error, correlationId: r.correlationId }, "unhandled_error");
  res.status(500).json({ error: "Internal error", correlationId: r.correlationId });
});

async function cleanupOldAudits() {
  const cutoff = new Date(Date.now() - config.auditRetentionDays * 24 * 60 * 60 * 1000);
  await db.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
}

app.listen(config.port, async () => {
  validateConfigForRuntime();
  await ensureSchema(db);
  await cleanupOldAudits();
  logger.info({ port: config.port }, "server_started");
});
