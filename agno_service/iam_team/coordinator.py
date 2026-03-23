from __future__ import annotations

from typing import Any

from .change_guard import evaluate_change_safety
from .entitlement_reasoning import assess_entitlement
from .integration_registry import IntegrationConfigRegistry
from .knowledge_layer import search_knowledge
from .memory import InvestigationMemoryStore
from .role_mapping import triage_jira_access_request
from .risk_analysis import assess_iam_risk
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
from .workflows import detect_workflow, list_workflows

RUNTIME_AVAILABLE_INTEGRATIONS = {"jumpcloud", "findings_store"}


IAM_AGENT_CAPABILITIES: list[AgentCapability] = [
    AgentCapability(
        agent_name="IAM Orchestrator",
        role="coordinator",
        summary="Entende a intencao, escolhe playbook ou investigacao aberta e consolida a resposta.",
        domains=["iam", "identity", "access", "governance"],
    ),
    AgentCapability(
        agent_name="JumpCloud Directory Analyst",
        role="directory_specialist",
        summary="Reutiliza o agente existente para usuarios, grupos, devices e eventos de autenticacao.",
        domains=["jumpcloud", "directory", "identity"],
        reuse_existing_agent=True,
    ),
    AgentCapability(
        agent_name="GitHub IAM Agent",
        role="repo_specialist",
        summary="Investiga roles, bindings, manifests, PRs e mappings em repositorios de IAM/GCP.",
        domains=["github", "gcp", "roles", "policy-as-code"],
    ),
    AgentCapability(
        agent_name="IGA Agent",
        role="iga_specialist",
        summary="Consulta papeis, vinculos, solicitacoes, aprovacoes e reconciliacao no IGA.",
        domains=["iga", "provisioning", "approvals"],
        can_write=True,
    ),
    AgentCapability(
        agent_name="BigQuery IAM/Security Agent",
        role="analytics_specialist",
        summary="Correlaciona eventos e inventarios em BigQuery para investigacoes IAM/Sec.",
        domains=["bigquery", "analytics", "security"],
        can_write=True,
    ),
    AgentCapability(
        agent_name="Jira/Confluence IAM Agent",
        role="documentation_specialist",
        summary="Relaciona tickets, runbooks, excecoes e processos operacionais.",
        domains=["jira", "confluence", "documentation"],
    ),
    AgentCapability(
        agent_name="IAM Knowledge Agent",
        role="knowledge_specialist",
        summary="Consolida contexto documental, processos, glossario e RAG corporativo para IAM.",
        domains=["knowledge", "rag", "documentation", "operations"],
    ),
    AgentCapability(
        agent_name="Entitlement Reasoning Agent",
        role="entitlement_reasoner",
        summary="Classifica a origem e adequacao de acessos, herancas, excecoes e possivel excesso de privilegio.",
        domains=["entitlement", "access_review", "sod", "governance"],
    ),
    AgentCapability(
        agent_name="IAM Risk Analyst",
        role="risk_analyst",
        summary="Transforma sinais IAM em findings priorizados, com severidade, confianca e hipoteses.",
        domains=["risk", "detections", "auth", "analytics"],
    ),
    AgentCapability(
        agent_name="Change Guard / Approval Agent",
        role="change_guard",
        summary="Aplica guardrails antes de qualquer escrita sensivel, exigindo aprovacao quando necessario.",
        domains=["governance", "approval", "change_control"],
        can_write=True,
    ),
]


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
    unavailable: list[str] = []
    for integration_key in integration_keys:
        definition = registry.get(integration_key)
        if definition is None:
            continue
        if integration_key not in RUNTIME_AVAILABLE_INTEGRATIONS:
            unavailable.append(definition.label)
    return unavailable


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


def _classify_intent(message: str) -> UserIntent:
    lowered = message.lower()
    requires_write = any(token in lowered for token in ["dispare", "execute", "aplique", "grave findings", "reconcile", "reconciliacao", "mude", "altere", "remova", "conceda", "libere"])
    category = "simple_query"
    rationale: list[str] = []
    if any(token in lowered for token in ["jira", "chamado", "ticket", "fila"]) and any(token in lowered for token in ["acesso", "business role", "perfil", "role", "liberar", "conceder"]):
        category = "access_request"
        rationale.append("A solicitacao descreve intake ou tratamento de ticket Jira de acesso.")
    elif any(token in lowered for token in ["de onde vem", "origem", "trace", "investigue", "investigar", "correlacione", "suspeit", "root cause", "adequado", "adequacao"]):
        category = "investigation"
        rationale.append("A solicitacao pede rastreio, correlacao ou investigacao.")
    elif any(token in lowered for token in ["compare", "comparar", "diferenca"]):
        category = "comparison"
        rationale.append("A solicitacao pede comparacao entre estados, papeis ou fontes.")
    elif any(token in lowered for token in ["troubleshoot", "nao provisionou", "nao refletiu", "erro", "falha"]):
        category = "troubleshooting"
        rationale.append("A solicitacao indica falha operacional ou diagnostico.")
    elif any(token in lowered for token in ["auditoria", "audit", "review de acesso", "access review"]):
        category = "audit"
        rationale.append("A solicitacao indica revisao ou auditoria de acessos.")
    elif requires_write:
        category = "operational_action"
        rationale.append("A solicitacao menciona acao operacional ou escrita.")
    elif any(token in lowered for token in ["workflow", "playbook", "runbook"]):
        category = "workflow_known"
        rationale.append("A solicitacao cita workflow, runbook ou fluxo conhecido.")
    elif len(lowered.split()) < 4:
        category = "ambiguous"
        rationale.append("Pouco contexto para direcionar com confianca.")
    else:
        rationale.append("Consulta interpretada como diagnostico leve ou leitura.")
    entities = [token.strip(".,") for token in lowered.split() if any(marker in token for marker in ("user", "usuario", "role", "grupo", "project", "projeto", "access", "acesso"))][:6]
    return UserIntent(
        request=message,
        category=category,  # type: ignore[arg-type]
        entities=entities,
        requires_write=requires_write,
        confidence=0.8 if category != "ambiguous" else 0.35,
        rationale=rationale,
    )


def _build_open_investigation(message: str) -> tuple[WorkflowDecision, list[str]]:
    lowered = message.lower()
    participants = ["IAM Orchestrator"]
    if any(token in lowered for token in ["user", "usuario", "group", "grupo", "device", "login", "jumpcloud"]):
        participants.append("JumpCloud Directory Analyst")
    if any(token in lowered for token in ["role", "binding", "repo", "github", "gcp"]):
        participants.append("GitHub IAM Agent")
    if any(token in lowered for token in ["approval", "aprov", "reconc", "iga", "request", "br", "sr"]):
        participants.append("IGA Agent")
    if any(token in lowered for token in ["evento", "event", "history", "historico", "correl", "bigquery", "risk", "suspeit"]):
        participants.append("BigQuery IAM/Security Agent")
    if any(token in lowered for token in ["runbook", "ticket", "jira", "confluence", "document", "processo", "procedimento"]):
        participants.append("Jira/Confluence IAM Agent")
    if any(token in lowered for token in ["document", "processo", "policy", "procedimento", "glossario", "post mortem", "conhecimento"]):
        participants.append("IAM Knowledge Agent")
    if any(token in lowered for token in ["adequado", "excesso", "orf", "sod", "entitlement", "origem", "excecao", "br", "sr"]):
        participants.append("Entitlement Reasoning Agent")
    if any(token in lowered for token in ["risk", "risco", "suspeit", "falha de senha", "ip", "geo", "anomal"]):
        participants.append("IAM Risk Analyst")
    if any(token in lowered for token in ["mude", "altere", "aplique", "execute", "grave", "proposta de mudanca", "precisa aprovacao"]):
        participants.append("Change Guard / Approval Agent")
    return (
        WorkflowDecision(
            workflow_name=None,
            mode="open_investigation",
            reason="Caso nao mapeado diretamente em playbook; sera tratado como investigacao aberta orientada por evidencia.",
        ),
        list(dict.fromkeys(participants)),
    )


def _is_jira_access_request_scenario(message: str, intent: UserIntent, decision: WorkflowDecision) -> bool:
    lowered = message.lower()
    if intent.category == "access_request":
        return True
    if decision.workflow_name == "Jira Access Request Intake Workflow":
        return True
    return any(token in lowered for token in ["jira", "ticket", "chamado", "fila"]) and any(token in lowered for token in ["acesso", "business role", "perfil", "role"])


def _required_integrations(participants: list[str]) -> list[str]:
    mapping = {
        "JumpCloud Directory Analyst": ["jumpcloud"],
        "GitHub IAM Agent": ["github"],
        "IGA Agent": ["iga"],
        "BigQuery IAM/Security Agent": ["bigquery"],
        "Jira/Confluence IAM Agent": ["jira", "confluence"],
        "IAM Knowledge Agent": ["jira", "confluence", "slack", "google_drive"],
        "IAM Risk Analyst": ["jumpcloud", "bigquery", "findings_store"],
        "Entitlement Reasoning Agent": [],
        "Change Guard / Approval Agent": [],
    }
    deduped: list[str] = []
    for participant in participants:
        for integration_key in mapping.get(participant, []):
            if integration_key not in deduped:
                deduped.append(integration_key)
    return deduped


def _build_steps(participants: list[str], integrations: list[str], intent: UserIntent) -> list[ExecutionStep]:
    steps: list[ExecutionStep] = [
        ExecutionStep(
            id="classify-request",
            title="Classify Request",
            description="Entender a intencao, risco e melhor modo de execucao.",
            agent_name="IAM Orchestrator",
            integration_keys=[],
            status="ready",
        )
    ]
    related_map = {
        "JumpCloud Directory Analyst": ["jumpcloud"],
        "GitHub IAM Agent": ["github"],
        "IGA Agent": ["iga"],
        "BigQuery IAM/Security Agent": ["bigquery"],
        "Jira/Confluence IAM Agent": ["jira", "confluence"],
        "IAM Knowledge Agent": ["jira", "confluence", "slack", "google_drive"],
        "Entitlement Reasoning Agent": [],
        "IAM Risk Analyst": ["jumpcloud", "bigquery", "findings_store"],
        "Change Guard / Approval Agent": [],
    }
    for index, participant in enumerate(participants):
        if participant == "IAM Orchestrator":
            continue
        related_integrations = related_map.get(participant, [])
        access_mode = "write_guarded" if intent.requires_write and participant in {"IGA Agent", "BigQuery IAM/Security Agent", "Change Guard / Approval Agent"} else "read_only"
        steps.append(
            ExecutionStep(
                id=f"step-{index}",
                title=f"Consult {participant}",
                description=f"Coletar evidencias e fatos com o agente {participant}.",
                agent_name=participant,
                integration_keys=[key for key in related_integrations if key in integrations],
                access_mode=access_mode,  # type: ignore[arg-type]
                status="pending",
            )
        )
    steps.append(
        ExecutionStep(
            id="consolidate-response",
            title="Consolidate Findings",
            description="Cruzar evidencias, apontar gaps e consolidar resposta final.",
            agent_name="IAM Orchestrator",
            status="pending",
        )
    )
    return steps


def handle_iam_team_request(
    *,
    agent_name: str,
    runtime_config: dict[str, Any] | None,
    message: str,
    linked_knowledge: list[dict[str, Any]] | None = None,
) -> FinalResponse | None:
    iam_profile = ((runtime_config or {}).get("iamTeamProfile")) or {}
    role = str(iam_profile.get("role", "")).strip().lower()
    if role != "coordinator":
        return None

    registry = IntegrationConfigRegistry()
    intent = _classify_intent(message)
    matched_workflow, matched_keywords = detect_workflow(message)
    if matched_workflow:
        decision = WorkflowDecision(
            workflow_name=matched_workflow["name"],
            mode="workflow",
            reason="Pedido aderente a um playbook conhecido de IAM.",
            matched_keywords=matched_keywords,
        )
        participants = matched_workflow["agents"]
        integrations = matched_workflow["integrations"]
        success_criteria = matched_workflow["success_criteria"]
        failure_handling = matched_workflow["failure_handling"]
    else:
        decision, participants = _build_open_investigation(message)
        integrations = _required_integrations(participants)
        success_criteria = [
            "As fontes mais provaveis do caso foram consultadas ou justificadamente omitidas.",
            "A resposta final separa evidencias, inferencias e lacunas.",
        ]
        failure_handling = [
            "Registrar bloqueios de configuracao ou ausencia de dados sem ocultar incertezas.",
        ]

    missing = registry.find_missing_configuration(integrations, runtime_config=runtime_config)
    unavailable = find_unavailable_integrations(integrations, registry)
    available_integration_keys = [item.key for item in registry.requirements_for(integrations) if item.label not in unavailable]
    plan = InvestigationPlan(
        workflow=decision,
        participating_agents=participants,
        required_integrations=registry.requirements_for(integrations),
        steps=_build_steps(participants, integrations, intent),
        success_criteria=success_criteria,
        failure_handling=failure_handling,
    )

    knowledge_query = KnowledgeQuery(
        query=message,
        intent=intent.category,
        domains=["iam", "identity", "governance"],
        source_hints=["processo", "runbook", "exception", "policy"],
        limit=4,
    )
    knowledge_results = search_knowledge(query=knowledge_query, linked_knowledge=linked_knowledge)
    ticket_triage: TicketTriageResult | None = None
    if _is_jira_access_request_scenario(message, intent, decision):
        ticket_triage = triage_jira_access_request(
            message=message,
            knowledge_results=knowledge_results,
            linked_knowledge=linked_knowledge,
        )

    entitlement_assessment = None
    if any(agent in participants for agent in ["Entitlement Reasoning Agent", "IAM Knowledge Agent"]) or any(token in message.lower() for token in ["adequado", "excesso", "origem", "orf", "sod", "excecao"]):
        entitlement_assessment = assess_entitlement(
            message=message,
            knowledge_results=knowledge_results,
            available_integrations=available_integration_keys,
            missing_integrations=[item.integration_label for item in missing],
        )
    risk_assessment = None
    if "IAM Risk Analyst" in participants or any(token in message.lower() for token in ["risco", "suspeit", "ip", "falha de senha", "anomal"]):
        risk_assessment = assess_iam_risk(message=message, knowledge_results=knowledge_results)
    guarded_action_plan = evaluate_change_safety(message=message, requires_write=intent.requires_write)

    evidence = [
        EvidenceItem(
            source_type="workflow_catalog",
            source_name=decision.workflow_name or "Open Investigation Planner",
            summary=decision.reason,
            confidence="high" if decision.mode == "workflow" else "medium",
            details={"matched_keywords": decision.matched_keywords},
        )
    ]
    for result in knowledge_results[:3]:
        evidence.append(
            EvidenceItem(
                source_type=result.source_type,
                source_name=result.source_name,
                summary=result.snippet,
                confidence="high" if result.score >= 0.7 else "medium",
                details={"reference": result.reference, "score": result.score, "title": result.title},
            )
        )
    if entitlement_assessment is not None:
        evidence.append(
            EvidenceItem(
                source_type="entitlement_reasoning",
                source_name="Entitlement Reasoning Agent",
                summary=entitlement_assessment.summary,
                confidence=entitlement_assessment.confidence,
                details={"classification": entitlement_assessment.classification, "access_path": entitlement_assessment.access_path},
            )
        )
    if risk_assessment is not None:
        evidence.append(
            EvidenceItem(
                source_type="risk_assessment",
                source_name="IAM Risk Analyst",
                summary=risk_assessment.summary,
                confidence=risk_assessment.confidence,
                details={"overall_severity": risk_assessment.overall_severity, "findings": [finding.title for finding in risk_assessment.findings]},
            )
        )
    if ticket_triage is not None:
        evidence.append(
            EvidenceItem(
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
            )
        )

    findings = [
        f"Intencao classificada como {intent.category}.",
        f"Modo de execucao: {decision.mode}.",
    ]
    if ticket_triage is not None:
        findings.append(f"Triagem do ticket: {ticket_triage.classification}.")
        if ticket_triage.business_role:
            findings.append(f"Business role sugerida: {ticket_triage.business_role}.")
    if entitlement_assessment is not None:
        findings.append(f"Classificacao de acesso: {entitlement_assessment.classification}.")
    if risk_assessment is not None:
        findings.append(f"Severidade inicial de risco: {risk_assessment.overall_severity}.")
    if knowledge_results:
        findings.append(f"Camada de knowledge trouxe {len(knowledge_results)} referencia(s) relevante(s).")

    gaps = [
        *[f"Configuracao pendente em {item.integration_label}: {item.field_label}" for item in missing[:4]],
        *[f"Conector ainda nao disponivel para {label}." for label in unavailable],
    ]
    if entitlement_assessment is not None and entitlement_assessment.classification == "insufficient_evidence":
        gaps.append("As evidencias atuais ainda nao suportam uma classificacao forte de adequacao do acesso.")
    if ticket_triage is not None and ticket_triage.classification != "fulfillable_access_request":
        gaps.append("O ticket ainda nao esta suficientemente estruturado para automacao segura de acesso.")

    next_steps = [
        "Solicitar as configuracoes faltantes na ordem correta.",
        "Executar agentes somente depois que as integracoes requeridas estiverem prontas.",
    ]
    if ticket_triage is not None:
        next_steps = ticket_triage.recommended_steps[:]
        if ticket_triage.classification == "fulfillable_access_request":
            next_steps.insert(0, "Validar o pedido de acesso contra a tabela de business roles antes de acionar o IGA.")
        else:
            next_steps.insert(0, "Responder no Jira com a orientacao correta e bloquear automacao por enquanto.")
    if knowledge_results:
        next_steps.append("Usar as referencias documentais recuperadas para validar processo e excecoes.")
    if entitlement_assessment is not None:
        next_steps.extend(entitlement_assessment.recommended_actions[:2])
    if risk_assessment is not None:
        next_steps.extend(risk_assessment.recommended_next_steps[:2])
    if guarded_action_plan.decision.approval.approval_required:
        next_steps.insert(0, "Passar pela barreira de Change Guard antes de qualquer escrita sensivel.")
    if unavailable:
        next_steps.insert(
            0,
            f"Tratar as integracoes ainda sem conector operacional como lacuna controlada: {', '.join(unavailable)}.",
        )
    if not missing:
        next_steps = [
            "Consultar as fontes planejadas na sequencia definida.",
            "Consolidar as evidencias e retornar gaps, riscos e recomendacoes.",
        ]
        if knowledge_results:
            next_steps.append("Usar as referencias documentais como suporte explicito da resposta.")
        if guarded_action_plan.decision.approval.approval_required:
            next_steps.append("Parar em proposta auditavel e solicitar aprovacao humana antes de qualquer execucao.")
        if unavailable:
            next_steps.insert(0, f"Seguir com as fontes disponiveis e registrar lacunas para: {', '.join(unavailable)}.")
        if ticket_triage is not None and ticket_triage.classification == "fulfillable_access_request":
            next_steps.insert(0, "Abrir ou preparar requisicao no IGA usando a business role mapeada.")

    diagnostic = DiagnosticResult(
        summary="Plano inicial do IAM Team preparado com knowledge, reasoning, risk e guardrails.",
        findings=findings,
        gaps=gaps,
        next_steps=next_steps[:6],
    )
    change_proposal = None
    if guarded_action_plan.decision.decision in {"propose_only", "approval_required"} or decision.workflow_name in {"Controlled Change Proposal", "Controlled Change with Guardrails"}:
        change_proposal = ChangeProposal(
            title="Proposta de mudanca controlada",
            summary="Mudanca sugerida de forma nao automatica, condicionada a validacoes, guardrails e aprovacao explicita.",
            impact=guarded_action_plan.decision.risk_summary,
            validations=[
                "Confirmar estado atual em todas as fontes relevantes.",
                "Validar impacto em grupos, roles, bindings e herancas.",
                *guarded_action_plan.decision.approval.blocking_checks[:2],
            ],
            manual_steps=guarded_action_plan.manual_steps[:4],
        )
    if ticket_triage is not None and ticket_triage.classification == "fulfillable_access_request":
        change_proposal = ChangeProposal(
            title="Solicitacao controlada de business role",
            summary=f"Pedido apto para abertura no IGA com a business role {ticket_triage.business_role}.",
            impact=guarded_action_plan.decision.risk_summary,
            validations=[
                "Confirmar usuario alvo e sistema no ticket Jira.",
                "Confirmar match unico da tabela de business role.",
                *guarded_action_plan.decision.approval.blocking_checks[:2],
            ],
            manual_steps=[
                f"Comentar no Jira usando a orientacao operacional para {ticket_triage.business_role}.",
                "Registrar o identificador da solicitacao devolvido pelo IGA no ticket.",
                *guarded_action_plan.manual_steps[:2],
            ],
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
        tags=list(dict.fromkeys([intent.category, decision.mode, *(entitlement_assessment.access_path if entitlement_assessment else []), *(["risk"] if risk_assessment else [])])),
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
        entitlement_assessment=entitlement_assessment,
        risk_assessment=risk_assessment,
        guarded_action_plan=guarded_action_plan,
        ticket_triage=ticket_triage,
        participating_agents=plan.participating_agents,
        plan_steps=plan.steps,
    )


def build_iam_team_catalog() -> dict[str, list[dict[str, Any]]]:
    workflows: list[dict[str, Any]] = []
    for workflow in list_workflows():
        workflows.append(
            {
                "id": workflow["name"].lower().replace(" ", "-"),
                "name": workflow["name"],
                "description": workflow["objective"],
                "objective": workflow["objective"],
                "preconditions": workflow["preconditions"],
                "integrationKeys": workflow["integrations"],
                "steps": workflow["steps"],
                "successCriteria": workflow["success_criteria"],
                "outputFormat": workflow["output_format"],
                "failureHandling": workflow["failure_handling"],
                "setupPoints": workflow["setup_points"],
                "enabled": True,
                "visibility": "shared",
                "ownerTeamKey": "IAM_IGA",
                "managedBy": "agno",
                "runtimeSource": "iam-team",
                "linkedAgentNames": workflow["agents"],
            }
        )
    tools = [
        {
            "id": "iam-integration-setup",
            "name": "IAM Integration Setup Flow",
            "description": "Valida requisitos de autenticacao/configuracao para integracoes do IAM Team e pede dados na ordem correta.",
            "callName": "integration_setup_flow",
            "type": "internal",
            "policy": "read",
            "transport": "runtime",
            "mode": "real",
            "visibility": "shared",
            "ownerTeamKey": "IAM_IGA",
            "managedBy": "agno",
            "runtimeSource": "iam-team",
            "linkedAgentNames": ["IAM Orchestrator"],
        },
        {
            "id": "iam-knowledge-retrieval",
            "name": "IAM Knowledge Retrieval",
            "description": "Recupera contexto organizacional, runbooks, excecoes e referencias para o IAM Team.",
            "callName": "iam_knowledge_retrieval",
            "type": "internal",
            "policy": "read",
            "transport": "runtime",
            "mode": "real",
            "visibility": "shared",
            "ownerTeamKey": "IAM_IGA",
            "managedBy": "agno",
            "runtimeSource": "iam-team",
            "linkedAgentNames": ["IAM Knowledge Agent", "IAM Orchestrator"],
        },
    ]
    return {"tools": tools, "skills": [], "workflows": workflows}
