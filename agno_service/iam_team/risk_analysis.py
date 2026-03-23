from __future__ import annotations

from .schemas import KnowledgeResult, RiskAssessment, RiskFinding


def assess_iam_risk(*, message: str, knowledge_results: list[KnowledgeResult]) -> RiskAssessment:
    lowered = message.lower()
    findings: list[RiskFinding] = []
    hypotheses: list[str] = []

    if any(token in lowered for token in ["multi", "varios", "muitos"]) and any(token in lowered for token in ["ip", "geo", "pais", "local"]):
        findings.append(
            RiskFinding(
                title="Autenticacoes com multiplos IPs ou geos",
                severity="high",
                confidence="medium",
                summary="O caso sugere padrao de autenticacao inconsistente com uma unica origem previsivel.",
                rationale=["Multiplos IPs/geos sao um sinal frequente de risco em IAM.", "O contexto ainda precisa ser validado com timeline e device posture."],
                evidence_refs=[item.reference or item.source_name for item in knowledge_results[:3]],
                suggested_next_steps=["Correlacionar a janela no JumpCloud e BigQuery.", "Verificar se havia VPN, viagem ou excecao operacional conhecida."],
            )
        )
        hypotheses.append("Pode haver uso indevido de credencial ou origem compartilhada nao documentada.")

    if any(token in lowered for token in ["falha de senha", "senha", "password", "mfa", "failed"]):
        findings.append(
            RiskFinding(
                title="Falhas de autenticacao acima do esperado",
                severity="medium",
                confidence="medium",
                summary="O texto indica possivel excesso de falhas de autenticacao ou atrito de MFA.",
                rationale=["Falhas repetidas podem indicar brute force, credencial expirada ou problema operacional."],
                evidence_refs=[item.reference or item.source_name for item in knowledge_results[:2]],
                suggested_next_steps=["Confirmar volume e origem das falhas.", "Comparar com comportamento historico do usuario."],
            )
        )
        hypotheses.append("Pode ser tentativa automatizada ou usuario preso em credencial antiga.")

    if any(token in lowered for token in ["fora do horario", "janela", "incomum", "atipic", "suspeit"]):
        findings.append(
            RiskFinding(
                title="Comportamento fora do padrao",
                severity="medium",
                confidence="low" if not knowledge_results else "medium",
                summary="Ha indicios de comportamento fora da janela ou do perfil esperado.",
                rationale=["O caso menciona comportamento atipico.", "Sem baseline comportamental, a conclusao deve ser conservadora."],
                evidence_refs=[item.reference or item.source_name for item in knowledge_results[:2]],
                suggested_next_steps=["Cruzar com baseline do usuario.", "Verificar se existe change, incidente ou manutencao relacionados."],
            )
        )
        hypotheses.append("Pode ser atividade legitima, mas exige correlacao com contexto operacional.")

    if not findings:
        findings.append(
            RiskFinding(
                title="Sinais insuficientes para priorizacao forte",
                severity="low",
                confidence="low",
                summary="Os sinais atuais nao permitem um finding forte de risco sem evidencias adicionais.",
                rationale=["A mensagem sozinha nao fecha causalidade.", "O processo correto e coletar telemetria e contexto antes de escalar severidade."],
                evidence_refs=[item.reference or item.source_name for item in knowledge_results[:1]],
                suggested_next_steps=["Consultar JumpCloud e BigQuery.", "Buscar runbooks e incidentes correlatos."],
            )
        )
        hypotheses.append("O caso pode ser apenas ruído operacional ou falta de contexto.")

    highest = max(findings, key=lambda item: ["low", "medium", "high", "critical"].index(item.severity))
    confidence = "high" if len(findings) >= 2 and knowledge_results else "medium" if findings else "low"
    return RiskAssessment(
        overall_severity=highest.severity,
        confidence=confidence,  # type: ignore[arg-type]
        summary=f"Avaliacao inicial de risco com severidade {highest.severity}.",
        findings=findings,
        hypotheses=hypotheses,
        recommended_next_steps=list(dict.fromkeys(step for finding in findings for step in finding.suggested_next_steps))[:6],
    )
