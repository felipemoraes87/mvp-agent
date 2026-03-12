import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[^\s@]+@[^\s@]+$/, "Invalid email format"),
  password: z.string().min(8),
});

export const agentSchema = z.object({
  name: z.string().min(2),
  description: z.string().min(3),
  prompt: z.string().min(8),
  emoji: z.string().trim().min(1).max(16).optional().nullable(),
  avatarUrl: z
    .string()
    .trim()
    .max(200000)
    .refine((value) => /^https?:\/\/\S+$/i.test(value) || /^data:image\/[a-zA-Z]+;base64,/.test(value), "Must be a valid image URL or data URL")
    .optional()
    .nullable(),
  primaryModel: z.string().trim().min(1).max(120).optional().nullable(),
  fallbackModels: z.string().trim().max(400).optional().nullable(),
  reasoningEnabled: z.boolean().default(false),
  temperature: z.number().min(0).max(2).optional().nullable(),
  maxTokens: z.number().int().min(64).max(8192).optional().nullable(),
  addHistoryContext: z.boolean().default(false),
  historySessions: z.number().int().min(1).max(20).optional().nullable(),
  addStateContext: z.boolean().default(false),
  knowledgeMode: z.enum(["agentic", "references", "hybrid"]).optional().nullable(),
  knowledgeMaxResults: z.number().int().min(1).max(50).optional().nullable(),
  knowledgeAddReferences: z.boolean().default(true),
  knowledgeContextFormat: z.enum(["json", "yaml"]).optional().nullable(),
  knowledgeFilters: z.any().optional().nullable(),
  tags: z.array(z.string()).default([]),
  type: z.enum(["SUPERVISOR", "SPECIALIST", "TICKET"]),
  isGlobal: z.boolean().default(false),
  visibility: z.enum(["private", "shared"]).default("private"),
  teamId: z.string().nullable().optional(),
});

export const toolSchema = z.object({
  name: z.string().min(2),
  description: z.string().max(500).optional().nullable(),
  callName: z.string().min(2).max(120).optional().nullable(),
  transport: z.string().min(2).max(60).optional().nullable(),
  endpoint: z.string().max(600).optional().nullable(),
  method: z.string().max(16).optional().nullable(),
  authRef: z.string().max(120).optional().nullable(),
  timeoutMs: z.int().min(250).max(120000).optional().nullable(),
  type: z.enum(["slack", "confluence", "jira", "http", "internal"]),
  mode: z.enum(["mock", "real"]),
  policy: z.enum(["read", "write"]),
  riskLevel: z.enum(["low", "med", "high"]),
  dataClassificationIn: z.enum(["public", "internal", "confidential", "restricted"]),
  dataClassificationOut: z.enum(["public", "internal", "confidential", "restricted"]),
  inputSchema: z.any(),
  outputSchema: z.any(),
  rateLimitPerMinute: z.int().min(1).max(5000).default(60),
  visibility: z.enum(["private", "shared"]).default("private"),
  teamId: z.string().nullable().optional(),
});

export const knowledgeSchema = z.object({
  name: z.string().min(2),
  url: z.url(),
  tags: z.array(z.string()).default([]),
  sourceType: z.enum(["url", "pdf", "docx", "folder", "api", "slack", "confluence", "custom"]).optional().nullable(),
  sourceConfig: z.any().optional().nullable(),
  chunkSize: z.number().int().min(100).max(8000).optional().nullable(),
  chunkOverlap: z.number().int().min(0).max(2000).optional().nullable(),
  chunkStrategy: z.enum(["fixed", "semantic", "markdown", "code"]).optional().nullable(),
  embeddingProvider: z.string().max(80).optional().nullable(),
  embeddingModel: z.string().max(120).optional().nullable(),
  vectorStoreProvider: z.string().max(80).optional().nullable(),
  vectorStoreIndex: z.string().max(160).optional().nullable(),
  retrievalMode: z.enum(["agentic", "references", "hybrid"]).optional().nullable(),
  searchType: z.enum(["vector", "hybrid", "keyword"]).optional().nullable(),
  maxResults: z.number().int().min(1).max(50).optional().nullable(),
  rerankerProvider: z.string().max(80).optional().nullable(),
  rerankerModel: z.string().max(120).optional().nullable(),
  metadataFilter: z.any().optional().nullable(),
  contextFormat: z.enum(["json", "yaml"]).optional().nullable(),
  addContextInstructions: z.boolean().default(false),
  addReferences: z.boolean().default(true),
  visibility: z.enum(["private", "shared"]).default("private"),
  ownerTeamId: z.string(),
});

export const handoffSchema = z.object({
  fromAgentId: z.string(),
  toAgentId: z.string(),
  conditionExpr: z.string().max(300).optional().nullable(),
  priority: z.int().min(1).max(100).default(50),
});

export const routingRuleSchema = z.object({
  name: z.string().min(2),
  ownerTeamId: z.string().nullable().optional(),
  targetAgentId: z.string(),
  fallbackAgentId: z.string().nullable().optional(),
  keywords: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  minScore: z.number().min(0).max(1).default(0.2),
});

export const simulatorSchema = z.object({
  message: z.string().min(4).max(4000),
  suggestedTeamId: z.string().optional(),
  forcedAgentId: z.string().optional(),
  contextTags: z.array(z.string()).default([]),
  advanced: z
    .object({
      modelProvider: z.enum(["ollama", "openai"]).optional(),
      modelId: z.string().min(1).max(120).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(64).max(8192).optional(),
      reasoning: z.boolean().optional(),
      reasoningMinSteps: z.number().int().min(1).max(20).optional(),
      reasoningMaxSteps: z.number().int().min(1).max(40).optional(),
      addHistoryToContext: z.boolean().optional(),
      historySessions: z.number().int().min(1).max(20).optional(),
      addStateToContext: z.boolean().optional(),
      markdown: z.boolean().optional(),
      showToolCalls: z.boolean().optional(),
    })
    .optional(),
});

export const agnoChatSchema = z.object({
  message: z.string().min(2).max(4000),
  agentId: z.string().min(1),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "agent"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .default([]),
  advanced: z
    .object({
      modelProvider: z.enum(["ollama", "openai"]).optional(),
      modelId: z.string().min(1).max(120).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(64).max(8192).optional(),
      reasoning: z.boolean().optional(),
      reasoningMinSteps: z.number().int().min(1).max(20).optional(),
      reasoningMaxSteps: z.number().int().min(1).max(40).optional(),
      addHistoryToContext: z.boolean().optional(),
      historySessions: z.number().int().min(1).max(20).optional(),
      addStateToContext: z.boolean().optional(),
      markdown: z.boolean().optional(),
      showToolCalls: z.boolean().optional(),
    })
    .optional(),
});

export const assignToolSchema = z.object({
  toolId: z.string(),
  canRead: z.boolean().default(true),
  canWrite: z.boolean().default(false),
  justification: z.string().optional(),
});

export const assignKnowledgeSchema = z.object({
  knowledgeSourceId: z.string(),
});

export const configImportSchema = z.object({
  format: z.enum(["json", "yaml"]).default("json"),
  payload: z.string().min(2),
});

export const accessUserCreateSchema = z.object({
  email: z
    .string()
    .trim()
    .min(3)
    .max(120)
    .regex(/^[^\s@]+@[^\s@]+$/, "Invalid email format"),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "TEAM_MAINTAINER", "OPERATOR"]),
  teamId: z.string().nullable().optional(),
});

export const accessUserUpdateSchema = z.object({
  role: z.enum(["ADMIN", "TEAM_MAINTAINER", "OPERATOR"]).optional(),
  teamId: z.string().nullable().optional(),
});

export const accessPasswordResetSchema = z.object({
  newPassword: z.string().min(8),
});

export const accessGroupSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().max(300).optional().nullable(),
  teamId: z.string().nullable().optional(),
});

export const accessGroupMembershipSchema = z.object({
  userId: z.string(),
});
