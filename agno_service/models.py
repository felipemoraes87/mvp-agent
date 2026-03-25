from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class AdvancedOptions(BaseModel):
    modelProvider: str | None = None
    modelId: str | None = None
    temperature: float | None = 0.2
    maxTokens: int | None = 1024
    reasoning: bool | None = True
    reasoningMinSteps: int | None = 1
    reasoningMaxSteps: int | None = 6
    addHistoryToContext: bool | None = True
    historySessions: int | None = 3
    addStateToContext: bool | None = True
    markdown: bool | None = True
    showToolCalls: bool | None = False


class TeamItem(BaseModel):
    id: str
    key: str
    name: str
    description: str | None = None


class AgentItem(BaseModel):
    id: str
    name: str
    type: str
    persona: str | None = None
    routingRole: str | None = None
    executionProfile: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    description: str
    prompt: str
    tags: Any = None
    isGlobal: bool
    teamId: str | None = None


class HandoffItem(BaseModel):
    fromAgentId: str
    toAgentId: str


class RuleItem(BaseModel):
    ownerTeamId: str | None = None
    targetAgentId: str
    fallbackAgentId: str | None = None
    keywords: Any = None
    tags: Any = None


class SimulateRequest(BaseModel):
    message: str
    suggestedTeamId: str | None = None
    contextTags: list[str] = Field(default_factory=list)
    teams: list[TeamItem]
    agents: list[AgentItem]
    handoffs: list[HandoffItem]
    rules: list[RuleItem]
    advanced: AdvancedOptions | None = None


class ChatAgent(BaseModel):
    id: str
    name: str
    type: str
    persona: str | None = None
    routingRole: str | None = None
    executionProfile: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    description: str
    prompt: str
    tags: Any = None
    teamKey: str | None = None
    runtimeConfig: Any = None
    tools: list[dict[str, Any]] = Field(default_factory=list)
    knowledgeSources: list[dict[str, Any]] = Field(default_factory=list)
    skills: list[dict[str, Any]] = Field(default_factory=list)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    agent: ChatAgent
    history: list[ChatMessage] = Field(default_factory=list)
    advanced: AdvancedOptions | None = None


class JumpCloudExecuteRequest(BaseModel):
    operation: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    query: dict[str, Any] = Field(default_factory=dict)
    body: dict[str, Any] = Field(default_factory=dict)
    apiFamily: str | None = None
    method: str | None = None
    path: str | None = None
    allowWrite: bool = False


class WorkflowSetupCheckRequest(BaseModel):
    integrationKeys: list[str] = Field(default_factory=list)
