export type Role = "ADMIN" | "TEAM_MAINTAINER" | "OPERATOR";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  teamId: string | null;
};

export type Team = { id: string; key: string; name: string; description?: string | null };

export type Agent = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  primaryModel?: string | null;
  fallbackModels?: string | null;
  reasoningEnabled?: boolean;
  temperature?: number | null;
  maxTokens?: number | null;
  addHistoryContext?: boolean;
  historySessions?: number | null;
  addStateContext?: boolean;
  knowledgeMode?: "agentic" | "references" | "hybrid" | null;
  knowledgeMaxResults?: number | null;
  knowledgeAddReferences?: boolean;
  knowledgeContextFormat?: "json" | "yaml" | null;
  knowledgeFilters?: unknown;
  runtimeConfig?: unknown;
  tags: string[];
  type: "SUPERVISOR" | "SPECIALIST" | "TICKET";
  isGlobal: boolean;
  visibility: "private" | "shared";
  userCustomized?: boolean;
  customizationNote?: string | null;
  customizationUpdatedAt?: string | null;
  teamId: string | null;
};

export type AgentToolLink = {
  id: string;
  agentId: string;
  toolId: string;
  canRead: boolean;
  canWrite: boolean;
  tool: Tool;
};

export type Skill = {
  id: string;
  name: string;
  description: string;
  prompt: string;
  runbookUrl?: string | null;
  category: "operations" | "analysis" | "compliance" | "custom";
  enabled: boolean;
  visibility: "private" | "shared";
  ownerTeamId: string | null;
  managedBy: "portal" | "agno";
  runtimeSource?: string | null;
  userCustomized?: boolean;
  customizationNote?: string | null;
  customizationUpdatedAt?: string | null;
  linkedAgentIds?: string[];
};

export type AgentSkillLink = {
  id: string;
  agentId: string;
  skillId: string;
  skill: Skill;
};

export type AgentKnowledgeLink = {
  id: string;
  agentId: string;
  knowledgeSourceId: string;
  knowledgeSource: KnowledgeSource;
};

export type AgentWithLinks = Agent & {
  toolLinks?: AgentToolLink[];
  skillLinks?: AgentSkillLink[];
  knowledgeLinks?: AgentKnowledgeLink[];
};

export type Tool = {
  id: string;
  name: string;
  description?: string | null;
  callName?: string | null;
  transport?: string | null;
  endpoint?: string | null;
  method?: string | null;
  authRef?: string | null;
  timeoutMs?: number | null;
  type: "slack" | "confluence" | "jira" | "http" | "internal";
  mode: "mock" | "real";
  policy: "read" | "write";
  riskLevel: "low" | "med" | "high";
  dataClassificationIn: "public" | "internal" | "confidential" | "restricted";
  dataClassificationOut: "public" | "internal" | "confidential" | "restricted";
  inputSchema: unknown;
  outputSchema: unknown;
  rateLimitPerMinute: number;
  visibility: "private" | "shared";
  teamId: string | null;
  managedBy?: "portal" | "agno";
  runtimeSource?: string | null;
  userCustomized?: boolean;
  customizationNote?: string | null;
  customizationUpdatedAt?: string | null;
};

export type KnowledgeSource = {
  id: string;
  name: string;
  url: string;
  tags: string[];
  sourceType?: "url" | "pdf" | "docx" | "folder" | "api" | "slack" | "confluence" | "custom" | null;
  sourceConfig?: unknown;
  chunkSize?: number | null;
  chunkOverlap?: number | null;
  chunkStrategy?: "fixed" | "semantic" | "markdown" | "code" | null;
  embeddingProvider?: string | null;
  embeddingModel?: string | null;
  vectorStoreProvider?: string | null;
  vectorStoreIndex?: string | null;
  retrievalMode?: "agentic" | "references" | "hybrid" | null;
  searchType?: "vector" | "hybrid" | "keyword" | null;
  maxResults?: number | null;
  rerankerProvider?: string | null;
  rerankerModel?: string | null;
  metadataFilter?: unknown;
  contextFormat?: "json" | "yaml" | null;
  addContextInstructions?: boolean;
  addReferences?: boolean;
  syncStatus?: string | null;
  lastSyncedAt?: string | null;
  lastSyncError?: string | null;
  indexedDocuments?: number;
  visibility: "private" | "shared";
  ownerTeamId: string;
  userCustomized?: boolean;
  customizationNote?: string | null;
  customizationUpdatedAt?: string | null;
};

export type Handoff = {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  conditionExpr?: string | null;
  priority: number;
};

export type RoutingRule = {
  id: string;
  name: string;
  ownerTeamId: string | null;
  targetAgentId: string;
  fallbackAgentId: string | null;
  keywords: string[];
  tags: string[];
  minScore: number;
};

export type AgentChatMeta = {
  usedAgno?: boolean;
  degraded?: boolean;
  agnoError?: string | null;
  framework?: string;
  provider?: string;
  model?: string;
  agent?: string;
  correlationId?: string | null;
};

export type AccessUser = {
  id: string;
  email: string;
  role: Role;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  team?: { key: string; name: string } | null;
};

export type AccessGroupMember = {
  id: string;
  groupId: string;
  userId: string;
  createdAt: string;
  user: {
    id: string;
    email: string;
    role: Role;
    teamId: string | null;
  };
};

export type AccessGroup = {
  id: string;
  name: string;
  description: string | null;
  teamId: string | null;
  createdAt: string;
  updatedAt: string;
  team?: { id: string; key: string; name: string } | null;
  memberships: AccessGroupMember[];
  _count?: { memberships: number };
};
