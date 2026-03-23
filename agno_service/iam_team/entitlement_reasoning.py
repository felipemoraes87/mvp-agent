from __future__ import annotations

import re

from .schemas import EntitlementAssessment, KnowledgeResult


def _refs(results: list[KnowledgeResult]) -> list[str]:
    refs = []
    for result in results:
        reference = result.reference or result.source_name
        if reference not in refs:
            refs.append(reference)
    return refs[:5]


def assess_entitlement(
    *,
    message: str,
    knowledge_results: list[KnowledgeResult],
    available_integrations: list[str],
    missing_integrations: list[str],
) -> EntitlementAssessment:
    lowered = message.lower()
    rationale: list[str] = []
    recommended_actions: list[str] = []
    access_path: list[str] = []

    if "grupo" in lowered or "group" in lowered:
        access_path.append("group_membership")
    if any(token in lowered for token in ["br", "birthright"]):
        access_path.append("birthright_role")
    if any(token in lowered for token in ["sr", "solicit", "request", "aprov"]):
        access_path.append("service_request_or_approval")
    if any(token in lowered for token in ["exce", "exception"]):
        access_path.append("documented_exception")

    if any(token in lowered for token in ["sod", "segreg", "conflito"]):
        classification = "potential_sod_conflict"
        rationale.append("A consulta menciona segregacao de funcao ou conflito potencial.")
        recommended_actions.extend(["Validar matriz de SoD.", "Confirmar aprovacoes e mitigacoes existentes."])
    elif any(token in lowered for token in ["orf", "orphan", "sem dono"]):
        classification = "orphaned_access"
        rationale.append("Ha indicio textual de vinculo sem owner claro ou fora do processo.")
        recommended_actions.extend(["Confirmar owner do acesso.", "Revisar reconciliação e desvinculos pendentes."])
    elif any(token in lowered for token in ["excess", "admin", "owner", "privilegio"]):
        classification = "overprivileged_access"
        rationale.append("A solicitacao aponta para privilegio acima do necessario ou role ampla.")
        recommended_actions.extend(["Comparar com baseline do papel.", "Avaliar remocao ou reducao de grant."])
    elif any(token in lowered for token in ["exce", "exception"]) and knowledge_results:
        classification = "justified_exception"
        rationale.append("Existe mencao a excecao e a camada de conhecimento trouxe contexto relacionado.")
        recommended_actions.extend(["Revalidar prazo e aprovador da excecao.", "Checar se a excecao continua necessaria."])
    elif missing_integrations:
        classification = "insufficient_evidence"
        rationale.append("Ainda faltam fontes essenciais para concluir a adequacao do acesso com seguranca.")
        recommended_actions.extend(["Completar configuracao das integracoes faltantes.", "Cruzar evidencias antes de classificar definitivamente."])
    elif knowledge_results:
        classification = "expected_access"
        rationale.append("A documentacao recuperada sugere aderencia a processo ou baseline esperado.")
        recommended_actions.append("Confirmar a trilha final no IGA ou GitHub para fechar a evidência.")
    elif {"jumpcloud", "iga"} & set(available_integrations):
        classification = "undocumented_access"
        rationale.append("Ha fontes operacionais previstas, mas nenhuma referencia documental foi encontrada para suportar o acesso.")
        recommended_actions.extend(["Buscar excecao formal.", "Registrar lacuna documental caso o acesso seja mantido."])
    else:
        classification = "insufficient_evidence"
        rationale.append("Nao ha evidencias suficientes para afirmar a origem ou adequacao do acesso.")
        recommended_actions.append("Coletar mais evidencias em JumpCloud, IGA, GitHub e base documental.")

    if not access_path:
        entities = re.findall(r"(grupo|role|binding|grant|exception|br|sr)", lowered)
        access_path = entities[:4]

    return EntitlementAssessment(
        classification=classification,  # type: ignore[arg-type]
        summary=f"Classificacao inicial de entitlement: {classification}.",
        rationale=rationale,
        evidence_refs=_refs(knowledge_results),
        access_path=access_path,
        confidence="high" if knowledge_results and not missing_integrations else "medium" if knowledge_results or available_integrations else "low",
        recommended_actions=recommended_actions,
    )
