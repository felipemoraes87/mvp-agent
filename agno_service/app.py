from __future__ import annotations

import inspect
import json
import logging
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from agno.agent import Agent
from agno.models.ollama import Ollama
from agno.models.openai import OpenAIChat
from falcon_mcp_tool import (
    agent_should_use_falcon_mcp,
    build_falcon_mcp_config_from_env,
    build_falcon_mcp_tools,
    build_falcon_response_instructions,
    resolve_allowed_falcon_tool_names,
    serialize_falcon_tool_result,
)
from iam_team import handle_iam_team_request, maybe_build_integration_setup_prompt, maybe_build_unavailable_integration_prompt
from iam_team.change_guard import evaluate_change_safety
from iam_team.coordinator import build_iam_team_catalog
from iam_team.integration_registry import IntegrationConfigRegistry
from jumpcloud_tool import JumpCloudToolError, build_jumpcloud_tool_from_env
from secret_env import read_env_value


logging.basicConfig(level=read_env_value("LOG_LEVEL", default="INFO").upper())
logger = logging.getLogger("agno_service")
APP_DIR = Path(__file__).resolve().parent
JUMPCLOUD_TOOL_FEATURE_ENABLED = (read_env_value("JUMPCLOUD_TOOL_ENABLED", default="false") or "false").strip().lower() == "true"


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


def fallback_reasoning_summary(agent_type: str, message: str) -> list[str]:
    return fallback_reasoning_summary_for_profile(agent_type=agent_type, persona=None, routing_role=None, execution_profile=None, message=message)


def normalize_agent_persona(agent_type: str, persona: str | None) -> str:
    normalized = str(persona or "").strip().upper()
    if normalized in {"SUPERVISOR", "SPECIALIST", "ANALYST", "EXECUTOR"}:
        return normalized
    if agent_type == "SUPERVISOR":
        return "SUPERVISOR"
    if agent_type == "TICKET":
        return "EXECUTOR"
    return "SPECIALIST"


def normalize_routing_role(agent_type: str, routing_role: str | None) -> str:
    normalized = str(routing_role or "").strip().upper()
    if normalized in {"ENTRYPOINT", "DISPATCHER", "SPECIALIST", "TERMINAL", "FALLBACK"}:
        return normalized
    if agent_type == "SUPERVISOR":
        return "ENTRYPOINT"
    if agent_type == "TICKET":
        return "TERMINAL"
    return "SPECIALIST"


def normalize_execution_profile(agent_type: str, execution_profile: str | None) -> str:
    normalized = str(execution_profile or "").strip().upper()
    if normalized in {"READ_ONLY", "WRITE_GUARDED", "WRITE_ALLOWED", "APPROVAL_REQUIRED"}:
        return normalized
    if agent_type == "TICKET":
        return "WRITE_GUARDED"
    return "READ_ONLY"


def normalize_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [str(item).strip().lower() for item in values if str(item).strip()]


def normalize_agent_capabilities(
    agent_type: str,
    persona: str | None,
    routing_role: str | None,
    execution_profile: str | None,
    capabilities: Any,
    domains: Any,
) -> list[str]:
    explicit = normalize_str_list(capabilities)
    if explicit:
        return explicit

    inferred: set[str] = set()
    resolved_persona = normalize_agent_persona(agent_type, persona)
    resolved_role = normalize_routing_role(agent_type, routing_role)
    resolved_execution = normalize_execution_profile(agent_type, execution_profile)
    resolved_domains = normalize_str_list(domains)
    if resolved_role in {"ENTRYPOINT", "DISPATCHER"}:
        inferred.add("can_route")
    if resolved_role != "TERMINAL":
        inferred.add("can_handoff")
    if resolved_persona in {"SUPERVISOR", "SPECIALIST", "ANALYST"}:
        inferred.add("can_query_knowledge")
    if resolved_execution != "READ_ONLY":
        inferred.add("can_call_write_tools")
    if resolved_execution in {"WRITE_GUARDED", "WRITE_ALLOWED"}:
        inferred.add("can_open_ticket")
    if "falcon" in resolved_domains or "crowdstrike" in resolved_domains:
        inferred.add("can_use_falcon_mcp")
    if "jumpcloud" in resolved_domains:
        inferred.add("can_use_jumpcloud")
    return sorted(inferred)


def fallback_reasoning_summary_for_profile(
    *,
    agent_type: str,
    persona: str | None,
    routing_role: str | None,
    execution_profile: str | None,
    message: str,
) -> list[str]:
    tokens = normalize_tokens(message)
    key_terms = ", ".join(tokens[:4]) if tokens else "sem palavras-chave fortes"
    resolved_persona = normalize_agent_persona(agent_type, persona)
    resolved_role = normalize_routing_role(agent_type, routing_role)
    resolved_execution = normalize_execution_profile(agent_type, execution_profile)
    if resolved_persona == "SUPERVISOR" or resolved_role == "ENTRYPOINT":
        return [
            "Classificacao inicial da demanda por contexto e risco.",
            f"Sinais principais: {key_terms}.",
            "Definicao do melhor especialista para encaminhamento.",
        ]
    if resolved_role == "TERMINAL" or resolved_execution != "READ_ONLY":
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
    return fallback_chat_reply_for_profile(agent_type=agent_type, persona=None, routing_role=None, execution_profile=None, message=message)


def fallback_chat_reply_for_profile(
    *,
    agent_type: str,
    persona: str | None,
    routing_role: str | None,
    execution_profile: str | None,
    message: str,
) -> str:
    resolved_persona = normalize_agent_persona(agent_type, persona)
    resolved_role = normalize_routing_role(agent_type, routing_role)
    resolved_execution = normalize_execution_profile(agent_type, execution_profile)
    if resolved_persona == "SUPERVISOR" or resolved_role == "ENTRYPOINT":
        return (
            "Posso te ajudar com isso. Para confirmar se entendi corretamente, "
            "voce poderia detalhar objetivo, impacto e urgencia?"
        )
    if resolved_role == "TERMINAL" or resolved_execution != "READ_ONLY":
        return (
            "Posso seguir com orientacao de chamado, mas preciso validar dados obrigatorios "
            "(justificativa, impacto, evidencias e sistema afetado)."
        )
    return (
        "Posso te orientar tecnicamente, mas faltou contexto suficiente nesta tentativa. "
        "Pode compartilhar mais detalhes do ambiente, erro e impacto?"
    )


def behavior_instructions(agent_type: str) -> list[str]:
    return behavior_instructions_for_profile(agent_type=agent_type, persona=None, routing_role=None, execution_profile=None)


def behavior_instructions_for_profile(
    *,
    agent_type: str,
    persona: str | None,
    routing_role: str | None,
    execution_profile: str | None,
) -> list[str]:
    resolved_persona = normalize_agent_persona(agent_type, persona)
    resolved_role = normalize_routing_role(agent_type, routing_role)
    resolved_execution = normalize_execution_profile(agent_type, execution_profile)
    if resolved_persona == "SUPERVISOR" or resolved_role == "ENTRYPOINT":
        return [
            "You are the single point of contact for end users (global supervisor).",
            "Use a kind, collaborative and simple tone. Avoid excessive formality.",
            "When confidence is low or context is incomplete, ask 1-3 clarifying questions and explicitly confirm understanding before routing.",
            "If routing is needed, explain why and mention the responsible team clearly (example: @IAM/IGA).",
            "Do not claim ticket creation was completed unless confirmed by process and required data.",
        ]
    if resolved_persona in {"SPECIALIST", "ANALYST"} or resolved_role == "SPECIALIST":
        return [
            "Your objective is to help the end user with practical and domain-specific guidance.",
            "If required information is missing, ask focused questions that the supervisor can relay to the user.",
            "When possible, provide a direct explanation and actionable next steps in plain language.",
            "When escalation is needed, indicate the team mention in the conversation (example: @CloudSec).",
            "If the case is documented for ticketing, follow documentation guidance, but request missing required fields before proceeding.",
            "If JumpCloud data/actions are required, use available JumpCloud tools for factual checks before answering.",
        ]
    if resolved_role == "TERMINAL" or resolved_execution != "READ_ONLY":
        return [
            "You are responsible for documented ticket preparation and write-action workflow.",
            "Before proposing ticket creation, verify mandatory details and ask for missing information.",
            "If information is incomplete, clearly list what is missing and do not claim the ticket was opened.",
        ]
    return []


def normalize_tokens(text: str) -> list[str]:
    clean = re.sub(r"[^\w\s]", " ", text.lower(), flags=re.UNICODE)
    return [t for t in clean.split() if len(t) > 2]


def normalize_tag_values(tags: Any) -> list[str]:
    if not isinstance(tags, list):
        return []
    return [str(tag).strip().lower() for tag in tags if str(tag).strip()]


def score_agent_match(
    *,
    name: str,
    description: str,
    prompt: str,
    tags: Any,
    message: str,
) -> float:
    msg_tokens = set(normalize_tokens(message))
    if not msg_tokens:
        return 0.0

    catalog_tokens = set(
        normalize_tokens(
            " ".join(
                [
                    name,
                    description,
                    prompt,
                    " ".join(normalize_tag_values(tags)),
                ]
            )
        )
    )
    score = float(len(msg_tokens.intersection(catalog_tokens)))
    lowered = message.lower()
    if "falcon" in lowered or "crowdstrike" in lowered:
        if "falcon" in catalog_tokens or "crowdstrike" in catalog_tokens:
            score += 2.0
    if "edr" in lowered and "edr" in catalog_tokens:
        score += 1.5
    if "detection" in lowered and "detection" in catalog_tokens:
        score += 1.0
    return score


def to_text(run_output: Any) -> str:
    if run_output is None:
        return ""
    content = getattr(run_output, "content", None)
    if isinstance(content, str):
        return content
    if isinstance(run_output, str):
        return run_output
    return str(content or run_output)


def extract_structured_result_items(tool_result: Any) -> list[dict[str, Any]]:
    structured = getattr(tool_result, "structuredContent", None)
    if isinstance(structured, dict):
        result = structured.get("result")
        if isinstance(result, list):
            return [item for item in result if isinstance(item, dict)]
    return []


def truncate_text(value: str, limit: int = 4000) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[: limit - 15].rstrip() + "\n...[truncated]"


def compact_json(value: Any, limit: int = 5000) -> str:
    return truncate_text(json.dumps(value, ensure_ascii=False, indent=2), limit=limit)


def infer_jumpcloud_requested_count(message: str, default: int = 10) -> int:
    lowered = f" {message.strip().lower()} "
    if any(token in lowered for token in [" ultimo ", " última ", " ultima ", " latest ", " newest ", " mais recente "]):
        return 1
    match = re.search(r"\b(\d{1,3})\b", lowered)
    if not match:
        return default
    return max(1, min(int(match.group(1)), 100))


def is_jumpcloud_password_failure_request(message: str) -> bool:
    lowered = message.lower()
    return any(token in lowered for token in ["senha", "password", "failed", "falha", "erro"])


def is_jumpcloud_auth_event(item: dict[str, Any]) -> bool:
    event_type = str(item.get("event_type", "")).lower()
    return any(token in event_type for token in ["login", "auth", "sso", "mfa"])


def is_jumpcloud_password_failure_event(item: dict[str, Any]) -> bool:
    event_type = str(item.get("event_type", "")).lower()
    if "login" not in event_type and "auth" not in event_type:
        return False
    if item.get("success") is False:
        return True
    auth_context = item.get("auth_context") if isinstance(item.get("auth_context"), dict) else {}
    auth_methods = auth_context.get("auth_methods") if isinstance(auth_context.get("auth_methods"), dict) else {}
    password_method = auth_methods.get("password") if isinstance(auth_methods.get("password"), dict) else {}
    if password_method.get("success") is False:
        return True
    error_message = str(item.get("error_message", "")).lower()
    response_message = ""
    message_chain = item.get("message_chain") if isinstance(item.get("message_chain"), dict) else {}
    if isinstance(message_chain, dict):
        response_message = str(message_chain.get("response_message", "")).lower()
    searchable = f"{error_message} {response_message}"
    return any(token in searchable for token in ["password", "senha", "invalid", "failed", "incorrect"])


def parse_jumpcloud_event_timestamp(item: dict[str, Any]) -> datetime | None:
    raw = str(item.get("timestamp") or item.get("server_timestamp") or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def fetch_jumpcloud_password_failure_events(
    *,
    tool: Any,
    requested_count: int,
    service: str = "directory",
    page_limit: int = 100,
    max_pages: int = 5,
    lookback_days: int = 7,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    matches: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    end_time = ""
    start_time = (datetime.now(timezone.utc) - timedelta(days=lookback_days)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    pages_scanned = 0

    for _ in range(max_pages):
        response = tool.jumpcloud_directory_events(
            service=service,
            start_time=start_time,
            end_time=end_time,
            limit=page_limit,
        )
        pages_scanned += 1
        data = response.get("data")
        if not isinstance(data, list) or not data:
            break
        batch = [item for item in data if isinstance(item, dict)]
        batch = sorted(
            batch,
            key=lambda item: str(item.get("timestamp") or item.get("server_timestamp") or ""),
            reverse=True,
        )
        for item in batch:
            event_id = str(item.get("id") or "").strip()
            if event_id and event_id in seen_ids:
                continue
            if event_id:
                seen_ids.add(event_id)
            if is_jumpcloud_password_failure_event(item):
                matches.append(item)
                if len(matches) >= requested_count:
                    return matches, {
                        "service": service,
                        "start_time": start_time,
                        "limit": page_limit,
                        "pages_scanned": pages_scanned,
                    }
        oldest = parse_jumpcloud_event_timestamp(batch[-1])
        if oldest is None:
            break
        end_time = (oldest - timedelta(seconds=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    return matches, {
        "service": service,
        "start_time": start_time,
        "limit": page_limit,
        "pages_scanned": pages_scanned,
    }


def summarize_jumpcloud_result(operation_name: str, result: dict[str, Any], message: str) -> str:
    data = result.get("data")
    lowered = message.lower()
    requested_count = infer_jumpcloud_requested_count(message)

    if operation_name == "list_users" and isinstance(data, dict):
        results = data.get("results")
        total_count = data.get("totalCount")
        if isinstance(results, list):
            lines = [f"Total retornado nesta consulta: {len(results)}" + (f" de {total_count}" if total_count is not None else "")]
            for item in results[:requested_count]:
                if not isinstance(item, dict):
                    continue
                username = item.get("username") or "-"
                email = item.get("email") or "-"
                state = item.get("state") or "-"
                mfa = item.get("mfaEnrollment", {}).get("overallStatus") if isinstance(item.get("mfaEnrollment"), dict) else None
                lines.append(f"- {username} | {email} | state={state} | mfa={mfa or '-'}")
            return "\n".join(lines)

    if operation_name == "list_systems" and isinstance(data, dict):
        results = data.get("results")
        total_count = data.get("totalCount")
        if isinstance(results, list):
            lines = [f"Total retornado nesta consulta: {len(results)}" + (f" de {total_count}" if total_count is not None else "")]
            for item in results[:requested_count]:
                if not isinstance(item, dict):
                    continue
                hostname = item.get("hostname") or item.get("displayName") or "-"
                os_name = item.get("os") or "-"
                active = item.get("active")
                last_contact = item.get("lastContact") or "-"
                lines.append(f"- {hostname} | os={os_name} | active={active} | lastContact={last_contact}")
            return "\n".join(lines)

    if operation_name in {"list_user_groups", "list_system_groups"} and isinstance(data, list):
        lines = [f"Total retornado nesta consulta: {len(data)}"]
        for item in data[:requested_count]:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or "-"
            group_id = item.get("id") or "-"
            description = item.get("description") or ""
            lines.append(f"- {name} | id={group_id}" + (f" | {description}" if description else ""))
        return "\n".join(lines)

    if operation_name == "list_policies" and isinstance(data, list):
        lines = [f"Total retornado nesta consulta: {len(data)}"]
        for item in data[:requested_count]:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or "-"
            template = item.get("template") if isinstance(item.get("template"), dict) else {}
            template_name = template.get("displayName") or template.get("name") or "-"
            os_family = template.get("osMetaFamily") or "-"
            lines.append(f"- {name} | template={template_name} | os={os_family}")
        return "\n".join(lines)

    if operation_name == "list_directory_events" and isinstance(data, list):
        filtered = [item for item in data if isinstance(item, dict)]
        if any(token in lowered for token in ["login", "auth", "mfa", "sso", "senha", "password", "failed", "falha", "erro"]):
            filtered = [
                item
                for item in filtered
                if is_jumpcloud_auth_event(item)
            ]
        if is_jumpcloud_password_failure_request(message):
            filtered = [item for item in filtered if is_jumpcloud_password_failure_event(item)]
        filtered = sorted(
            filtered,
            key=lambda item: str(item.get("timestamp") or item.get("server_timestamp") or ""),
            reverse=True,
        )
        displayed = filtered[:requested_count]
        lines = [f"Eventos retornados: {len(displayed)}" + (f" de {len(filtered)} considerados no lote" if len(filtered) > len(displayed) else "")]
        for item in displayed:
            event_type = item.get("event_type") or "-"
            service = item.get("service") or "-"
            timestamp = item.get("timestamp") or item.get("server_timestamp") or "-"
            success = item.get("success")
            initiated_by = item.get("initiated_by") if isinstance(item.get("initiated_by"), dict) else {}
            actor = initiated_by.get("email") or initiated_by.get("username") or initiated_by.get("id") or "-"
            resource = item.get("resource") if isinstance(item.get("resource"), dict) else {}
            target = (
                resource.get("username")
                or resource.get("hostname")
                or resource.get("displayName")
                or resource.get("id")
                or "-"
            )
            lines.append(f"- {timestamp} | {event_type} | service={service} | success={success} | actor={actor} | target={target}")
        if len(lines) == 1:
            return "Nenhum evento aderente ao filtro local foi encontrado no lote retornado."
        return "\n".join(lines)

    return compact_json(result)


async def infer_jumpcloud_plan_with_skill(
    *,
    message: str,
    linked_skills: list[dict[str, Any]],
    runtime_planner: dict[str, Any] | None,
    advanced: AdvancedOptions | None,
) -> tuple[str, dict[str, Any], str] | None:
    enabled_skills = [skill for skill in linked_skills if skill.get("enabled", True)]
    skill_prompt = "\n".join(
        f"- {skill.get('name')}: {skill.get('prompt')}"
        for skill in enabled_skills
        if isinstance(skill.get("prompt"), str) and skill.get("prompt")
    )
    instructions = [
        "You classify JumpCloud user requests into a fixed execution plan.",
        "Use the JumpCloud skill guidance and runtime planner task catalog to infer the most appropriate factual lookup.",
        "Return strict JSON only with fields: taskId, operation, query, summary.",
        "operation must be one of: list_users, list_systems, list_user_groups, list_system_groups, list_policies, list_directory_events.",
        "query must be a JSON object.",
        "summary must be a short label.",
        "For requests about failed password/login/authentication, choose list_directory_events with service=directory and a generous limit.",
        "For requests about users, choose list_users unless the request is clearly about authentication events.",
        "Do not invent unsupported operations or filters.",
    ]
    if skill_prompt:
        instructions.append(f"JumpCloud operational skill guidance:\n{skill_prompt}")
    if runtime_planner:
        planner_tasks = runtime_planner.get("tasks") if isinstance(runtime_planner.get("tasks"), list) else []
        task_catalog = "\n".join(
            [
                f"- id={task.get('id')} name={task.get('name')} operation={task.get('operation')} summary={task.get('summary')} when={task.get('when')}"
                for task in planner_tasks
                if isinstance(task, dict)
            ]
        )
        if task_catalog:
            instructions.append(f"Runtime planner tasks:\n{task_catalog}")
    classifier = build_agent_instance(
        name="JumpCloud Intent Classifier",
        instructions=instructions,
        advanced=advanced,
        tools=[],
        overrides={
            "markdown": False,
            "show_tool_calls": False,
            "add_history_to_context": False,
            "num_history_sessions": 0,
            "add_session_state_to_context": False,
            "reasoning": False,
            "reasoning_min_steps": 1,
            "reasoning_max_steps": 1,
        },
    )
    raw = to_text(await classifier.arun(f"User request:\n{message}\n")).strip()
    parsed = parse_json_block(raw)
    task_id = str(parsed.get("taskId", "")).strip()
    operation = str(parsed.get("operation", "")).strip()
    summary = str(parsed.get("summary", "")).strip() or "JumpCloud"
    query = parsed.get("query")
    allowed_operations = {
        "list_users",
        "list_systems",
        "list_user_groups",
        "list_system_groups",
        "list_policies",
        "list_directory_events",
    }
    if runtime_planner:
        planner_tasks = runtime_planner.get("tasks") if isinstance(runtime_planner.get("tasks"), list) else []
        selected_task = next(
            (
                task
                for task in planner_tasks
                if isinstance(task, dict) and str(task.get("id", "")).strip() == task_id
            ),
            None,
        )
        if isinstance(selected_task, dict):
            selected_operation = str(selected_task.get("operation", "")).strip()
            selected_summary = str(selected_task.get("summary", "")).strip() or summary
            selected_query = selected_task.get("query")
            if selected_operation in allowed_operations and isinstance(selected_query, dict):
                merged_query = dict(selected_query)
                if "limit" in merged_query:
                    requested_limit = infer_jumpcloud_requested_count(
                        message,
                        default=int(merged_query.get("limit", 10) or 10),
                    )
                    if selected_operation == "list_directory_events":
                        merged_query["limit"] = max(requested_limit * 25, 50)
                    else:
                        merged_query["limit"] = requested_limit
                return selected_operation, merged_query, selected_summary
    if operation not in allowed_operations or not isinstance(query, dict):
        return None
    return operation, query, summary


def extract_agent_runtime_planner(runtime_config: Any, domain: str) -> dict[str, Any] | None:
    if not isinstance(runtime_config, dict):
        return None
    planner = runtime_config.get("domainPlanner")
    if not isinstance(planner, dict):
        return None
    if str(planner.get("domain", "")).strip().lower() != domain.lower():
        return None
    if planner.get("enabled") is False:
        return None
    tasks = planner.get("tasks")
    if not isinstance(tasks, list) or not tasks:
        return None
    return planner


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
    provider = ((advanced.modelProvider if advanced and advanced.modelProvider else None) or read_env_value("AGNO_MODEL_PROVIDER", default="ollama")).strip().lower()
    if provider == "openai":
        return "openrouter"
    return provider if provider in {"ollama", "openrouter", "vertexai"} else "ollama"


def resolve_model_id(provider: str, advanced: AdvancedOptions | None) -> str:
    if advanced and advanced.modelId:
        return advanced.modelId
    if provider == "openrouter":
        return read_env_value("AGNO_OPENROUTER_MODEL", "AGNO_OPENAI_MODEL", default="openai/gpt-4o-mini")
    if provider == "vertexai":
        return read_env_value("AGNO_VERTEX_MODEL", default="gemini-2.5-flash")
    return read_env_value("AGNO_OLLAMA_MODEL", default="qwen2.5:3b")


def find_vertex_credentials_path() -> Path | None:
    candidates = [
        read_env_value("VERTEX_AI_CREDENTIALS_PATH"),
        read_env_value("GOOGLE_APPLICATION_CREDENTIALS"),
        read_env_value("GOOGLE_SERVICE_ACCOUNT_JSON"),
    ]
    for candidate in candidates:
        if candidate:
            path = Path(candidate).expanduser()
            if path.is_file():
                return path

    preferred_names = (
        "*vertex*.json",
        "*google*.json",
        "*gcp*.json",
        "*service*.json",
        "*.json",
    )
    for pattern in preferred_names:
        matches = sorted(path for path in APP_DIR.glob(pattern) if path.is_file())
        if matches:
            return matches[0]
    return None


def load_vertex_credentials() -> tuple[Any | None, str | None, Path | None]:
    credentials_path = find_vertex_credentials_path()
    if not credentials_path:
        return None, read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID"), None

    try:
        from google.oauth2.service_account import Credentials
    except ImportError as exc:
        raise RuntimeError("google-auth is required when modelProvider=vertexai") from exc

    credentials = Credentials.from_service_account_file(
        str(credentials_path),
        scopes=["https://www.googleapis.com/auth/cloud-platform"],
    )
    project_id = (
        read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID")
        or getattr(credentials, "project_id", None)
    )
    return credentials, project_id, credentials_path


def make_model(advanced: AdvancedOptions | None) -> Any:
    provider = resolve_provider(advanced)
    model_id = resolve_model_id(provider, advanced)

    if provider == "openrouter":
        openrouter_key = read_env_value("OPENROUTER_API_KEY", "OPENAI_API_KEY").strip()
        if not openrouter_key:
            raise RuntimeError("OPENROUTER_API_KEY is required when modelProvider=openrouter")

        raw_kwargs: dict[str, Any] = {
            "id": model_id,
            "api_key": openrouter_key,
            "base_url": read_env_value("OPENROUTER_BASE_URL", "OPENAI_BASE_URL", default="https://openrouter.ai/api/v1"),
            "extra_headers": {
                "HTTP-Referer": read_env_value("OPENROUTER_HTTP_REFERER", default="http://localhost:5173"),
                "X-Title": read_env_value("OPENROUTER_APP_TITLE", default="MVP Agent"),
            },
            "temperature": float(advanced.temperature) if advanced and advanced.temperature is not None else None,
            "max_tokens": int(advanced.maxTokens) if advanced and advanced.maxTokens is not None else None,
        }
        supported = set(inspect.signature(OpenAIChat.__init__).parameters.keys())
        kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
        return OpenAIChat(**kwargs)

    if provider == "vertexai":
        try:
            from agno.models.google import Gemini
        except ImportError as exc:
            raise RuntimeError("google-genai is required when modelProvider=vertexai") from exc

        credentials, project_id, credentials_path = load_vertex_credentials()
        if not project_id:
            raise RuntimeError(
                "GOOGLE_CLOUD_PROJECT or a service-account JSON with project_id is required when modelProvider=vertexai"
            )

        location = read_env_value("GOOGLE_CLOUD_LOCATION", "VERTEX_AI_LOCATION", default="us-central1")
        raw_kwargs: dict[str, Any] = {
            "id": model_id,
            "vertexai": True,
            "project_id": project_id,
            "location": location,
            "credentials": credentials,
            "temperature": float(advanced.temperature) if advanced and advanced.temperature is not None else None,
            "max_output_tokens": int(advanced.maxTokens) if advanced and advanced.maxTokens is not None else None,
        }
        supported = set(inspect.signature(Gemini.__init__).parameters.keys())
        kwargs = {k: v for k, v in raw_kwargs.items() if k in supported and v is not None}
        if credentials_path:
            logger.info("vertex_credentials_loaded", extra={"path": str(credentials_path)})
        return Gemini(**kwargs)

    ollama_host = read_env_value("AGNO_OLLAMA_HOST", "OLLAMA_HOST")
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
    return build_agent_instance(
        name=name,
        instructions=instructions,
        advanced=advanced,
        tools=JUMPCLOUD_TOOL.agno_tools() if JUMPCLOUD_TOOL else [],
    )


def build_agent_instance(
    *,
    name: str,
    instructions: list[str],
    advanced: AdvancedOptions | None,
    tools: list[Any],
    overrides: dict[str, Any] | None = None,
) -> Agent:
    raw_kwargs = {
        "name": name,
        "model": make_model(advanced),
        "instructions": instructions,
        "tools": tools,
        "markdown": bool(advanced.markdown) if advanced else True,
        "show_tool_calls": bool(advanced.showToolCalls) if advanced else False,
        "add_history_to_context": bool(advanced.addHistoryToContext) if advanced else True,
        "num_history_sessions": int(advanced.historySessions) if advanced and advanced.historySessions else 3,
        "add_session_state_to_context": bool(advanced.addStateToContext) if advanced else True,
        "reasoning": bool(advanced.reasoning) if advanced else True,
        "reasoning_min_steps": int(advanced.reasoningMinSteps) if advanced and advanced.reasoningMinSteps else 1,
        "reasoning_max_steps": int(advanced.reasoningMaxSteps) if advanced and advanced.reasoningMaxSteps else 6,
    }
    if overrides:
        raw_kwargs.update(overrides)

    supported = set(inspect.signature(Agent.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported}
    return Agent(**kwargs)


def fetch_ollama_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_OLLAMA_MODEL", default="qwen2.5:3b")
    host = (read_env_value("AGNO_OLLAMA_HOST", "OLLAMA_HOST", default="http://localhost:11434")).rstrip("/")
    url = f"{host}/api/tags"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            payload = json.loads(response.read().decode("utf-8"))
        models = payload.get("models") if isinstance(payload, dict) else []
        model_ids = [item.get("name") for item in models if isinstance(item, dict) and isinstance(item.get("name"), str)]
        unique_ids = sorted({model_id.strip() for model_id in model_ids if model_id and model_id.strip()})
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids or [default_model], "runtime"
    except Exception:
        return [default_model], "fallback"


def fetch_openrouter_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_OPENROUTER_MODEL", "AGNO_OPENAI_MODEL", default="openai/gpt-4o-mini")
    fallback_models = [
        default_model,
        "openai/gpt-4.1-mini",
        "anthropic/claude-3.5-haiku",
        "google/gemini-2.0-flash-001",
    ]
    api_key = read_env_value("OPENROUTER_API_KEY", "OPENAI_API_KEY").strip()
    if not api_key:
        return fallback_models, "fallback"

    base_url = read_env_value("OPENROUTER_BASE_URL", "OPENAI_BASE_URL", default="https://openrouter.ai/api/v1").rstrip("/")
    url = f"{base_url}/models"
    request = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": read_env_value("OPENROUTER_HTTP_REFERER", default="http://localhost:5173"),
            "X-Title": read_env_value("OPENROUTER_APP_TITLE", default="MVP Agent"),
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        data = payload.get("data") if isinstance(payload, dict) else []
        model_ids = [item.get("id") for item in data if isinstance(item, dict) and isinstance(item.get("id"), str)]
        preferred_prefixes = ("openai/", "anthropic/", "google/", "meta-llama/")
        preferred = [model_id for model_id in model_ids if model_id.startswith(preferred_prefixes)]
        unique_ids = sorted({model_id.strip() for model_id in preferred if model_id and model_id.strip()})
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids[:25] or [default_model], "runtime"
    except Exception:
        return fallback_models, "fallback"


def fetch_vertex_model_ids() -> tuple[list[str], str]:
    default_model = read_env_value("AGNO_VERTEX_MODEL", default="gemini-2.5-flash")
    fallback_models = [default_model, "gemini-2.5-pro", "gemini-2.0-flash"]
    try:
        from google import genai
    except ImportError:
        return fallback_models, "fallback"

    try:
        credentials, project_id, _ = load_vertex_credentials()
        project = project_id or read_env_value("GOOGLE_CLOUD_PROJECT", "VERTEX_AI_PROJECT_ID")
        location = read_env_value("GOOGLE_CLOUD_LOCATION", "VERTEX_AI_LOCATION", default="us-central1")
        if not project:
            return fallback_models, "fallback"
        client_kwargs: dict[str, Any] = {
            "vertexai": True,
            "project": project,
            "location": location,
        }
        if credentials is not None:
            client_kwargs["credentials"] = credentials
        client = genai.Client(**client_kwargs)
        models = client.models.list()
        model_ids: list[str] = []
        for model in models:
            model_name = getattr(model, "name", None) or getattr(model, "display_name", None)
            if not isinstance(model_name, str):
                continue
            normalized = model_name.split("/")[-1].strip()
            if normalized.startswith("gemini"):
                model_ids.append(normalized)
        unique_ids = sorted(set(model_ids))
        if default_model not in unique_ids:
            unique_ids.insert(0, default_model)
        return unique_ids[:25] or fallback_models, "runtime"
    except Exception:
        return fallback_models, "fallback"


def get_correlation_id(request: Request | None) -> str:
    if request is None:
        return "none"
    return request.headers.get("x-correlation-id", "none")


def format_runtime_response(reply: str, reasoning_summary: list[str] | None = None) -> str:
    return json.dumps(
        {
            "reply": reply,
            "reasoning_summary": reasoning_summary or ["Execution plan prepared.", "Awaiting the next safe step."],
        },
        ensure_ascii=True,
    )


def format_iam_team_reply(response: Any) -> str:
    lines = [
        f"Resumo: {response.summary}",
        f"Modo: {response.workflow_mode}",
    ]
    if response.workflow_name:
        lines.append(f"Workflow: {response.workflow_name}")
    if response.participating_agents:
        lines.append(f"Agentes: {', '.join(response.participating_agents)}")
    if response.missing_configuration:
        next_missing = response.missing_configuration[0]
        lines.extend(
            [
                "",
                "Configuracao pendente:",
                f"- Integracao: {next_missing.integration_label}",
                f"- Campo: {next_missing.field_label}",
                f"- Motivo: {next_missing.description}",
            ]
        )
    if response.next_steps:
        lines.extend(["", "Proximos passos:"] + [f"- {step}" for step in response.next_steps[:4]])
    if getattr(response, "entitlement_assessment", None) is not None:
        lines.extend(
            [
                "",
                "Entitlement reasoning:",
                f"- Classificacao: {response.entitlement_assessment.classification}",
                f"- Resumo: {response.entitlement_assessment.summary}",
            ]
        )
    if getattr(response, "risk_assessment", None) is not None:
        lines.extend(
            [
                "",
                "Risk assessment:",
                f"- Severidade: {response.risk_assessment.overall_severity}",
                f"- Resumo: {response.risk_assessment.summary}",
            ]
        )
    if getattr(response, "guarded_action_plan", None) is not None and response.guarded_action_plan.decision.decision != "read_only":
        lines.extend(
            [
                "",
                "Change guard:",
                f"- Decisao: {response.guarded_action_plan.decision.decision}",
                f"- Risco: {response.guarded_action_plan.decision.risk_summary}",
            ]
        )
    return "\n".join(lines)


async def run_agent_with_optional_mcp(
    *,
    name: str,
    description: str,
    prompt_text: str,
    agent_type: str,
    persona: str | None,
    routing_role: str | None,
    execution_profile: str | None,
    capabilities: Any,
    domains: Any,
    tags: Any,
    team_key: str | None,
    linked_tools: list[dict[str, Any]],
    linked_knowledge: list[dict[str, Any]],
    linked_skills: list[dict[str, Any]],
    runtime_config: Any,
    message: str,
    history_text: str,
    advanced: AdvancedOptions | None,
    json_response: bool,
    correlation_id: str = "none",
) -> str:
    resolved_persona = normalize_agent_persona(agent_type, persona)
    resolved_routing_role = normalize_routing_role(agent_type, routing_role)
    resolved_execution_profile = normalize_execution_profile(agent_type, execution_profile)
    resolved_capabilities = normalize_agent_capabilities(agent_type, persona, routing_role, execution_profile, capabilities, domains)
    resolved_domains = sorted(set(normalize_str_list(domains) or normalize_tag_values(tags)))
    runtime_config_dict = runtime_config if isinstance(runtime_config, dict) else {}
    iam_team_response = handle_iam_team_request(
        agent_name=name,
        runtime_config=runtime_config_dict,
        message=message,
        linked_knowledge=linked_knowledge,
    )
    if iam_team_response is not None:
        return format_runtime_response(
            format_iam_team_reply(iam_team_response),
            [
                f"intent: {iam_team_response.request_type}",
                f"mode: {iam_team_response.workflow_mode}",
                f"participants: {len(iam_team_response.participating_agents)}",
            ],
        )
    required_integrations = []
    iam_team_profile = runtime_config_dict.get("iamTeamProfile") if isinstance(runtime_config_dict, dict) else None
    if isinstance(iam_team_profile, dict):
        required_integrations.extend(
            [
                str(item).strip().lower()
                for item in (iam_team_profile.get("requiredIntegrations") or [])
                if str(item).strip()
            ]
        )
    required_integrations.extend(
        [
            str(item).strip().lower()
            for item in (runtime_config_dict.get("requiredIntegrations") or [])
            if str(item).strip()
        ]
    )
    if required_integrations:
        deduped_required_integrations = list(dict.fromkeys(required_integrations))
        unavailable_prompt = maybe_build_unavailable_integration_prompt(
            integration_keys=deduped_required_integrations,
            registry=IntegrationConfigRegistry(),
        )
        if unavailable_prompt:
            return format_runtime_response(
                unavailable_prompt,
                ["connector unavailable", f"integrations: {', '.join(deduped_required_integrations)}"],
            )
        setup_prompt = maybe_build_integration_setup_prompt(
            integration_keys=deduped_required_integrations,
            runtime_config=runtime_config_dict,
            registry=IntegrationConfigRegistry(),
        )
        if setup_prompt:
            return format_runtime_response(
                setup_prompt,
                ["configuration missing", f"integrations: {', '.join(deduped_required_integrations)}"],
            )
    if resolved_execution_profile != "READ_ONLY":
        guard_plan = evaluate_change_safety(message=message, requires_write=True)
        if guard_plan.decision.decision in {"propose_only", "approval_required"}:
            return format_runtime_response(
                (
                    "A acao solicitada cai em guardrail de mudanca.\n"
                    f"Decisao: {guard_plan.decision.decision}.\n"
                    f"Risco: {guard_plan.decision.risk_summary}\n"
                    "Siga com proposta auditavel e aprovacao humana antes de qualquer escrita."
                ),
                ["change guard", *guard_plan.audit_notes[:2]],
            )
    logger.info(
        "agent_runtime_start",
        extra={
            "correlation_id": correlation_id,
            "agent_name": name,
            "agent_type": agent_type,
            "agent_persona": resolved_persona,
            "agent_routing_role": resolved_routing_role,
            "agent_execution_profile": resolved_execution_profile,
            "falcon_enabled": ("can_use_falcon_mcp" in resolved_capabilities) or agent_should_use_falcon_mcp(
                agent_name=name,
                agent_description=description,
                agent_prompt=prompt_text,
                team_key=team_key,
                tags=list(set(normalize_tag_values(tags) + resolved_domains + resolved_capabilities)),
            ),
        },
    )
    instructions = [
        "You are a security agent in an IGA security orchestration system.",
        f"Agent type: {agent_type}",
        f"Agent persona: {resolved_persona}",
        f"Routing role: {resolved_routing_role}",
        f"Execution profile: {resolved_execution_profile}",
        f"Agent description: {description}",
        f"Agent prompt: {prompt_text}",
        f"Team key: {team_key or 'GLOBAL'}",
        f"Capabilities: {', '.join(resolved_capabilities) if resolved_capabilities else 'none'}",
        f"Domains: {', '.join(resolved_domains) if resolved_domains else 'none'}",
        *behavior_instructions_for_profile(
            agent_type=agent_type,
            persona=resolved_persona,
            routing_role=resolved_routing_role,
            execution_profile=resolved_execution_profile,
        ),
        "Be concise, practical and policy-aware. Never claim actions were executed if they were not.",
    ]
    if linked_tools:
        tool_catalog = "\n".join(
            [
                f"- {tool.get('name')}: policy={tool.get('policy')} type={tool.get('type')} call={tool.get('callName') or tool.get('name')}"
                for tool in linked_tools
            ]
        )
        instructions.append(f"Portal-linked tools available to this agent:\n{tool_catalog}")
    if linked_knowledge:
        knowledge_catalog = "\n".join(
            [f"- {item.get('name')}: {item.get('url')}" for item in linked_knowledge]
        )
        instructions.append(
            "Portal-linked knowledge sources are references and should only be cited when relevant:\n"
            f"{knowledge_catalog}"
        )
    enabled_skills = [skill for skill in linked_skills if skill.get("enabled", True)]
    if enabled_skills:
        skill_catalog = "\n".join(
            [
                f"- {skill.get('name')} ({skill.get('category')}): {skill.get('prompt')}"
                for skill in enabled_skills
            ]
        )
        instructions.append(f"Operational skills linked from portal:\n{skill_catalog}")
    if json_response:
        instructions.extend(
            [
                "Return strict JSON only with fields: reply (string) and reasoning_summary (array of 2-4 short strings).",
                "reasoning_summary must be high-level and concise, never hidden chain-of-thought.",
            ]
        )
    falcon_enabled_for_agent = ("can_use_falcon_mcp" in resolved_capabilities) or agent_should_use_falcon_mcp(
        agent_name=name,
        agent_description=description,
        agent_prompt=prompt_text,
        team_key=team_key,
        tags=list(set(normalize_tag_values(tags) + resolved_domains + resolved_capabilities)),
    )
    jumpcloud_runtime_planner = extract_agent_runtime_planner(runtime_config, "jumpcloud")
    jumpcloud_enabled_for_agent = bool(JUMPCLOUD_TOOL) and (
        ("can_use_jumpcloud" in resolved_capabilities)
        or
        jumpcloud_runtime_planner is not None
        or any(
            token in " ".join(
                [
                    name.lower(),
                    description.lower(),
                    prompt_text.lower(),
                    (team_key or "").lower(),
                    " ".join(normalize_tag_values(tags)),
                    " ".join(resolved_domains),
                    " ".join(resolved_capabilities),
                ]
            )
            for token in ["jumpcloud", "directory insights", "iam", "iga", "directory"]
        )
    )
    if falcon_enabled_for_agent:
        instructions.extend(build_falcon_response_instructions())
        instructions.extend(
            [
                "Sempre que o usuario pedir informacoes sobre Falcon, CrowdStrike ou EDR, consulte primeiro a console via Falcon MCP antes de responder.",
                "Nao responda apenas com orientacao teorica quando a pergunta pedir dados observaveis na console.",
                "Para perguntas sobre quantidade total de hosts, prefira usar falcon_count_hosts.",
                "Para listar nomes de hosts, prefira usar falcon_list_hostnames.",
                "Para outras perguntas, use falcon_list_available_operations e depois falcon_execute_read_only com a operacao mais adequada.",
            ]
        )
    if jumpcloud_enabled_for_agent:
        instructions.extend(
            [
                "Sempre que o usuario pedir informacoes sobre JumpCloud, usuarios, grupos, devices, policies ou Directory Insights, consulte primeiro a console JumpCloud antes de responder.",
                "Nao responda apenas com orientacao teorica quando a pergunta pedir dados observaveis no JumpCloud.",
                "Para usuarios, systems/devices, grupos, policies e eventos recentes, prefira consultas factuais no JumpCloud antes de qualquer interpretacao.",
            ]
        )
        if jumpcloud_runtime_planner:
            instructions.append("Use o runtimeConfig.domainPlanner deste agente como fonte primaria para interpretar tarefas e consultar o JumpCloud.")

    prompt = (
        "Conversation history:\n"
        f"{history_text or 'none'}\n\n"
        "User message:\n"
        f"{message}"
    )

    falcon_config = build_falcon_mcp_config_from_env()
    falcon_tools = build_falcon_mcp_tools(falcon_config, message=message) if falcon_enabled_for_agent else None

    base_tools = JUMPCLOUD_TOOL.agno_tools() if JUMPCLOUD_TOOL else []
    raw_kwargs = {
        "name": name,
        "model": make_model(advanced),
        "instructions": instructions,
        "tools": base_tools,
        "markdown": bool(advanced.markdown) if advanced else True,
        "show_tool_calls": bool(advanced.showToolCalls) if advanced else False,
        "add_history_to_context": False if falcon_enabled_for_agent else (bool(advanced.addHistoryToContext) if advanced else True),
        "num_history_sessions": 0 if falcon_enabled_for_agent else (int(advanced.historySessions) if advanced and advanced.historySessions else 3),
        "add_session_state_to_context": False if falcon_enabled_for_agent else (bool(advanced.addStateToContext) if advanced else True),
        "reasoning": False if falcon_enabled_for_agent else (bool(advanced.reasoning) if advanced else True),
        "reasoning_min_steps": 1,
        "reasoning_max_steps": 1,
    }
    supported = set(inspect.signature(Agent.__init__).parameters.keys())
    kwargs = {k: v for k, v in raw_kwargs.items() if k in supported}

    def requires_jumpcloud_console_lookup(user_message: str) -> bool:
        if jumpcloud_runtime_planner is not None:
            return True
        lowered = user_message.strip().lower()
        return any(
            token in lowered
            for token in [
                "jumpcloud",
                "usuario",
                "usuário",
                "user",
                "users",
                "grupo",
                "group",
                "device",
                "devices",
                "system",
                "systems",
                "host",
                "hostname",
                "policy",
                "policies",
                "insight",
                "evento",
                "event",
                "login",
                "auth",
                "mfa",
                "directory",
                "senha",
                "password",
                "failed",
                "falha",
                "erro",
            ]
        )

    def infer_jumpcloud_list_limit(user_message: str) -> int:
        return infer_jumpcloud_requested_count(user_message, default=10)

    def infer_jumpcloud_plan(user_message: str) -> tuple[str, dict[str, Any], str]:
        lowered = user_message.strip().lower()
        limit = infer_jumpcloud_list_limit(user_message)
        if any(token in lowered for token in ["policy", "policies", "politica", "política"]):
            return "list_policies", {"limit": limit}, "Policies"
        if any(token in lowered for token in ["group", "groups", "grupo", "grupos"]):
            if any(token in lowered for token in ["device", "devices", "system", "systems", "host"]):
                return "list_system_groups", {"limit": limit}, "System groups"
            return "list_user_groups", {"limit": limit}, "User groups"
        if any(token in lowered for token in ["event", "events", "evento", "eventos", "insight", "login", "auth", "mfa", "activity", "atividade", "senha", "password", "failed", "falha", "erro"]):
            query: dict[str, Any] = {"limit": max(limit * 25, 50)}
            if any(token in lowered for token in ["login", "auth", "mfa", "sso", "senha", "password", "failed", "falha", "erro"]):
                query["service"] = "directory"
            return "list_directory_events", query, "Directory Insights"
        if any(token in lowered for token in ["device", "devices", "system", "systems", "host", "hostname", "machine", "computer"]):
            return "list_systems", {"limit": limit}, "Systems"
        return "list_users", {"limit": limit}, "Users"

    if jumpcloud_enabled_for_agent and JUMPCLOUD_TOOL and requires_jumpcloud_console_lookup(message):
        classified_plan = await infer_jumpcloud_plan_with_skill(
            message=message,
            linked_skills=linked_skills,
            runtime_planner=jumpcloud_runtime_planner,
            advanced=advanced,
        )
        operation_name, operation_args, prefetch_summary = classified_plan or infer_jumpcloud_plan(message)
        if operation_name == "list_directory_events":
            operation_args = {
                **operation_args,
                "limit": max(int(operation_args.get("limit", 50) or 50), 50),
            }
        if operation_name == "list_directory_events" and is_jumpcloud_password_failure_request(message):
            requested_count = infer_jumpcloud_requested_count(message, default=1)
            failure_events, search_meta = fetch_jumpcloud_password_failure_events(
                tool=JUMPCLOUD_TOOL,
                requested_count=requested_count,
                service=str(operation_args.get("service", "directory") or "directory"),
                page_limit=max(int(operation_args.get("limit", 50) or 50), 50),
            )
            jumpcloud_result = {
                "ok": True,
                "status": 200,
                "method": "POST",
                "url": "jumpcloud_directory_events_search",
                "data": failure_events,
                "meta": search_meta,
            }
            operation_args = {**operation_args, **search_meta}
        else:
            jumpcloud_result = JUMPCLOUD_TOOL.jumpcloud_execute(
                operation=operation_name,
                query_json=json.dumps(operation_args, ensure_ascii=True),
            )
        summarized_result = summarize_jumpcloud_result(operation_name, jumpcloud_result, message)
        return (
            f"## Resumo Executivo\n"
            f"Consultei o JumpCloud antes de responder.\n\n"
            f"## O que foi observado\n"
            f"Fonte: {prefetch_summary}\n"
            f"Operacao: {operation_name}\n"
            f"Argumentos: {json.dumps(operation_args, ensure_ascii=True)}\n\n"
            f"{summarized_result}\n\n"
            f"## Interpretacao tecnica\n"
            f"Os dados acima foram buscados diretamente na console JumpCloud para esta pergunta.\n\n"
            f"## Lacunas / incertezas\n"
            f"Se precisar, eu posso aplicar filtros mais especificos ou detalhar um item retornado.\n\n"
            f"## Proximos passos recomendados\n"
            f"Posso agora aprofundar em um usuario, device, grupo, policy ou evento especifico.\n\n"
            f"## Nivel de confianca\nAlto"
        )

    if falcon_tools is None:
        agent = build_agent_instance(name=name, instructions=instructions, advanced=advanced, tools=base_tools, overrides=kwargs)
        return to_text(await agent.arun(prompt)).strip()

    async with falcon_tools as mcp_tools:
        allowed_tool_names = resolve_allowed_falcon_tool_names(falcon_config, message=message)

        def requires_falcon_console_lookup(user_message: str) -> bool:
            lowered = user_message.strip().lower()
            return any(
                token in lowered
                for token in [
                    "falcon",
                    "crowdstrike",
                    "edr",
                    "endpoint",
                    "hostname",
                    "host",
                    "sensor",
                    "detection",
                    "detecc",
                    "incident",
                    "behavior",
                    "ioc",
                    "indicator",
                    "actor",
                    "mitre",
                    "vuln",
                    "cve",
                ]
            )

        def infer_hostname_list_limit(user_message: str) -> int | None:
            lowered = user_message.strip().lower()
            if not any(token in lowered for token in ["hostname", "hostnames", "host name", "hosts", "endpoints"]):
                return None
            if not any(token in lowered for token in ["liste", "listar", "mostre", "mostrar", "traga", "quais", "me de", "me dê"]):
                return None
            match = re.search(r"\b(\d{1,3})\b", lowered)
            if match:
                return max(1, min(int(match.group(1)), 100))
            return 10

        def is_direct_host_count_request(user_message: str) -> bool:
            lowered = user_message.strip().lower()
            if not any(token in lowered for token in ["host", "hostname", "endpoint", "asset", "sensor"]):
                return False
            return any(
                token in lowered
                for token in [
                    "quantos",
                    "quantidade",
                    "count",
                    "total de",
                    "numero de",
                    "número de",
                ]
            )

        def infer_falcon_prefetch_operation(user_message: str) -> tuple[str, dict[str, Any], str] | None:
            lowered = user_message.strip().lower()
            operation = "falcon_search_detections"
            arguments: dict[str, Any] = {"limit": 10}
            summary = "Deteccoes"

            if any(token in lowered for token in ["host", "hostname", "endpoint", "sensor", "asset"]):
                operation = "falcon_search_hosts"
                arguments = {"limit": 10, "sort": "hostname.asc"}
                summary = "Inventario de hosts"
            elif any(token in lowered for token in ["detection", "detecc", "alert"]):
                operation = "falcon_search_detections"
                arguments = {"limit": 10}
                summary = "Deteccoes"
            elif any(token in lowered for token in ["incident"]):
                operation = "falcon_search_incidents"
                arguments = {"limit": 10}
                summary = "Incidentes"
            elif any(token in lowered for token in ["behavior", "comportamento"]):
                operation = "falcon_search_behaviors"
                arguments = {"limit": 10}
                summary = "Behaviors"
            elif any(token in lowered for token in ["ioc", "indicator", "indicator", "actor", "mitre", "intel", "threat"]):
                operation = "falcon_search_iocs" if "falcon_search_iocs" in allowed_tool_names else "falcon_search_reports"
                arguments = {"limit": 10}
                summary = "Threat intelligence"
            elif any(token in lowered for token in ["vuln", "vulnerability", "cve", "patch", "application"]):
                operation = "falcon_search_vulnerabilities"
                arguments = {"limit": 10}
                summary = "Vulnerabilidades"
            elif any(token in lowered for token in ["report", "relatorio", "relatório"]):
                operation = "falcon_search_reports"
                arguments = {"limit": 10}
                summary = "Relatorios"

            if operation not in allowed_tool_names:
                fallback = next((name for name in allowed_tool_names if name != "falcon_check_connectivity"), None)
                if fallback:
                    return fallback, {"limit": 10}, f"Consulta Falcon via {fallback}"
                if "falcon_search_incidents" in allowed_tool_names:
                    return "falcon_search_incidents", {"limit": 10}, "Incidentes"
                if "falcon_search_hosts" in allowed_tool_names:
                    return "falcon_search_hosts", {"limit": 10, "sort": "hostname.asc"}, "Inventario de hosts"
                if "falcon_check_connectivity" in allowed_tool_names:
                    return "falcon_check_connectivity", {}, "Conectividade do Falcon"
                return None
            return operation, arguments, summary

        async def falcon_list_available_operations() -> str:
            """Lista as operacoes read-only do Falcon disponiveis para esta pergunta."""
            return "\n".join(allowed_tool_names)

        async def falcon_count_hosts() -> str:
            """Conta hosts retornados pelo Falcon usando consulta ampla de inventario."""
            result = await mcp_tools.session.call_tool(  # type: ignore[union-attr]
                "falcon_search_hosts",
                {
                    "limit": 5000,
                    "sort": "hostname.asc",
                },
            )
            hosts = extract_structured_result_items(result)
            count = len(hosts)
            if count >= 5000:
                return (
                    f"Foram retornados {count} hosts na consulta atual. "
                    "Isso pode indicar 5000 ou mais hosts no ambiente."
                )
            return f"Foram retornados {count} hosts na consulta atual."

        async def falcon_list_hostnames(limit: int = 20) -> str:
            """Lista hostnames unicos do Falcon para consultas de inventario."""
            safe_limit = max(1, min(int(limit), 100))
            result = await mcp_tools.session.call_tool(  # type: ignore[union-attr]
                "falcon_search_hosts",
                {
                    "limit": safe_limit,
                    "sort": "hostname.asc",
                },
            )
            hosts = extract_structured_result_items(result)
            hostnames: list[str] = []
            seen: set[str] = set()
            for host in hosts:
                hostname = host.get("hostname")
                if isinstance(hostname, str) and hostname and hostname not in seen:
                    seen.add(hostname)
                    hostnames.append(hostname)
            return "\n".join(hostnames) if hostnames else "Nenhum hostname encontrado."

        async def falcon_execute_read_only(operation: str, arguments_json: str = "{}") -> str:
            """Executa uma operacao read-only do Falcon MCP e retorna JSON resumido.

            Use primeiro falcon_list_available_operations para descobrir operacoes validas.
            """
            normalized_operation = operation.strip()
            if normalized_operation not in allowed_tool_names:
                return (
                    "Operacao nao permitida para esta pergunta. "
                    "Use falcon_list_available_operations para listar opcoes validas."
                )
            try:
                parsed_args = json.loads(arguments_json) if arguments_json.strip() else {}
            except json.JSONDecodeError as exc:
                return f"JSON invalido em arguments_json: {exc}"
            if not isinstance(parsed_args, dict):
                return "arguments_json deve representar um objeto JSON."
            result = await mcp_tools.session.call_tool(normalized_operation, parsed_args)  # type: ignore[union-attr]
            return serialize_falcon_tool_result(result)

        direct_hostname_limit = infer_hostname_list_limit(message)
        if direct_hostname_limit is not None:
            hostnames = await falcon_list_hostnames(limit=direct_hostname_limit)
            return (
                f"## Resumo Executivo\n"
                f"Listei {direct_hostname_limit} hostnames solicitados diretamente do Falcon.\n\n"
                f"## O que foi observado\n{hostnames}\n\n"
                f"## Interpretacao tecnica\nConsulta direta de inventario executada no Falcon MCP.\n\n"
                f"## Lacunas / incertezas\nA lista reflete apenas os resultados retornados pela consulta atual ordenada por hostname.\n\n"
                f"## Proximos passos recomendados\nSe quiser, eu posso filtrar por padrao de hostname, dominio, plataforma ou status do sensor.\n\n"
                f"## Nivel de confianca\nAlto"
            )

        if is_direct_host_count_request(message):
            count_summary = await falcon_count_hosts()
            return (
                f"## Resumo Executivo\n{count_summary}\n\n"
                f"## O que foi observado\nA contagem foi obtida por consulta direta de inventario no Falcon.\n\n"
                f"## Interpretacao tecnica\nResultado retornado sem depender de inferencia textual do modelo.\n\n"
                f"## Lacunas / incertezas\nSe o ambiente exceder o limite da consulta, a contagem pode representar apenas o teto retornado.\n\n"
                f"## Proximos passos recomendados\nSe quiser, eu posso listar uma amostra de hostnames ou segmentar por criterio especifico.\n\n"
                f"## Nivel de confianca\nAlto"
            )

        if requires_falcon_console_lookup(message):
            prefetch_plan = infer_falcon_prefetch_operation(message)
            if prefetch_plan:
                operation_name, operation_args, prefetch_summary = prefetch_plan
                prefetch_result = await mcp_tools.session.call_tool(operation_name, operation_args)  # type: ignore[union-attr]
                prefetch_text = serialize_falcon_tool_result(prefetch_result)
                if operation_name != "falcon_check_connectivity":
                    return (
                        f"## Resumo Executivo\n"
                        f"Consultei a console CrowdStrike Falcon via MCP antes de responder.\n\n"
                        f"## O que foi observado\n"
                        f"Fonte: {prefetch_summary}\n"
                        f"Operacao: {operation_name}\n"
                        f"Argumentos: {json.dumps(operation_args, ensure_ascii=True)}\n\n"
                        f"{truncate_text(prefetch_text)}\n\n"
                        f"## Interpretacao tecnica\n"
                        f"Os dados acima foram buscados diretamente na console Falcon para esta pergunta.\n\n"
                        f"## Lacunas / incertezas\n"
                        f"Se precisar, eu posso refinar a consulta com filtros adicionais para reduzir ruido ou aprofundar a investigacao.\n\n"
                        f"## Proximos passos recomendados\n"
                        f"Posso agora detalhar um item especifico, aplicar filtros ou traduzir esse retorno em acao operacional.\n\n"
                        f"## Nivel de confianca\nAlto"
                    )
                instructions.append(
                    "Falcon console data fetched via MCP for this request. Base your answer on it.\n"
                    f"Source: {prefetch_summary}\n"
                    f"Operation: {operation_name}\n"
                    f"Arguments: {json.dumps(operation_args, ensure_ascii=True)}\n"
                    f"Result:\n{prefetch_text}"
                )

        agent = build_agent_instance(
            name=name,
            instructions=instructions,
            advanced=advanced,
            tools=[
                *base_tools,
                falcon_count_hosts,
                falcon_list_hostnames,
                falcon_list_available_operations,
                falcon_execute_read_only,
            ],
            overrides=kwargs,
        )
        return to_text(await agent.arun(prompt)).strip()


app = FastAPI(title="MVP Agno Service", version="1.0.0")
JUMPCLOUD_TOOL = build_jumpcloud_tool_from_env()
FALCON_MCP_CONFIG = build_falcon_mcp_config_from_env()


@app.get("/health")
def health(request: Request) -> dict[str, Any]:
    provider = resolve_provider(None)
    correlation_id = get_correlation_id(request)
    logger.info("health_check", extra={"correlation_id": correlation_id})
    return {
        "ok": True,
        "service": "agno-service",
        "provider": provider,
        "model": resolve_model_id(provider, None),
        "providers": ["ollama", "openrouter", "vertexai"],
        "jumpcloudFeatureEnabled": JUMPCLOUD_TOOL_FEATURE_ENABLED,
        "jumpcloudToolEnabled": bool(JUMPCLOUD_TOOL),
        "jumpcloudWriteEnabled": bool(JUMPCLOUD_TOOL.write_enabled) if JUMPCLOUD_TOOL else False,
        "falconMcpEnabled": FALCON_MCP_CONFIG.enabled,
        "falconMcpMode": FALCON_MCP_CONFIG.mode,
        "falconMcpTransport": FALCON_MCP_CONFIG.transport,
        "falconMcpIncludeAllTools": FALCON_MCP_CONFIG.include_all_tools,
    }


@app.get("/models")
def models_catalog(request: Request) -> dict[str, Any]:
    correlation_id = get_correlation_id(request)
    logger.info("models_catalog_request", extra={"correlation_id": correlation_id})
    ollama_models, ollama_source = fetch_ollama_model_ids()
    openrouter_models, openrouter_source = fetch_openrouter_model_ids()
    vertex_models, vertex_source = fetch_vertex_model_ids()
    return {
        "providers": [
            {
                "id": "ollama",
                "label": "ollama",
                "defaultModel": resolve_model_id("ollama", None),
                "models": ollama_models,
                "source": ollama_source,
            },
            {
                "id": "openrouter",
                "label": "openrouter",
                "defaultModel": resolve_model_id("openrouter", None),
                "models": openrouter_models,
                "source": openrouter_source,
            },
            {
                "id": "vertexai",
                "label": "vertexai",
                "defaultModel": resolve_model_id("vertexai", None),
                "models": vertex_models,
                "source": vertex_source,
            },
        ]
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


@app.post("/workflow/setup-check")
def workflow_setup_check(req: WorkflowSetupCheckRequest) -> dict[str, Any]:
    registry = IntegrationConfigRegistry()
    integrations: list[dict[str, Any]] = []
    for integration_key in req.integrationKeys:
        definition = registry.get(integration_key)
        if definition is None:
            continue
        state = registry.evaluate_setup_state(integration_key)
        integrations.append(
            {
                "key": definition.key,
                "label": definition.label,
                "configured": not state.missing_fields,
                "available": integration_key == "jumpcloud",
                "missingFields": [item.field_label for item in state.missing_fields],
            }
        )
    configured_count = len([item for item in integrations if item["configured"]])
    available_count = len([item for item in integrations if item["available"]])
    return {
        "integrations": integrations,
        "summary": (
            f"{configured_count}/{len(integrations)} configured, "
            f"{available_count}/{len(integrations)} with runtime connector available."
            if integrations
            else "No integrations declared for this workflow."
        ),
    }


@app.post("/simulate")
async def simulate(req: SimulateRequest, request: Request) -> dict[str, Any]:
    correlation_id = get_correlation_id(request)
    teams = req.teams
    specialists = [a for a in req.agents if normalize_routing_role(a.type, a.routingRole) == "SPECIALIST" or normalize_agent_persona(a.type, a.persona) in {"SPECIALIST", "ANALYST"}]
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
    if team_specialists:
        ranked_team_specialists = sorted(
            team_specialists,
            key=lambda agent: score_agent_match(
                name=agent.name,
                description=agent.description,
                prompt=agent.prompt,
                tags=agent.tags,
                message=req.message,
            ),
            reverse=True,
        )
        chosen_specialist = ranked_team_specialists[0]
    else:
        chosen_specialist = specialists[0] if specialists else None

    specialist_reply = ""
    if chosen_specialist:
        specialist_reply = await run_agent_with_optional_mcp(
            name=chosen_specialist.name,
            description=chosen_specialist.description,
            prompt_text=chosen_specialist.prompt,
            agent_type=chosen_specialist.type,
            persona=chosen_specialist.persona,
            routing_role=chosen_specialist.routingRole,
            execution_profile=chosen_specialist.executionProfile,
            capabilities=chosen_specialist.capabilities,
            domains=chosen_specialist.domains,
            tags=chosen_specialist.tags,
            team_key=chosen_team.key if chosen_team else None,
            linked_tools=[],
            linked_knowledge=[],
            linked_skills=[],
            runtime_config=None,
            message=req.message,
            history_text="none",
            advanced=req.advanced,
            json_response=False,
            correlation_id=correlation_id,
        )

    ranked_items = []
    for agent in [a for a in req.agents if (chosen_team and (a.teamId == chosen_team.id or a.isGlobal))]:
        score = score_agent_match(
            name=agent.name,
            description=agent.description,
            prompt=agent.prompt,
            tags=agent.tags,
            message=req.message,
        )
        if agent.id == (chosen_specialist.id if chosen_specialist else None):
            score += 2
        ranked_items.append({"agent": agent, "score": float(score)})
    ranked_items.sort(key=lambda x: x["score"], reverse=True)

    confidence = decision.get("confidence") if isinstance(decision.get("confidence"), (int, float)) else None
    if confidence is None:
        confidence = 0.55 if chosen_specialist else 0.25

    path = []
    supervisor = next((a for a in req.agents if normalize_agent_persona(a.type, a.persona) == "SUPERVISOR" or normalize_routing_role(a.type, a.routingRole) == "ENTRYPOINT"), None)
    ticket = next((a for a in req.agents if normalize_routing_role(a.type, a.routingRole) == "TERMINAL" or normalize_execution_profile(a.type, a.executionProfile) != "READ_ONLY"), None)
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
async def chat(req: ChatRequest, request: Request) -> dict[str, Any]:
    correlation_id = get_correlation_id(request)
    history_text = "\n".join([f"{m.role}: {m.content}" for m in req.history[-12:]])
    out = ""
    try:
        for _ in range(2):
            out = await run_agent_with_optional_mcp(
                name=req.agent.name,
                description=req.agent.description,
                prompt_text=req.agent.prompt,
                agent_type=req.agent.type,
                persona=req.agent.persona,
                routing_role=req.agent.routingRole,
                execution_profile=req.agent.executionProfile,
                capabilities=req.agent.capabilities,
                domains=req.agent.domains,
                tags=req.agent.tags,
                team_key=req.agent.teamKey,
                linked_tools=req.agent.tools,
                linked_knowledge=req.agent.knowledgeSources,
                linked_skills=req.agent.skills,
                runtime_config=req.agent.runtimeConfig,
                message=req.message,
                history_text=history_text,
                advanced=req.advanced,
                json_response=True,
                correlation_id=correlation_id,
            )
            if out:
                break
            # Retry once with explicit instruction when model returns empty text.
            history_text = f"{history_text}\nassistant: Return a direct and concise answer now."
    except RuntimeError as exc:
        logger.warning(
            "chat_runtime_error",
            extra={"correlation_id": correlation_id, "agent": req.agent.name, "error": str(exc)},
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "chat_unhandled_error",
            extra={"correlation_id": correlation_id, "agent": req.agent.name},
        )
        raise HTTPException(status_code=500, detail="Agno runtime failed during chat execution.") from exc

    parsed = parse_json_block(out)
    parsed_reply = parsed.get("reply")
    reply = str(parsed_reply).strip() if parsed_reply is not None else ""
    if not reply:
        reply = extract_reply_from_text(out) or out
    if not reply:
        reply = fallback_chat_reply_for_profile(
            agent_type=req.agent.type,
            persona=req.agent.persona,
            routing_role=req.agent.routingRole,
            execution_profile=req.agent.executionProfile,
            message=req.message,
        )
    raw_summary = parsed.get("reasoning_summary")
    reasoning_summary = [str(x) for x in raw_summary] if isinstance(raw_summary, list) else fallback_reasoning_summary_for_profile(
        agent_type=req.agent.type,
        persona=req.agent.persona,
        routing_role=req.agent.routingRole,
        execution_profile=req.agent.executionProfile,
        message=req.message,
    )
    return {
        "reply": reply,
        "reasoningSummary": reasoning_summary[:4],
        "meta": {
            "framework": "agno",
            "provider": resolve_provider(req.advanced),
            "model": resolve_model_id(resolve_provider(req.advanced), req.advanced),
            "agent": req.agent.name,
            "correlationId": correlation_id,
        },
    }


@app.get("/catalog")
def catalog(request: Request) -> dict[str, Any]:
    logger.info("catalog_request", extra={"correlation_id": get_correlation_id(request)})
    tools: list[dict[str, Any]] = []
    skills: list[dict[str, Any]] = []
    workflows: list[dict[str, Any]] = []
    knowledge_sources: list[dict[str, Any]] = []
    iam_team_catalog = build_iam_team_catalog()
    tools.extend(iam_team_catalog.get("tools", []))
    skills.extend(iam_team_catalog.get("skills", []))
    workflows.extend(iam_team_catalog.get("workflows", []))

    if JUMPCLOUD_TOOL_FEATURE_ENABLED:
        tools.append(
            {
                "id": "agno-jumpcloud-readonly",
                "name": "JumpCloud Directory Read Only",
                "description": "Runtime bridge for JumpCloud directory, devices, groups and Directory Insights in read-only mode.",
                "callName": "jumpcloud_execute",
                "type": "internal",
                "policy": "read",
                "transport": "https",
                "mode": "real",
                "visibility": "shared",
                "ownerTeamKey": "IAM_IGA",
                "managedBy": "agno",
                "runtimeSource": "jumpcloud-tool",
                "linkedAgentNames": ["JumpCloud Directory Analyst"],
            }
        )
        skills.append(
            {
                "id": "agno-jumpcloud-directory-investigation",
                "name": "JumpCloud Directory Investigation",
                "description": "Investigacao e triagem de identidade, grupos, dispositivos e eventos de Directory Insights no JumpCloud.",
                "prompt": "Atue como especialista senior de IAM/IGA focado em JumpCloud. Priorize verificacao factual em usuarios, grupos, devices e Directory Insights antes de responder. Diferencie fatos observados, inferencias, lacunas e proximos passos.",
                "category": "analysis",
                "enabled": True,
                "runbookUrl": None,
                "visibility": "shared",
                "ownerTeamKey": "IAM_IGA",
                "managedBy": "agno",
                "runtimeSource": "jumpcloud-tool",
                "linkedAgentNames": ["JumpCloud Directory Analyst"],
            }
        )

    return {
        "tools": tools,
        "skills": skills,
        "workflows": workflows,
        "knowledgeSources": knowledge_sources,
    }
