from __future__ import annotations

from typing import Any

from utils import normalize_str_list, normalize_tokens


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
    if any(d in resolved_domains for d in ("jira", "confluence", "atlassian", "compass")):
        inferred.add("can_use_atlassian")
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


def fallback_reasoning_summary(agent_type: str, message: str) -> list[str]:
    return fallback_reasoning_summary_for_profile(
        agent_type=agent_type,
        persona=None,
        routing_role=None,
        execution_profile=None,
        message=message,
    )


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


def fallback_chat_reply(agent_type: str, message: str) -> str:
    return fallback_chat_reply_for_profile(
        agent_type=agent_type,
        persona=None,
        routing_role=None,
        execution_profile=None,
        message=message,
    )


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


def behavior_instructions(agent_type: str) -> list[str]:
    return behavior_instructions_for_profile(
        agent_type=agent_type,
        persona=None,
        routing_role=None,
        execution_profile=None,
    )
