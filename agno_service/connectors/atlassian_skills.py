from __future__ import annotations


def requires_atlassian_lookup(message: str) -> bool:
    """Retorna True se a mensagem requer consulta ao Atlassian (Jira, Confluence ou Compass)."""
    lowered = message.strip().lower()
    return any(
        token in lowered
        for token in [
            # Jira
            "jira",
            "ticket",
            "chamado",
            "issue",
            "sprint",
            "backlog",
            "epico",
            "epic",
            "story",
            "bug",
            "task",
            "board",
            "kanban",
            "projeto",
            "project",
            "release",
            "versao",
            # Confluence
            "confluence",
            "wiki",
            "pagina",
            "page",
            "space",
            "espaco",
            "documentacao",
            "documentation",
            "runbook",
            "playbook",
            "knowledge base",
            # Compass
            "compass",
            "component",
            "componente",
            "servico",
            "service",
            "dependencia",
            "dependency",
            # Atlassian generico
            "atlassian",
            "rovo",
        ]
    )


def infer_atlassian_domain(message: str) -> str:
    """Retorna o dominio Atlassian mais provavel para a mensagem: 'jira', 'confluence' ou 'compass'."""
    lowered = message.strip().lower()

    jira_signals = [
        "jira", "ticket", "chamado", "issue", "sprint", "backlog", "board",
        "epico", "epic", "story", "bug", "task", "kanban", "release",
    ]
    confluence_signals = [
        "confluence", "wiki", "pagina", "page", "space", "espaco",
        "documentacao", "documentation", "runbook", "playbook",
    ]
    compass_signals = [
        "compass", "component", "componente", "servico", "service",
        "dependencia", "dependency",
    ]

    scores = {
        "jira": sum(1 for s in jira_signals if s in lowered),
        "confluence": sum(1 for s in confluence_signals if s in lowered),
        "compass": sum(1 for s in compass_signals if s in lowered),
    }
    return max(scores, key=lambda k: scores[k]) if any(scores.values()) else "jira"


def build_atlassian_prefetch_summary(message: str) -> str:
    """Retorna um label descritivo para o dominio detectado na mensagem."""
    domain = infer_atlassian_domain(message)
    labels = {
        "jira": "Consulta Jira",
        "confluence": "Consulta Confluence",
        "compass": "Consulta Compass",
    }
    return labels.get(domain, "Consulta Atlassian")
