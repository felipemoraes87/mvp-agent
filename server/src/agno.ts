import { logger } from "./logger.js";

export type AgnoAdvancedOptions = {
  modelProvider?: "ollama" | "openrouter" | "openai" | "vertexai";
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  reasoning?: boolean;
  reasoningMinSteps?: number;
  reasoningMaxSteps?: number;
  addHistoryToContext?: boolean;
  historySessions?: number;
  addStateToContext?: boolean;
  markdown?: boolean;
  showToolCalls?: boolean;
};

type AgnoSimulateInput = {
  message: string;
  suggestedTeamId?: string;
  contextTags?: string[];
  teams: Array<{ id: string; key: string; name: string; description: string | null }>;
  agents: Array<{
    id: string;
    name: string;
    type: string;
    persona?: string | null;
    routingRole?: string | null;
    executionProfile?: string | null;
    capabilities?: unknown;
    domains?: unknown;
    description: string;
    prompt: string;
    tags: unknown;
    isGlobal: boolean;
    visibility: string;
    teamId: string | null;
  }>;
  handoffs: Array<{ fromAgentId: string; toAgentId: string }>;
  rules: Array<{ ownerTeamId: string | null; targetAgentId: string; fallbackAgentId: string | null; keywords: unknown; tags: unknown }>;
  advanced?: AgnoAdvancedOptions;
};

export type AgnoSimulateResult = {
  chosenTeam: { id: string; key: string; name: string } | null;
  chosenAgent: { id: string; name: string; type: string } | null;
  confidence: number;
  justification: string[];
  top3: Array<{ agentId: string; agentName: string; score: number; reason: string }>;
  graphPath: string[];
  usedSources: Array<{ id: string; name: string; url: string }>;
};

type AgnoChatInput = {
  message: string;
  agent: {
    id: string;
    name: string;
    type: string;
    persona?: string | null;
    routingRole?: string | null;
    executionProfile?: string | null;
    capabilities?: unknown;
    domains?: unknown;
    description: string;
    prompt: string;
    tags: unknown;
    teamKey?: string | null;
    runtimeConfig?: unknown;
    tools?: Array<{
      id: string;
      name: string;
      description?: string | null;
      callName?: string | null;
      policy: string;
      type: string;
      transport?: string | null;
      mode: string;
      canRead?: boolean;
      canWrite?: boolean;
      managedBy?: string | null;
      runtimeSource?: string | null;
    }>;
    knowledgeSources?: Array<{
      id: string;
      name: string;
      url: string;
      tags?: unknown;
      sourceType?: string | null;
    }>;
    skills?: Array<{
      id: string;
      name: string;
      description: string;
      prompt: string;
      category: string;
      enabled: boolean;
      runbookUrl?: string | null;
      managedBy?: string | null;
      runtimeSource?: string | null;
    }>;
  };
  advanced?: AgnoAdvancedOptions;
  history?: Array<{ role: "user" | "agent"; content: string }>;
};

export type AgnoCatalogItem = {
  id: string;
  name: string;
  description?: string | null;
  visibility?: string | null;
  ownerTeamKey?: string | null;
  managedBy?: string | null;
  runtimeSource?: string | null;
};

export type AgnoCatalogResult = {
  tools: Array<
    AgnoCatalogItem & {
      callName?: string | null;
      type: string;
      policy: string;
      transport?: string | null;
      mode?: string | null;
    }
  >;
  skills: Array<
    AgnoCatalogItem & {
      prompt: string;
      category: string;
      enabled: boolean;
      runbookUrl?: string | null;
      linkedAgentNames?: string[];
    }
  >;
  workflows: Array<
    AgnoCatalogItem & {
      objective: string;
      preconditions: string[];
      integrationKeys: string[];
      steps: string[];
      successCriteria: string[];
      outputFormat: string;
      failureHandling: string[];
      setupPoints: string[];
      enabled: boolean;
      linkedAgentNames?: string[];
    }
  >;
  knowledgeSources: Array<
    AgnoCatalogItem & {
      url: string;
      tags?: string[];
      sourceType?: string | null;
    }
  >;
};

export type AgnoModelsResult = {
  providers: Array<{
    id: "ollama" | "openrouter" | "vertexai";
    label: string;
    defaultModel: string;
    models: string[];
    source: "runtime" | "fallback";
  }>;
};

export type AgnoChatResult = {
  reply: string;
  reasoningSummary?: string[];
  meta?: Record<string, unknown>;
};

export type AgnoWorkflowSetupCheckResult = {
  integrations: Array<{
    key: string;
    label: string;
    configured: boolean;
    available: boolean;
    missingFields: string[];
  }>;
  summary: string;
};

export type AgnoCallResult<T> = {
  data: T | null;
  error: string | null;
  status?: number;
};

const AGNO_TIMEOUT_MS = Number(process.env.AGNO_TIMEOUT_MS || 90000);

async function postJson<T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  timeoutMs = AGNO_TIMEOUT_MS,
  correlationId?: string,
): Promise<AgnoCallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const error = `Agno POST ${path} failed with status ${res.status}`;
      logger.warn({ path, status: res.status }, "agno_http_error");
      return { data: null, error, status: res.status };
    }
    return { data: (await res.json()) as T, error: null, status: res.status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown transport error";
    logger.warn({ path, err: error }, "agno_transport_error");
    return { data: null, error: `Agno POST ${path} failed: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

async function getJson<T>(
  baseUrl: string,
  path: string,
  timeoutMs = AGNO_TIMEOUT_MS,
  correlationId?: string,
): Promise<AgnoCallResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const error = `Agno GET ${path} failed with status ${res.status}`;
      logger.warn({ path, status: res.status }, "agno_http_error");
      return { data: null, error, status: res.status };
    }
    return { data: (await res.json()) as T, error: null, status: res.status };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown transport error";
    logger.warn({ path, err: error }, "agno_transport_error");
    return { data: null, error: `Agno GET ${path} failed: ${detail}` };
  } finally {
    clearTimeout(timer);
  }
}

export async function callAgnoSimulate(
  baseUrl: string,
  payload: AgnoSimulateInput,
  correlationId?: string,
): Promise<AgnoCallResult<AgnoSimulateResult>> {
  return postJson<AgnoSimulateResult>(baseUrl, "/simulate", payload, AGNO_TIMEOUT_MS, correlationId);
}

export async function callAgnoChat(
  baseUrl: string,
  payload: AgnoChatInput,
  correlationId?: string,
): Promise<AgnoCallResult<AgnoChatResult>> {
  return postJson<AgnoChatResult>(baseUrl, "/chat", payload, AGNO_TIMEOUT_MS, correlationId);
}

export async function callAgnoCatalog(baseUrl: string, correlationId?: string): Promise<AgnoCallResult<AgnoCatalogResult>> {
  return getJson<AgnoCatalogResult>(baseUrl, "/catalog", AGNO_TIMEOUT_MS, correlationId);
}

export async function callAgnoModels(baseUrl: string, correlationId?: string): Promise<AgnoCallResult<AgnoModelsResult>> {
  return getJson<AgnoModelsResult>(baseUrl, "/models", AGNO_TIMEOUT_MS, correlationId);
}

export async function callAgnoWorkflowSetupCheck(
  baseUrl: string,
  payload: { integrationKeys: string[] },
  correlationId?: string,
): Promise<AgnoCallResult<AgnoWorkflowSetupCheckResult>> {
  return postJson<AgnoWorkflowSetupCheckResult>(baseUrl, "/workflow/setup-check", payload, AGNO_TIMEOUT_MS, correlationId);
}
