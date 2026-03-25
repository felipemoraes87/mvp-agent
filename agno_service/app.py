from __future__ import annotations

import inspect
import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from agno.agent import Agent

from agent_profiles import (
    behavior_instructions_for_profile,
    fallback_chat_reply_for_profile,
    fallback_reasoning_summary_for_profile,
    normalize_agent_capabilities,
    normalize_agent_persona,
    normalize_execution_profile,
    normalize_routing_role,
)
from connectors import (
    AtlassianMCPConfig,
    JumpCloudToolError,
    agent_should_use_atlassian_mcp,
    agent_should_use_falcon_mcp,
    build_atlassian_mcp_config_from_env,
    build_atlassian_mcp_tools,
    build_atlassian_response_instructions,
    build_falcon_mcp_config_from_env,
    build_falcon_mcp_tools,
    build_falcon_response_instructions,
    build_jumpcloud_mcp_config_from_env,
    build_jumpcloud_mcp_tools,
    build_jumpcloud_skills_from_env,
    infer_falcon_prefetch_operation,
    infer_hostname_list_limit,
    infer_jumpcloud_plan_with_skill,
    infer_operation_plan,
    is_direct_host_count_request,
    make_falcon_agent_tools,
    requires_atlassian_lookup,
    requires_falcon_console_lookup,
    resolve_allowed_falcon_tool_names,
    serialize_falcon_tool_result,
)
from model_factory import (
    build_agent_instance,
    fetch_ollama_model_ids,
    fetch_openrouter_model_ids,
    fetch_vertex_model_ids,
    make_model,
    resolve_model_id,
    resolve_provider,
)
from models import (
    AdvancedOptions,
    AgentItem,
    ChatAgent,
    ChatMessage,
    ChatRequest,
    HandoffItem,
    JumpCloudExecuteRequest,
    RuleItem,
    SimulateRequest,
    TeamItem,
    WorkflowSetupCheckRequest,
)
from observability import _agent_run_log, _emit_agent_log, router as observability_router
from secret_env import read_env_value
from team_engine import handle_team_request, maybe_build_integration_setup_prompt, maybe_build_unavailable_integration_prompt
from team_engine.coordinator import build_all_team_catalogs, get_specialist_capabilities
from team_engine.integration_registry import IntegrationConfigRegistry
from utils import (
    extract_agent_runtime_planner,
    extract_reply_from_text,
    format_iam_team_reply,
    format_runtime_response,
    get_correlation_id,
    normalize_str_list,
    normalize_tag_values,
    normalize_tokens,
    parse_json_block,
    score_agent_match,
    to_text,
    truncate_text,
)


logging.basicConfig(level=read_env_value("LOG_LEVEL", default="INFO").upper())
logger = logging.getLogger("agno_service")
JUMPCLOUD_TOOL_FEATURE_ENABLED = (read_env_value("JUMPCLOUD_TOOL_ENABLED", default="false") or "false").strip().lower() == "true"



def make_agent(name: str, instructions: list[str], advanced: AdvancedOptions | None) -> Agent:
    return build_agent_instance(
        name=name,
        instructions=instructions,
        advanced=advanced,
        tools=JUMPCLOUD_SKILLS.agno_tools() if JUMPCLOUD_SKILLS else [],
    )


async def _execute_specialists(
    team_key: str,
    message: str,
    advanced: AdvancedOptions | None,
    correlation_id: str,
) -> dict[str, str]:
    """Call each specialist agent identified by the coordinator and collect their replies."""
    specialists = get_specialist_capabilities(team_key, message)
    results: dict[str, str] = {}
    for cap in specialists:
        try:
            result = await run_agent_with_optional_mcp(
                name=cap.agent_name,
                description=cap.description or cap.summary,
                prompt_text="\n".join(cap.instructions) if cap.instructions else cap.summary,
                agent_type=cap.agent_type,
                persona=cap.persona,
                routing_role=cap.routing_role,
                execution_profile=cap.execution_profile,
                capabilities=cap.capabilities,
                domains=cap.domains,
                tags=cap.tags,
                team_key=None,
                linked_tools=[],
                linked_knowledge=[],
                linked_skills=[],
                runtime_config=None,
                message=message,
                history_text="",
                advanced=advanced,
                json_response=False,
                correlation_id=correlation_id,
            )
            if result:
                results[cap.agent_name] = result
        except Exception as exc:
            logger.warning("specialist_failed", extra={"agent": cap.agent_name, "error": str(exc), "correlation_id": correlation_id})
    return results


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
    _iam_profile = runtime_config_dict.get("iamTeamProfile") or {}
    _team_key = str(_iam_profile.get("teamKey", "")).strip().upper()
    iam_team_response = handle_team_request(
        team_key=_team_key,
        agent_name=name,
        runtime_config=runtime_config_dict,
        message=message,
        linked_knowledge=linked_knowledge,
    ) if _team_key else None
    _specialist_context: str | None = None
    if iam_team_response is not None:
        specialist_results = await _execute_specialists(_team_key, message, advanced, correlation_id)
        if specialist_results:
            _specialist_context = "\n\n".join(
                f"### {agent_name}\n{reply}"
                for agent_name, reply in specialist_results.items()
            )
            logger.info(
                "team_specialists_executed",
                extra={"correlation_id": correlation_id, "specialists": list(specialist_results.keys())},
            )
            # Fall through to the regular LLM call with specialist context injected into prompt
        else:
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
    atlassian_enabled_for_agent = ATLASSIAN_MCP_CONFIG.enabled and (
        ("can_use_atlassian" in resolved_capabilities)
        or agent_should_use_atlassian_mcp(
            agent_name=name,
            agent_description=description,
            agent_prompt=prompt_text,
            team_key=team_key,
            tags=list(set(normalize_tag_values(tags) + resolved_domains + resolved_capabilities)),
        )
    )
    jumpcloud_runtime_planner = extract_agent_runtime_planner(runtime_config, "jumpcloud")
    jumpcloud_enabled_for_agent = bool(JUMPCLOUD_SKILLS) and (
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
            for token in ["jumpcloud", "directory insights", "iam", "vision", "directory"]
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
    if atlassian_enabled_for_agent:
        instructions.extend(build_atlassian_response_instructions(allow_write=ATLASSIAN_MCP_CONFIG.allow_write))

    prompt = (
        "Conversation history:\n"
        f"{history_text or 'none'}\n\n"
        "User message:\n"
        f"{message}"
    )
    if _specialist_context:
        prompt += (
            f"\n\nResults collected from specialist agents:\n{_specialist_context}\n\n"
            "Synthesize the above into a clear, direct answer for the user. "
            "Cite which agent provided each fact. Do not repeat the specialist output verbatim."
        )

    falcon_config = build_falcon_mcp_config_from_env()
    falcon_tools = build_falcon_mcp_tools(falcon_config, message=message) if falcon_enabled_for_agent else None

    base_tools = JUMPCLOUD_SKILLS.agno_tools() if JUMPCLOUD_SKILLS else []
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

    if atlassian_enabled_for_agent and requires_atlassian_lookup(message):
        atlassian_tools = build_atlassian_mcp_tools(ATLASSIAN_MCP_CONFIG)
        if atlassian_tools is not None:
            async with atlassian_tools:
                agent = build_agent_instance(
                    name=name,
                    instructions=instructions,
                    advanced=advanced,
                    tools=base_tools + [atlassian_tools],
                    overrides={**kwargs, "add_history_to_context": False, "num_history_sessions": 0},
                )
                return to_text(await agent.arun(prompt)).strip()

    if jumpcloud_enabled_for_agent and requires_jumpcloud_console_lookup(message):
        if JUMPCLOUD_MCP_CONFIG.enabled:
            jc_mcp_tools = build_jumpcloud_mcp_tools(JUMPCLOUD_MCP_CONFIG)
            if jc_mcp_tools is not None:
                async with jc_mcp_tools:
                    agent = build_agent_instance(
                        name=name,
                        instructions=instructions,
                        advanced=advanced,
                        tools=base_tools + [jc_mcp_tools],
                        overrides={**kwargs, "add_history_to_context": False, "num_history_sessions": 0},
                    )
                    return to_text(await agent.arun(prompt)).strip()
        if JUMPCLOUD_SKILLS:
            classified_plan = await infer_jumpcloud_plan_with_skill(
                message=message,
                linked_skills=linked_skills,
                runtime_planner=jumpcloud_runtime_planner,
                advanced=advanced,
            )
            operation_name, operation_args, prefetch_summary = classified_plan or infer_operation_plan(message)
            return JUMPCLOUD_SKILLS.run_prefetch(operation_name, operation_args, prefetch_summary, message)

    if falcon_tools is None:
        agent = build_agent_instance(name=name, instructions=instructions, advanced=advanced, tools=base_tools, overrides=kwargs)
        return to_text(await agent.arun(prompt)).strip()

    async with falcon_tools as mcp_tools:
        allowed_tool_names = resolve_allowed_falcon_tool_names(falcon_config, message=message)

        (
            falcon_list_available_operations,
            falcon_count_hosts,
            falcon_list_hostnames,
            falcon_execute_read_only,
        ) = make_falcon_agent_tools(mcp_tools, serialize_falcon_tool_result, allowed_tool_names)

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
            prefetch_plan = infer_falcon_prefetch_operation(message, allowed_tool_names)
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
app.include_router(observability_router)
JUMPCLOUD_SKILLS = build_jumpcloud_skills_from_env()
JUMPCLOUD_TOOL = JUMPCLOUD_SKILLS._tool if JUMPCLOUD_SKILLS else None
JUMPCLOUD_MCP_CONFIG = build_jumpcloud_mcp_config_from_env()
ATLASSIAN_MCP_CONFIG = build_atlassian_mcp_config_from_env()
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
        "atlassianMcpEnabled": ATLASSIAN_MCP_CONFIG.enabled,
        "atlassianMcpAllowWrite": ATLASSIAN_MCP_CONFIG.allow_write,
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

    result = {
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
    _emit_agent_log(
        "routing_decision",
        chosen_specialist.name if chosen_specialist else "none",
        correlation_id,
        f"Roteamento: {chosen_team.key if chosen_team else 'nenhum time'} → {chosen_specialist.name if chosen_specialist else 'nenhum agente'}",
        {
            "team": chosen_team.key if chosen_team else None,
            "agent": chosen_specialist.name if chosen_specialist else None,
            "confidence": max(0.15, min(0.99, float(confidence))),
            "justification": decision.get("justification", ""),
        },
    )
    return result


@app.post("/chat")
async def chat(req: ChatRequest, request: Request) -> dict[str, Any]:
    correlation_id = get_correlation_id(request)
    _t0_chat = datetime.now(timezone.utc)
    _emit_agent_log(
        "chat_request",
        req.agent.name,
        correlation_id,
        f"Mensagem recebida: {req.message[:200]}{'...' if len(req.message) > 200 else ''}",
        {"messageLength": len(req.message), "historyCount": len(req.history), "agent": req.agent.name},
    )
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
    _duration_ms = int((datetime.now(timezone.utc) - _t0_chat).total_seconds() * 1000)
    _emit_agent_log(
        "chat_response",
        req.agent.name,
        correlation_id,
        f"Resposta gerada em {_duration_ms}ms: {reply[:200]}{'...' if len(reply) > 200 else ''}",
        {
            "durationMs": _duration_ms,
            "replyLength": len(reply),
            "reasoningSummary": reasoning_summary[:4],
            "provider": resolve_provider(req.advanced),
            "model": resolve_model_id(resolve_provider(req.advanced), req.advanced),
        },
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
    team_catalog = build_all_team_catalogs()
    agents: list[dict[str, Any]] = list(team_catalog.get("agents", []))
    tools.extend(team_catalog.get("tools", []))
    skills.extend(team_catalog.get("skills", []))
    workflows.extend(team_catalog.get("workflows", []))

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
                "linkedAgentNames": ["JumpCloud IAM Agent"],
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
                "linkedAgentNames": ["JumpCloud IAM Agent"],
            }
        )

    return {
        "agents": agents,
        "tools": tools,
        "skills": skills,
        "workflows": workflows,
        "knowledgeSources": knowledge_sources,
    }
