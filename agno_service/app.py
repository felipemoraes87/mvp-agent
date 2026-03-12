from __future__ import annotations

import inspect
import json
import os
import re
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from agno.agent import Agent
from agno.models.ollama import Ollama
from agno.models.openai import OpenAIChat
from jumpcloud_tool import JumpCloudToolError, build_jumpcloud_tool_from_env


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
    description: str
    prompt: str
    tags: Any = None
    teamKey: str | None = None


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


def fallback_reasoning_summary(agent_type: str, message: str) -> list[str]:
    tokens = normalize_tokens(message)
    key_terms = ", ".join(tokens[:4]) if tokens else "sem palavras-chave fortes"
    if agent_type == "SUPERVISOR":
        return [
            "Classificacao inicial da demanda por contexto e risco.",
            f"Sinais principais: {key_terms}.",
            "Definicao do melhor especialista para encaminhamento.",
        ]
    if agent_type == "TICKET":
        return [
            "Validacao de pre-condicoes para acao de escrita.",
            f"Dados relevantes identificados: {key_terms}.",
            "Preparacao de ticket com justificativa e impacto.",
        ]
    return [
        "Analise tecnica do dominio do agente.",
        f"Termos centrais considerados: {key_terms}.",
        "Proposta de proximos passos e possivel escalonamento.",
    ]


def fallback_chat_reply(agent_type: str, message: str) -> str:
    if agent_type == "SUPERVISOR":
        return (
            "Posso te ajudar com isso. Para confirmar se entendi corretamente, "
            "voce poderia detalhar objetivo, impacto e urgencia?"
        )
    if agent_type == "TICKET":
        return (
            "Posso seguir com orientacao de chamado, mas preciso validar dados obrigatorios "
            "(justificativa, impacto, evidencias e sistema afetado)."
        )
    return (
        "Posso te orientar tecnicamente, mas faltou contexto suficiente nesta tentativa. "
        "Pode compartilhar mais detalhes do ambiente, erro e impacto?"
    )


def behavior_instructions(agent_type: str) -> list[str]:
    if agent_type == "SUPERVISOR":
        return [
            "You are the single point of contact for end users (global supervisor).",
            "Use a kind, collaborative and simple tone. Avoid excessive formality.",
            "When confidence is low or context is incomplete, ask 1-3 clarifying questions and explicitly confirm understanding before routing.",
            "If routing is needed, explain why and mention the responsible team clearly (example: @IAM/IGA).",
            "Do not claim ticket creation was completed unless confirmed by process and required data.",
        ]
    if agent_type == "SPECIALIST":
        return [
            "Your objective is to help the end user with practical and domain-specific guidance.",
            "If required information is missing, ask focused questions that the supervisor can relay to the user.",
            "When possible, provide a direct explanation and actionable next steps in plain language.",
            "When escalation is needed, indicate the team mention in the conversation (example: @CloudSec).",
            "If the case is documented for ticketing, follow documentation guidance, but request missing required fields before proceeding.",
            "If JumpCloud data/actions are required, use available JumpCloud tools for factual checks before answering.",
        ]
    if agent_type == "TICKET":
        return [
            "You are responsible for documented ticket preparation and write-action workflow.",
            "Before proposing ticket creation, verify mandatory details and ask for missing information.",
            "If information is incomplete, clearly list what is missing and do not claim the ticket was opened.",
        ]
    return []


def normalize_tokens(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", text.lower(), flags=re.UNICODE)
    return [t for t in clean.split() if len(t) > 2]


def to_text(run_output: Any) -> str:
    if run_output is None:
        return ""
    content = getattr(run_output, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(run_output, str):
        return run_output
    return str(content or run_output)


def parse_json_block(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        text = re.sub(r"```$", "", text).strip()
    try:
        return json.loads(text)
    except Exception:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end < 0 or end <= start:
            return {}
        try:
            return json.loads(text[start : end + 1])
        except Exception:
            return {}


def extract_reply_from_text(text: str) -> str:
    clean = text.strip()
    if not clean:
        return ""

    # Accept simple "reply: ..." format when model misses strict JSON.
    for line in clean.splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("reply:"):
            _, _, value = stripped.partition(":")
            candidate = value.strip()
            if candidate:
                return candidate

    parsed = parse_json_block(clean)
    reply = parsed.get("reply") if isinstance(parsed, dict) else None
    if isinstance(reply, str):
        return reply.strip()

    return ""


def resolve_provider(advanced: AdvancedOptions | None) -> str:
    provider = ((advanced.modelProvider if advanced and advanced.modelProvider else None) or os.getenv("AGNO_MODEL_PROVIDER", "ollama")).strip().lower()
    return provider if provider in {"ollama", "openai"} else "ollama"


def resolve_model_id(provider: str, advanced: AdvancedOptions | None) -> str:
    if advanced and advanced.modelId:
        return advanced.modelId
    if provider == "openai":
        return os.getenv("AGNO_OPENAI_MODEL", "gpt-4o-mini")
    return os.getenv("AGNO_OLLAMA_MODEL", "qwen2.5:3b")


def make_model(advanced: AdvancedOptions | None) -> Any:
    provider = resolve_provider(advanced)
    model_id = resolve_model_id(provider, advanced)

    if provider == "openai":
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key:
            raise RuntimeError("OPENAI_API_KEY is required when modelProvider=openai")

        raw_kwargs: dict[str, Any] = {
            "id": model_id,
            "api_key": openai_key,
            "base_url": os.getenv("OPENAI_BASE_URL") or None,
            "organization": os.getenv("OPENAI_ORG") or None,
            "temperature": float(advanced.temperature) if advanced and advanced.temperature is not None else None,
            "max_tokens": int(advanced.maxTokens) if advanced and advanced.maxTokens is not None else None,
        }
        supported = set(inspect.signature(OpenAIChat.__init__).parameters.keys())
        kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
        return OpenAIChat(**kwargs)

    ollama_host = os.getenv("AGNO_OLLAMA_HOST") or os.getenv("OLLAMA_HOST")
    options: dict[str, Any] = {}
    if advanced and advanced.temperature is not None:
        options["temperature"] = float(advanced.temperature)
    if advanced and advanced.maxTokens is not None:
        options["num_predict"] = int(advanced.maxTokens)

    raw_kwargs = {
        "id": model_id,
        "host": ollama_host,
        "options": options or None,
    }
    supported = set(inspect.signature(Ollama.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
    return Ollama(**kwargs)


def make_agent(name: str, instructions: list[str], advanced: AdvancedOptions | None) -> Agent:
    jumpcloud_tools = JUMPCLOUD_TOOL.agno_tools() if JUMPCLOUD_TOOL else []
    raw_kwargs = {
        "name": name,
        "model": make_model(advanced),
        "instructions": instructions,
        "tools": jumpcloud_tools,
        "markdown": bool(advanced.markdown) if advanced else True,
        "show_tool_calls": bool(advanced.showToolCalls) if advanced else False,
        "add_history_to_context": bool(advanced.addHistoryToContext) if advanced else True,
        "num_history_sessions": int(advanced.historySessions) if advanced and advanced.historySessions else 3,
        "add_session_state_to_context": bool(advanced.addStateToContext) if advanced else True,
        "reasoning": bool(advanced.reasoning) if advanced else True,
        "reasoning_min_steps": int(advanced.reasoningMinSteps) if advanced and advanced.reasoningMinSteps else 1,
        "reasoning_max_steps": int(advanced.reasoningMaxSteps) if advanced and advanced.reasoningMaxSteps else 6,
    }

    supported = set(inspect.signature(Agent.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported}
    return Agent(**kwargs)


app = FastAPI(title="MVP Agno Service", version="1.0.0")
JUMPCLOUD_TOOL = build_jumpcloud_tool_from_env()


@app.get("/health")
def health() -> dict[str, Any]:
    provider = resolve_provider(None)
    return {
        "ok": True,
        "service": "agno-service",
        "provider": provider,
        "model": resolve_model_id(provider, None),
        "providers": ["ollama", "openai"],
        "jumpcloudToolEnabled": bool(JUMPCLOUD_TOOL),
        "jumpcloudWriteEnabled": bool(JUMPCLOUD_TOOL.write_enabled) if JUMPCLOUD_TOOL else False,
    }


@app.post("/jumpcloud/execute")
def jumpcloud_execute(req: JumpCloudExecuteRequest) -> dict[str, Any]:
    if not JUMPCLOUD_TOOL:
        raise HTTPException(status_code=503, detail="JumpCloud tool is disabled or not configured.")

    try:
        if req.operation:
            if req.operation == "list_operations":
                return JUMPCLOUD_TOOL.jumpcloud_list_operations()
            return JUMPCLOUD_TOOL.jumpcloud_execute(
                operation=req.operation,
                params_json=json.dumps(req.params),
                query_json=json.dumps(req.query),
                body_json=json.dumps(req.body),
                allow_write=req.allowWrite,
            )

        if req.apiFamily and req.method and req.path:
            return JUMPCLOUD_TOOL.jumpcloud_raw_request(
                api_family=req.apiFamily,
                method=req.method,
                path=req.path,
                query_json=json.dumps(req.query),
                body_json=json.dumps(req.body),
                allow_write=req.allowWrite,
            )

        raise HTTPException(
            status_code=400,
            detail="Provide either operation OR (apiFamily + method + path).",
        )
    except JumpCloudToolError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/simulate")
def simulate(req: SimulateRequest) -> dict[str, Any]:
    teams = req.teams
    specialists = [a for a in req.agents if a.type == "SPECIALIST"]
    team_map = {t.id: t for t in teams}

    team_catalog = "\n".join([f"- {t.key}: {t.name} ({t.description or 'no description'})" for t in teams])

    router = make_agent(
        name="Global Supervisor",
        instructions=[
            "You are a routing supervisor for security teams.",
            "Choose the best team by key and return strict JSON with fields: team_key, confidence, justification.",
            "Confidence must be a float between 0 and 1.",
            "Do not return markdown outside JSON.",
        ],
        advanced=req.advanced,
    )

    router_prompt = (
        "Message:\n"
        f"{req.message}\n\n"
        "Context tags: "
        f"{', '.join(req.contextTags) if req.contextTags else 'none'}\n"
        f"Suggested team id: {req.suggestedTeamId or 'none'}\n\n"
        "Available teams:\n"
        f"{team_catalog}\n"
    )

    router_out = to_text(router.run(router_prompt))
    decision = parse_json_block(router_out)

    chosen_team = None
    requested_key = str(decision.get("team_key", "")).strip().upper()
    if requested_key:
        chosen_team = next((t for t in teams if t.key.upper() == requested_key), None)

    if not chosen_team:
        # fallback by simple overlap
        msg_tokens = set(normalize_tokens(req.message))
        ranked = []
        for team in teams:
            score = len(msg_tokens.intersection(set(normalize_tokens(f"{team.key} {team.name} {team.description or ''}"))))
            ranked.append((score, team))
        ranked.sort(key=lambda x: x[0], reverse=True)
        chosen_team = ranked[0][1] if ranked else None

    team_specialists = [a for a in specialists if chosen_team and a.teamId == chosen_team.id]
    chosen_specialist = team_specialists[0] if team_specialists else (specialists[0] if specialists else None)

    specialist_reply = ""
    if chosen_specialist:
        specialist_agent = make_agent(
            name=chosen_specialist.name,
            instructions=[
                "You are a domain specialist security agent.",
                chosen_specialist.prompt,
                "Respond with concise technical analysis and recommended next actions.",
            ],
            advanced=req.advanced,
        )
        specialist_reply = to_text(specialist_agent.run(req.message))

    ranked_items = []
    for agent in [a for a in req.agents if (chosen_team and (a.teamId == chosen_team.id or a.isGlobal))]:
        score = 0.0
        txt = f"{agent.name} {agent.description} {agent.prompt} {' '.join(agent.tags or [])}"
        score += len(set(normalize_tokens(req.message)).intersection(set(normalize_tokens(txt))))
        if agent.id == (chosen_specialist.id if chosen_specialist else None):
            score += 2
        ranked_items.append({"agent": agent, "score": float(score)})
    ranked_items.sort(key=lambda x: x["score"], reverse=True)

    confidence = decision.get("confidence") if isinstance(decision.get("confidence"), (int, float)) else None
    if confidence is None:
        confidence = 0.55 if chosen_specialist else 0.25

    path = []
    supervisor = next((a for a in req.agents if a.type == "SUPERVISOR"), None)
    ticket = next((a for a in req.agents if a.type == "TICKET"), None)
    if supervisor:
        path.append(supervisor.name)
    if chosen_specialist:
        path.append(chosen_specialist.name)
    if ticket:
        path.append(ticket.name)

    return {
        "chosenTeam": {"id": chosen_team.id, "key": chosen_team.key, "name": chosen_team.name} if chosen_team else None,
        "chosenAgent": {
            "id": chosen_specialist.id,
            "name": chosen_specialist.name,
            "type": chosen_specialist.type,
        }
        if chosen_specialist
        else None,
        "confidence": max(0.15, min(0.99, float(confidence))),
        "justification": [
            f"agno_router: {decision.get('justification', 'router analyzed the message')}",
            f"specialist_analysis: {specialist_reply[:280] if specialist_reply else 'no specialist output'}",
        ],
        "top3": [
            {
                "agentId": row["agent"].id,
                "agentName": row["agent"].name,
                "score": row["score"],
                "reason": "agno ranking",
            }
            for row in ranked_items[:3]
        ],
        "graphPath": path,
        "usedSources": [],
    }


@app.post("/chat")
def chat(req: ChatRequest) -> dict[str, Any]:
    history_text = "\n".join([f"{m.role}: {m.content}" for m in req.history[-12:]])
    agent = make_agent(
        name=req.agent.name,
        instructions=[
            "You are a security agent in an IGA security orchestration system.",
            f"Agent type: {req.agent.type}",
            f"Agent description: {req.agent.description}",
            f"Agent prompt: {req.agent.prompt}",
            f"Team key: {req.agent.teamKey or 'GLOBAL'}",
            *behavior_instructions(req.agent.type),
            "Be concise, practical and policy-aware. Never claim actions were executed if they were not.",
            "Return strict JSON only with fields: reply (string) and reasoning_summary (array of 2-4 short strings).",
            "reasoning_summary must be high-level and concise, never hidden chain-of-thought.",
        ],
        advanced=req.advanced,
    )

    prompt = (
        "Conversation history:\n"
        f"{history_text or 'none'}\n\n"
        "User message:\n"
        f"{req.message}"
    )
    out = ""
    for _ in range(2):
        out = to_text(agent.run(prompt)).strip()
        if out:
            break
        # Retry once with explicit instruction when model returns empty text.
        prompt = f"{prompt}\n\nReturn a direct and concise answer now."

    parsed = parse_json_block(out)
    parsed_reply = parsed.get("reply")
    reply = str(parsed_reply).strip() if parsed_reply is not None else ""
    if not reply:
        reply = extract_reply_from_text(out) or out
    if not reply:
        reply = fallback_chat_reply(req.agent.type, req.message)
    raw_summary = parsed.get("reasoning_summary")
    reasoning_summary = [str(x) for x in raw_summary] if isinstance(raw_summary, list) else fallback_reasoning_summary(req.agent.type, req.message)
    return {
        "reply": reply,
        "reasoningSummary": reasoning_summary[:4],
        "meta": {
            "framework": "agno",
            "provider": resolve_provider(req.advanced),
            "model": resolve_model_id(resolve_provider(req.advanced), req.advanced),
            "agent": req.agent.name,
        },
    }
