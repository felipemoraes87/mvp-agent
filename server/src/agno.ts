export type AgnoAdvancedOptions = {
  modelProvider?: "ollama" | "openai";
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
  agents: Array<{ id: string; name: string; type: string; description: string; prompt: string; tags: unknown; isGlobal: boolean; visibility: string; teamId: string | null }>;
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
  agent: { id: string; name: string; type: string; description: string; prompt: string; tags: unknown; teamKey?: string | null };
  advanced?: AgnoAdvancedOptions;
  history?: Array<{ role: "user" | "agent"; content: string }>;
};

export type AgnoChatResult = {
  reply: string;
  reasoningSummary?: string[];
  meta?: Record<string, unknown>;
};

const AGNO_TIMEOUT_MS = Number(process.env.AGNO_TIMEOUT_MS || 90000);

async function postJson<T>(baseUrl: string, path: string, payload: unknown, timeoutMs = AGNO_TIMEOUT_MS): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function callAgnoSimulate(baseUrl: string, payload: AgnoSimulateInput): Promise<AgnoSimulateResult | null> {
  return postJson<AgnoSimulateResult>(baseUrl, "/simulate", payload);
}

export async function callAgnoChat(baseUrl: string, payload: AgnoChatInput): Promise<AgnoChatResult | null> {
  return postJson<AgnoChatResult>(baseUrl, "/chat", payload);
}
