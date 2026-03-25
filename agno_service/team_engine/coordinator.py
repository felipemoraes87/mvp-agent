from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any
import yaml

from .integration_registry import IntegrationConfigRegistry
from .knowledge_layer import search_knowledge
from .memory import InvestigationMemoryStore
from .role_mapping import RoleMappingRule, load_role_mapping_rules, triage_jira_access_request
from .schemas import (
    AgentCapability,
    ChangeProposal,
    DiagnosticResult,
    EvidenceItem,
    ExecutionStep,
    FinalResponse,
    InvestigationPlan,
    KnowledgeQuery,
    TicketTriageResult,
    UserIntent,
    WorkflowDecision,
)
from .workflows import detect_workflow, load_workflows

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Team context cache
# ---------------------------------------------------------------------------

@dataclass
class _TeamContext:
    team_key: str
    config: dict[str, Any]
    agents: list[AgentCapability]
    workflows: list[dict[str, Any]]
    role_mapping_rules: tuple[RoleMappingRule, ...]


_TEAM_CACHE: dict[str, _TeamContext] = {}


def _load_agents_for_team(team_key: str) -> list[AgentCapability]:
    agents_dir = Path(__file__).parent.parent / "config" / "agents"
    capabilities: list[AgentCapability] = []
    for yaml_file in sorted(agents_dir.glob("*.yaml")):
        with open(yaml_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if not isinstance(data, dict):
            raise RuntimeError(f"Arquivo de agente invalido: {yaml_file}")
        agent_team = data.get("team")
        if isinstance(agent_team, list):
            if team_key not in agent_team:
                continue
        elif agent_team != team_key:
            continue
        capabilities.append(AgentCapability(**data))
    if not capabilities:
        raise RuntimeError(f"Nenhum agente encontrado para o time '{team_key}'")
    return capabilities


def _load_team_config(team_key: str) -> dict[str, Any]:
    teams_dir = Path(__file__).parent.parent / "config" / "teams"
    yaml_file = teams_dir / f"{team_key.lower()}.yaml"
    try:
        with open(yaml_file, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except FileNotFoundError:
        raise RuntimeError(f"Configuracao do time nao encontrada: {yaml_file}")
    except yaml.YAMLError as exc:
        raise RuntimeError(f"YAML invalido em {yaml_file}: {exc}")


def _get_team_context(team_key: str) -> _TeamContext:
    if team_key not in _TEAM_CACHE:
        _TEAM_CACHE[team_key] = _TeamContext(
            team_key=team_key,
            config=_load_team_config(team_key),
            agents=_load_agents_for_team(team_key),
            workflows=load_workflows(team_key),
            role_mapping_rules=load_role_mapping_rules(team_key),
        )
    return _TEAM_CACHE[team_key]


def _all_team_keys() -> list[str]:
    teams_dir = Path(__file__).parent.parent / "config" / "teams"
    keys: list[str] = []
    for yaml_file in sorted(teams_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            key = data.get("key")
            if key:
                keys.append(str(key))
        except Exception:
            continue
    return keys


# ---------------------------------------------------------------------------
# Integration helpers
# ---------------------------------------------------------------------------

def maybe_build_integration_setup_prompt(
    *,
    integration_keys: list[str],
    runtime_config: dict[str, Any] | None,
    registry: IntegrationConfigRegistry,
) -> str | None:
    next_missing = registry.next_missing_item(integration_keys, runtime_config=runtime_config)
    if next_missing is None:
        return None
    remaining = ", ".join(next_missing.remaining_fields) if next_missing.remaining_fields else "nenhum"
    secret_hint = "Esse valor e sensivel e deve ser tratado como segredo." if next_missing.secret else "Esse valor nao precisa ser tratado como segredo."
    example = f" Exemplo: {next_missing.example}." if next_missing.example else ""
    return (
        f"Configuracao pendente para a integracao {next_missing.integration_label}.\n"
        f"Preciso primeiro de: {next_missing.field_label}.\n"
        f"Motivo: {next_missing.description}.{example}\n"
        f"{secret_hint}\n"
        f"Depois disso ainda faltarao: {remaining}."
    )


def find_unavailable_integrations(integration_keys: list[str], registry: IntegrationConfigRegistry) -> list[str]:
    return [
        definition.label
        for integration_key in integration_keys
        if (definition := registry.get(integration_key)) is not None and not definition.runtime_available
    ]


def maybe_build_unavailable_integration_prompt(
    *,
    integration_keys: list[str],
    registry: IntegrationConfigRegistry,
) -> str | None:
    unavailable = find_unavailable_integrations(integration_keys, registry)
    if not unavailable:
        return None
    labels = ", ".join(unavailable)
    return (
        "A ferramenta necessaria para esta etapa ainda nao esta disponivel no runtime atual.\n"
        f"Integracoes sem conector operacional: {labels}.\n"
        "Posso continuar com as fontes que ja existem, registrar essa lacuna e indicar os proximos passos manuais sem quebrar o fluxo."
    )


# ---------------------------------------------------------------------------
# Intent classification
# ---------------------------------------------------------------------------

def _classify_intent(message: str, team_config: dict[str, Any]) -> UserIntent:
    lowered = message.lower()
    classifier = team_config.get("intent_classifier", {})
    write_tokens: list[str] = classifier.get("write_triggers", [])
    requires_write = any(token in lowered for token in write_tokens)

    category = "simple_query"
    rationale: list[str] = []

    for cat_def in classifier.get("categories", []):
        name: str = cat_def.get("name", "")
        matched = False
        if "all_of" in cat_def:
            matched = all(any(token in lowered for token in group) for group in cat_def["all_of"])
        elif "any_of" in cat_def:
            matched = any(token in lowered for token in cat_def["any_of"])
        if matched:
            category = name
            rationale.append(cat_def.get("rationale", f"Categoria: {name}."))
            break

    if not rationale:
        if requires_write:
            category = "operational_action"
            rationale.append("A solicitacao menciona acao operacional ou escrita.")
        elif len(lowered.split()) < 4:
            category = "ambiguous"
            rationale.append("Pouco contexto para direcionar com confianca.")
        else:
            rationale.append("Consulta interpretada como diagnostico leve ou leitura.")

    entities = [t.strip(".,") for t in lowered.split() if any(m in t for m in ("user", "usuario", "role", "grupo", "project", "projeto", "access", "acesso"))][:6]
    return UserIntent(
        request=message,
        category=category,  # type: ignore[arg-type]
        entities=entities,
        requires_write=requires_write,
        confidence=0.8 if category != "ambiguous" else 0.35,
        rationale=rationale,
    )


# ---------------------------------------------------------------------------
# Open investigation routing
# ---------------------------------------------------------------------------

def _build_open_investigation(message: str, agents: list[AgentCapability]) -> tuple[WorkflowDecision, list[str]]:
    lowered = message.lower()
    participants = [cap.agent_name for cap in agents if cap.routing_role == "ENTRYPOINT"]
    for cap in agents:
        if cap.routing_role == "ENTRYPOINT":
            continue
        if cap.routing_keywords and any(token in lowered for token in cap.routing_keywords):
            participants.append(cap.agent_name)
    return (
        WorkflowDecision(
            workflow_name=None,
            mode="open_investigation",
            reason="Caso nao mapeado diretamente em playbook; sera tratado como investigacao aberta com os agentes disponiveis.",
        ),
        list(dict.fromkeys(participants)),
    )


def _is_jira_access_request_scenario(message: str, intent: UserIntent, decision: WorkflowDecision) -> bool:
    lowered = message.lower()
    if intent.category == "access_request":
        return True
    if decision.workflow_name == "Jira Access Request Triage":
        return True
    return (
        any(token in lowered for token in ["jira", "ticket", "chamado", "fila"])
        and any(token in lowered for token in ["acesso", "business role", "perfil", "role"])
    )


def _required_integrations(participants: list[str], agents: list[AgentCapability]) -> list[str]:
    cap_map = {cap.agent_name: cap.integration_keys for cap in agents}
    deduped: list[str] = []
    for participant in participants:
        for key in cap_map.get(participant, []):
            if key not in deduped:
                deduped.append(key)
    return deduped


def _build_steps(participants: list[str], integrations: list[str], intent: UserIntent, agents: list[AgentCapability]) -> list[ExecutionStep]:
    entrypoint = next((cap.agent_name for cap in agents if cap.routing_role == "ENTRYPOINT"), participants[0] if participants else "Orchestrator")
    write_agents = {cap.agent_name for cap in agents if cap.can_write}
    related_map = {cap.agent_name: cap.integration_keys for cap in agents}

    steps: list[ExecutionStep] = [
        ExecutionStep(
            id="classify-request",
            title="Classify Request",
            description="Entender a intencao, risco e melhor modo de execucao.",
            agent_name=entrypoint,
            integration_keys=[],
            status="ready",
        )
    ]
    for index, participant in enumerate(participants):
        if participant == entrypoint:
            continue
        access_mode = "write_guarded" if intent.requires_write and participant in write_agents else "read_only"
        steps.append(ExecutionStep(
            id=f"step-{index}",
            title=f"Consult {participant}",
            description=f"Coletar evidencias e fatos com o agente {participant}.",
            agent_name=participant,
            integration_keys=[k for k in related_map.get(participant, []) if k in integrations],
            access_mode=access_mode,  # type: ignore[arg-type]
            status="pending",
        ))
    steps.append(ExecutionStep(
        id="consolidate-response",
        title="Consolidate Findings",
        description="Cruzar evidencias, apontar gaps e consolidar resposta final.",
        agent_name=entrypoint,
        status="pending",
    ))
    return steps


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def handle_team_request(
    *,
    team_key: str,
    agent_name: str,
    runtime_config: dict[str, Any] | None,
    message: str,
    linked_knowledge: list[dict[str, Any]] | None = None,
) -> FinalResponse | None:
    iam_profile = ((runtime_config or {}).get("iamTeamProfile")) or {}
    role = str(iam_profile.get("role", "")).strip().lower()
    if role != "coordinator":
        return None

    ctx = _get_team_context(team_key)
    registry = IntegrationConfigRegistry()
    intent = _classify_intent(message, ctx.config)
    matched_workflow, matched_keywords = detect_workflow(message, ctx.workflows)

    if matched_workflow:
        decision = WorkflowDecision(
            workflow_name=matched_workflow["name"],
            mode="workflow",
            reason="Pedido aderente a um playbook conhecido.",
            matched_keywords=matched_keywords,
        )
        participants = matched_workflow["agents"]
        integrations = matched_workflow["integrations"]
        success_criteria = matched_workflow["success_criteria"]
        failure_handling = matched_workflow["failure_handling"]
    else:
        decision, participants = _build_open_investigation(message, ctx.agents)
        integrations = _required_integrations(participants, ctx.agents)
        success_criteria = [
            "As fontes mais provaveis do caso foram consultadas ou justificadamente omitidas.",
            "A resposta final separa evidencias, inferencias e lacunas.",
        ]
        failure_handling = ["Registrar bloqueios de configuracao ou ausencia de dados sem ocultar incertezas."]

    missing = registry.find_missing_configuration(integrations, runtime_config=runtime_config)
    unavailable = find_unavailable_integrations(integrations, registry)
    plan = InvestigationPlan(
        workflow=decision,
        participating_agents=participants,
        required_integrations=registry.requirements_for(integrations),
        steps=_build_steps(participants, integrations, intent, ctx.agents),
        success_criteria=success_criteria,
        failure_handling=failure_handling,
    )

    knowledge_query = KnowledgeQuery(
        query=message,
        intent=intent.category,
        domains=ctx.config.get("domains", ["iam", "identity", "governance"]),
        source_hints=["processo", "runbook", "exception", "policy"],
        limit=4,
    )
    knowledge_results = search_knowledge(query=knowledge_query, linked_knowledge=linked_knowledge)

    ticket_triage: TicketTriageResult | None = None
    if _is_jira_access_request_scenario(message, intent, decision):
        ticket_triage = triage_jira_access_request(
            message=message,
            knowledge_results=knowledge_results,
            role_mapping_rules=ctx.role_mapping_rules,
            linked_knowledge=linked_knowledge,
        )

    evidence = [EvidenceItem(
        source_type="workflow_catalog",
        source_name=decision.workflow_name or "Open Investigation Planner",
        summary=decision.reason,
        confidence="high" if decision.mode == "workflow" else "medium",
        details={"matched_keywords": decision.matched_keywords},
    )]
    for result in knowledge_results[:3]:
        evidence.append(EvidenceItem(
            source_type=result.source_type,
            source_name=result.source_name,
            summary=result.snippet,
            confidence="high" if result.score >= 0.7 else "medium",
            details={"reference": result.reference, "score": result.score, "title": result.title},
        ))
    if ticket_triage is not None:
        evidence.append(EvidenceItem(
            source_type="ticket_triage",
            source_name="Jira Access Request Intake",
            summary=ticket_triage.summary,
            confidence=ticket_triage.confidence,
            details={
                "classification": ticket_triage.classification,
                "business_role": ticket_triage.business_role,
                "jira_action": ticket_triage.jira_action,
                "iga_action": ticket_triage.iga_action,
                "issue_key": ticket_triage.extracted_context.issue_key,
            },
        ))

    findings = [f"Intencao classificada como {intent.category}.", f"Modo de execucao: {decision.mode}."]
    if ticket_triage is not None:
        findings.append(f"Triagem do ticket: {ticket_triage.classification}.")
        if ticket_triage.business_role:
            findings.append(f"Business role sugerida: {ticket_triage.business_role}.")
    if knowledge_results:
        findings.append(f"Camada de knowledge trouxe {len(knowledge_results)} referencia(s) relevante(s).")

    gaps = [
        *[f"Configuracao pendente em {item.integration_label}: {item.field_label}" for item in missing[:4]],
        *[f"Conector ainda nao disponivel para {label}." for label in unavailable],
    ]
    if ticket_triage is not None and ticket_triage.classification != "fulfillable_access_request":
        gaps.append("O ticket ainda nao esta suficientemente estruturado para automacao segura de acesso.")

    write_agents = {cap.agent_name for cap in ctx.agents if cap.can_write}

    if ticket_triage is not None:
        next_steps = ticket_triage.recommended_steps[:]
        if ticket_triage.classification == "fulfillable_access_request":
            next_steps.insert(0, "Validar o pedido de acesso contra a tabela de business roles antes de acionar o Vision.")
        else:
            next_steps.insert(0, "Responder no Jira com a orientacao correta e bloquear automacao por enquanto.")
    elif missing:
        next_steps = [
            "Solicitar as configuracoes faltantes na ordem correta.",
            "Executar agentes somente depois que as integracoes requeridas estiverem prontas.",
        ]
    else:
        next_steps = [
            "Consultar as fontes planejadas na sequencia definida.",
            "Consolidar as evidencias e retornar gaps e recomendacoes.",
        ]
        if ticket_triage is not None and ticket_triage.classification == "fulfillable_access_request":
            next_steps.insert(0, "Abrir ou preparar requisicao no Vision usando a business role mapeada.")
    if knowledge_results:
        next_steps.append("Usar as referencias documentais recuperadas para validar processo e excecoes.")
    if intent.requires_write and any(p in write_agents for p in participants):
        next_steps.insert(0, "Confirmar aprovacao antes de executar qualquer escrita.")
    if unavailable:
        next_steps.insert(0, f"Tratar as integracoes ainda sem conector operacional como lacuna controlada: {', '.join(unavailable)}.")

    diagnostic = DiagnosticResult(
        summary=f"Plano inicial do time {team_key} preparado com knowledge, triagem e integracoes.",
        findings=findings,
        gaps=gaps,
        next_steps=next_steps[:6],
    )

    change_proposal = None
    if ticket_triage is not None and ticket_triage.classification == "fulfillable_access_request":
        change_proposal = ChangeProposal(
            title="Solicitacao controlada de business role",
            summary=f"Pedido apto para abertura no Vision com a business role {ticket_triage.business_role}.",
            impact="Concessao de acesso via Vision para o usuario alvo.",
            validations=["Confirmar usuario alvo e sistema no ticket Jira.", "Confirmar match unico da tabela de business role."],
            manual_steps=[
                f"Comentar no Jira usando a orientacao operacional para {ticket_triage.business_role}.",
                "Registrar o identificador da solicitacao devolvido pelo Vision no ticket.",
            ],
        )
    elif intent.requires_write and any(p in write_agents for p in participants):
        change_proposal = ChangeProposal(
            title="Proposta de acao com escrita",
            summary="Acao de escrita requer validacao e aprovacao antes da execucao.",
            impact="Alteracao de acesso ou atribuicao de role.",
            validations=["Confirmar usuario alvo e business role com o solicitante.", "Validar se o pedido possui aprovacao necessaria."],
            manual_steps=["Confirmar com o gestor responsavel antes de executar.", "Registrar a acao e o resultado no ticket Jira correspondente."],
        )

    summary = (
        f"{agent_name} classificou o pedido como {intent.category} e selecionou "
        f"{decision.workflow_name or 'open investigation'} com {len(participants)} agente(s) participante(s)."
    )

    InvestigationMemoryStore().append(
        query=message,
        workflow_name=decision.workflow_name,
        participants=plan.participating_agents,
        findings=findings,
        evidence_refs=[item.details.get("reference") for item in evidence if isinstance(item.details.get("reference"), str)] + [item.source_name for item in evidence[:2]],
        tags=list(dict.fromkeys([intent.category, decision.mode])),
    )

    return FinalResponse(
        request_type=intent.category,
        workflow_mode=decision.mode,
        workflow_name=decision.workflow_name,
        summary=summary,
        evidence=evidence,
        diagnostic=diagnostic,
        missing_configuration=missing,
        next_steps=list(dict.fromkeys(next_steps))[:8],
        change_proposal=change_proposal,
        knowledge_results=knowledge_results,
        entitlement_assessment=None,
        risk_assessment=None,
        guarded_action_plan=None,
        ticket_triage=ticket_triage,
        participating_agents=plan.participating_agents,
        plan_steps=plan.steps,
    )


# ---------------------------------------------------------------------------
# Specialist resolution (used by app.py for multi-agent execution)
# ---------------------------------------------------------------------------

def get_specialist_capabilities(team_key: str, message: str) -> list[AgentCapability]:
    """Return non-ENTRYPOINT agents whose routing_keywords match the message."""
    ctx = _get_team_context(team_key)
    _, participants = _build_open_investigation(message, ctx.agents)
    cap_map = {cap.agent_name: cap for cap in ctx.agents}
    return [
        cap_map[name]
        for name in participants
        if name in cap_map and cap_map[name].routing_role != "ENTRYPOINT"
    ]


# ---------------------------------------------------------------------------
# Catalog builders
# ---------------------------------------------------------------------------

def build_team_catalog(team_key: str) -> dict[str, list[dict[str, Any]]]:
    ctx = _get_team_context(team_key)
    workflows: list[dict[str, Any]] = [
        {
            "id": wf["name"].lower().replace(" ", "-"),
            "name": wf["name"],
            "description": wf["objective"],
            "objective": wf["objective"],
            "preconditions": wf["preconditions"],
            "integrationKeys": wf["integrations"],
            "steps": wf["steps"],
            "successCriteria": wf["success_criteria"],
            "outputFormat": wf["output_format"],
            "failureHandling": wf["failure_handling"],
            "setupPoints": wf["setup_points"],
            "enabled": True,
            "visibility": "shared",
            "ownerTeamKey": team_key,
            "managedBy": "agno",
            "runtimeSource": "team-engine",
            "linkedAgentNames": wf["agents"],
        }
        for wf in ctx.workflows
    ]
    tools: list[dict[str, Any]] = [
        {
            "id": f"{team_key.lower()}-integration-setup",
            "name": f"{ctx.config.get('name', team_key)} Integration Setup Flow",
            "description": "Valida requisitos de autenticacao/configuracao para integracoes do time e pede dados na ordem correta.",
            "callName": "integration_setup_flow",
            "type": "internal",
            "policy": "read",
            "transport": "runtime",
            "mode": "real",
            "visibility": "shared",
            "ownerTeamKey": team_key,
            "managedBy": "agno",
            "runtimeSource": "team-engine",
            "linkedAgentNames": [cap.agent_name for cap in ctx.agents if cap.routing_role == "ENTRYPOINT"],
        },
        {
            "id": f"{team_key.lower()}-knowledge-retrieval",
            "name": f"{ctx.config.get('name', team_key)} Knowledge Retrieval",
            "description": "Recupera contexto organizacional, runbooks, excecoes e referencias para o time.",
            "callName": "team_knowledge_retrieval",
            "type": "internal",
            "policy": "read",
            "transport": "runtime",
            "mode": "real",
            "visibility": "shared",
            "ownerTeamKey": team_key,
            "managedBy": "agno",
            "runtimeSource": "team-engine",
            "linkedAgentNames": [cap.agent_name for cap in ctx.agents if "can_query_knowledge" in cap.capabilities],
        },
    ]
    agents: list[dict[str, Any]] = []
    for cap in ctx.agents:
        prompt = "\n".join(cap.instructions) if cap.instructions else cap.summary
        runtime_cfg: dict[str, Any] = {
            "iamTeamProfile": {
                "role": cap.role,
                "teamKey": team_key,
                "domain": cap.role,
                "requiredIntegrations": cap.integration_keys,
            },
            "requiredIntegrations": cap.integration_keys,
            "yamlManaged": True,
        }
        agents.append({
            "name": cap.agent_name,
            "description": cap.description or cap.summary,
            "prompt": prompt,
            "tags": cap.tags,
            "type": cap.agent_type,
            "persona": cap.persona,
            "routingRole": cap.routing_role,
            "executionProfile": cap.execution_profile,
            "capabilities": cap.capabilities,
            "domains": cap.domains,
            "visibility": cap.visibility,
            "integrationKeys": cap.integration_keys,
            "canWrite": cap.can_write,
            "managedBy": "agno",
            "runtimeConfig": runtime_cfg,
            "ownerTeamKey": team_key,
        })
    return {"tools": tools, "skills": [], "workflows": workflows, "agents": agents}


def build_all_team_catalogs() -> dict[str, list[dict[str, Any]]]:
    merged: dict[str, list[dict[str, Any]]] = {"tools": [], "skills": [], "workflows": [], "agents": []}
    for team_key in _all_team_keys():
        try:
            catalog = build_team_catalog(team_key)
        except Exception as exc:
            logger.warning("Falha ao carregar catalogo do time %s: %s", team_key, exc)
            continue
        for key in merged:
            merged[key].extend(catalog.get(key, []))
    return merged
