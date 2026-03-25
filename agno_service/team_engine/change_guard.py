from __future__ import annotations

from .schemas import ApprovalRequirement, ChangeSafetyDecision, GuardedActionPlan

WRITE_TOKENS = ("aplique", "execute", "altere", "grave", "crie", "delete", "remova", "reconcil", "provisione")
SENSITIVE_TOKENS = ("admin", "owner", "prod", "production", "binding", "role", "grant")


def evaluate_change_safety(*, message: str, requires_write: bool) -> GuardedActionPlan:
    lowered = message.lower()
    rationale: list[str] = []
    proposed_actions: list[str] = []
    manual_steps: list[str] = []
    audit_notes: list[str] = []

    if not requires_write and "proposta" not in lowered and "sugira" not in lowered:
        decision = "read_only"
        risk_summary = "O pedido e estritamente diagnostico."
        rationale.append("Nao ha intencao clara de escrita ou alteracao no pedido.")
        approval = ApprovalRequirement(approval_required=False, reason="Consulta somente leitura.")
    elif any(token in lowered for token in SENSITIVE_TOKENS):
        decision = "approval_required"
        risk_summary = "A mudanca potencial envolve privilegio sensivel ou alvo critico."
        rationale.extend(
            [
                "O pedido toca grants, roles ou ambientes sensiveis.",
                "Mudanca automatica nao e segura sem aprovacao humana e validacoes previas.",
            ]
        )
        approval = ApprovalRequirement(
            approval_required=True,
            approver_role="iam_owner_or_security_approver",
            reason="Escopo sensivel ou de alto impacto.",
            blocking_checks=["Confirmar estado atual em todas as fontes.", "Validar impacto em herancas, grupos e dependencias."],
        )
    elif requires_write:
        decision = "propose_only"
        risk_summary = "Existe intencao de escrita, mas o fluxo deve parar em proposta auditavel."
        rationale.append("Escrita operacional deve ser opt-in e passar por guardrail antes de execucao.")
        approval = ApprovalRequirement(
            approval_required=True,
            approver_role="service_owner",
            reason="A acao altera estado operacional.",
            blocking_checks=["Registrar racional e evidencias.", "Solicitar confirmacao explicita antes da execucao."],
        )
    else:
        decision = "safe_to_execute"
        risk_summary = "A etapa aparenta ser segura e limitada, mas ainda deve ser registrada."
        rationale.append("A acao parece de baixo impacto e reversivel.")
        approval = ApprovalRequirement(approval_required=False, reason="Baixo impacto aparente.")

    proposed_actions.extend(
        [
            "Consolidar evidencias antes de qualquer alteracao.",
            "Gerar plano de mudanca com impacto esperado e rollback.",
        ]
    )
    manual_steps.extend(
        [
            "Revisar o racional do coordinator e dos especialistas.",
            "Executar a mudanca apenas apos confirmacao humana quando aplicavel.",
        ]
    )
    audit_notes.extend(
        [
            f"Guard decision: {decision}",
            "Nao executar escrita sensivel por padrao.",
        ]
    )
    return GuardedActionPlan(
        decision=ChangeSafetyDecision(
            decision=decision,  # type: ignore[arg-type]
            risk_summary=risk_summary,
            rationale=rationale,
            approval=approval,
        ),
        proposed_actions=proposed_actions,
        manual_steps=manual_steps,
        audit_notes=audit_notes,
    )
