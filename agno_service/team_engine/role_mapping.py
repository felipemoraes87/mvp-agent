from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .schemas import AccessRequestContext, KnowledgeResult, TicketTriageResult


@dataclass(frozen=True)
class RoleMappingRule:
    request_type: str
    system: str
    business_role: str
    system_keywords: tuple[str, ...]
    request_keywords: tuple[str, ...]
    guidance_comment: str


def load_role_mapping_rules(team_key: str) -> tuple[RoleMappingRule, ...]:
    rules_dir = Path(__file__).parent.parent / "config" / "role_mappings"
    all_rules: list[RoleMappingRule] = []
    for yaml_file in sorted(rules_dir.glob("*.yaml")):
        try:
            with open(yaml_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as exc:
            raise RuntimeError(f"YAML invalido em {yaml_file}: {exc}")
        if data.get("team") != team_key:
            continue
        for item in (data.get("rules") or []):
            if not isinstance(item, dict):
                continue
            system = str(item.get("system") or "").strip().lower()
            business_role = str(item.get("business_role") or "").strip()
            if not system or not business_role:
                continue
            all_rules.append(RoleMappingRule(
                request_type=str(item.get("request_type") or "new_access").strip().lower(),
                system=system,
                business_role=business_role,
                system_keywords=tuple(str(k).lower() for k in (item.get("system_keywords") or [system])),
                request_keywords=tuple(str(k).lower() for k in (item.get("request_keywords") or ["acesso"])),
                guidance_comment=str(item.get("guidance_comment") or f"Informe os dados necessarios para o acesso ao sistema {system}.").strip(),
            ))
    return tuple(all_rules)


def _extract_issue_key(message: str) -> str | None:
    match = re.search(r"\b([A-Z][A-Z0-9]+-\d+)\b", message)
    return match.group(1) if match else None


def _extract_phrase(message: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, message, flags=re.IGNORECASE)
        if match:
            value = match.group(1).strip(" .,:;")
            if value:
                return value
    return None


def extract_access_request_context(message: str) -> AccessRequestContext:
    lowered = message.lower()
    system = _extract_phrase(
        lowered,
        (r"(?:no sistema|na aplicacao|para o sistema|para a aplicacao|no|na)\s+(github|confluence|jira|sap|fiori)\b",),
    )
    for candidate in ("jira", "confluence", "github", "sap", "fiori"):
        if system:
            break
        if candidate in lowered:
            system = "sap" if candidate == "fiori" else candidate
            break

    request_type = "new_access" if any(token in lowered for token in ("novo acesso", "acesso", "liberar", "incluir", "conceder")) else None
    requested_access = _extract_phrase(
        message,
        (
            r"(?:business role|perfil|role)\s+([A-Za-z0-9_.-]+)",
            r"(?:acesso|perfil|role)\s+(?:para|de)\s+([A-Za-z0-9_.-]+)",
        ),
    )
    target_user = _extract_phrase(
        message,
        (
            r"(?:usuario|user)\s+([A-Za-z0-9_.@-]+)",
            r"(?:para o usuario|para a usuaria|para)\s+([A-Za-z0-9_.@-]+)",
        ),
    )
    requester = _extract_phrase(message, (r"(?:solicitante|requester)\s+([A-Za-z0-9_.@-]+)",))
    justification = _extract_phrase(
        message,
        (
            r"(?:justificativa|motivo)\s*[:=-]\s*(.+)$",
            r"(?:porque|pois)\s+(.+)$",
        ),
    )
    return AccessRequestContext(
        issue_key=_extract_issue_key(message),
        requester=requester,
        target_user=target_user,
        system=system,
        request_type=request_type,
        requested_access=requested_access,
        justification=justification,
    )


def _custom_rules(linked_knowledge: list[dict[str, Any]] | None) -> list[RoleMappingRule]:
    custom: list[RoleMappingRule] = []
    for item in linked_knowledge or []:
        mappings = item.get("roleMappings")
        if not isinstance(mappings, list):
            continue
        for mapping in mappings:
            if not isinstance(mapping, dict):
                continue
            request_type = str(mapping.get("request_type") or "new_access").strip().lower()
            system = str(mapping.get("system") or "").strip().lower()
            business_role = str(mapping.get("business_role") or "").strip()
            if not system or not business_role:
                continue
            keywords = mapping.get("keywords") if isinstance(mapping.get("keywords"), list) else []
            request_keywords = mapping.get("request_keywords") if isinstance(mapping.get("request_keywords"), list) else []
            guidance_comment = str(mapping.get("guidance_comment") or f"Informe os dados necessarios para o acesso ao sistema {system}.").strip()
            custom.append(RoleMappingRule(
                request_type=request_type,
                system=system,
                business_role=business_role,
                system_keywords=tuple(str(k).lower() for k in keywords if str(k).strip()) or (system,),
                request_keywords=tuple(str(k).lower() for k in request_keywords if str(k).strip()) or ("acesso",),
                guidance_comment=guidance_comment,
            ))
    return custom


def triage_jira_access_request(
    *,
    message: str,
    knowledge_results: list[KnowledgeResult],
    role_mapping_rules: tuple[RoleMappingRule, ...],
    linked_knowledge: list[dict[str, Any]] | None = None,
) -> TicketTriageResult:
    lowered = message.lower()
    context = extract_access_request_context(message)
    rationale: list[str] = []
    recommended_steps: list[str] = []

    is_jira_ticket_context = any(token in lowered for token in ("jira", "ticket", "chamado", "fila", "issue"))
    has_access_language = any(token in lowered for token in ("acesso", "perfil", "business role", "role", "liberar", "incluir", "conceder"))
    has_guidance_language = any(token in lowered for token in ("duvida", "orientacao", "como", "procedimento"))

    if not is_jira_ticket_context or not has_access_language:
        return TicketTriageResult(
            classification="not_access_request",
            summary="O texto nao parece um ticket Jira de solicitacao de acesso pronto para automacao.",
            confidence="medium",
            guidance_comment="Esse fluxo trata apenas tickets Jira de solicitacao de acesso. Se for duvida operacional, responda com o procedimento correto; se for acesso, informe sistema, usuario alvo e justificativa.",
            jira_action="comment_only",
            extracted_context=context,
            rationale=["Nao encontrei contexto suficiente de ticket Jira combinado com pedido explicito de acesso."],
            recommended_steps=["Responder no ticket com orientacao sobre como abrir uma solicitacao de acesso completa."],
        )

    missing_fields = [field for field in ("system", "target_user") if not getattr(context, field)]
    if has_guidance_language or missing_fields:
        rationale.append("O ticket parece incompleto ou mais proximo de uma duvida operacional do que de uma solicitacao automatizavel.")
        return TicketTriageResult(
            classification="unclear_request",
            summary="O ticket precisa de clarificacao antes de qualquer acao automatica no Vision.",
            confidence="medium" if not missing_fields else "high",
            guidance_comment=(
                "Preciso confirmar se este ticket e uma solicitacao de acesso. "
                "Informe usuario alvo, sistema/aplicacao, business role ou perfil esperado e justificativa de negocio."
            ),
            jira_action="comment_only",
            extracted_context=context,
            rationale=rationale + ([f"Campos obrigatorios ausentes: {', '.join(missing_fields)}."] if missing_fields else []),
            recommended_steps=["Comentar no Jira pedindo os campos faltantes.", "Nao enviar requisicao ao Vision ate haver match confiavel da business role."],
        )

    rules = [*_custom_rules(linked_knowledge), *role_mapping_rules]
    matching_rules = [
        rule for rule in rules
        if context.system == rule.system
        and context.request_type == rule.request_type
        and any(keyword in lowered for keyword in rule.system_keywords)
        and any(keyword in lowered for keyword in rule.request_keywords)
    ]

    if len(matching_rules) != 1:
        reason = "Nenhuma business role foi mapeada de forma deterministica." if not matching_rules else "Mais de uma business role possivel foi encontrada para este ticket."
        return TicketTriageResult(
            classification="unclear_request",
            summary="O ticket nao possui mapeamento deterministico suficiente para automacao segura.",
            confidence="low" if matching_rules else "medium",
            guidance_comment=(
                "Nao consegui determinar uma business role unica para o pedido. "
                "Confirme o sistema, o tipo de acesso e a business role esperada antes da automacao."
            ),
            jira_action="comment_only",
            extracted_context=context,
            rationale=[reason],
            recommended_steps=["Responder no Jira solicitando clarificacao da business role.", "Manter o ticket fora da esteira automatica por enquanto."],
        )

    selected_rule = matching_rules[0]
    rationale.append(f"Match deterministico da tabela de business role para sistema {selected_rule.system}.")
    if knowledge_results:
        rationale.append("A camada de knowledge pode ser usada para reforcar o procedimento e a comunicacao no ticket.")
    recommended_steps.extend([
        f"Abrir requisicao no Vision para a business role {selected_rule.business_role}.",
        "Atualizar o ticket Jira com comentario operacional e identificador da requisicao.",
    ])
    return TicketTriageResult(
        classification="fulfillable_access_request",
        summary=f"O ticket parece uma solicitacao de acesso valida e mapeia para a business role {selected_rule.business_role}.",
        confidence="high",
        business_role=selected_rule.business_role,
        guidance_comment=selected_rule.guidance_comment,
        jira_action="comment_and_transition",
        iga_action="submit_access_request",
        extracted_context=context,
        rationale=rationale,
        recommended_steps=recommended_steps,
    )
