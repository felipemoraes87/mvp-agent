from __future__ import annotations

from typing import Any


IAM_WORKFLOWS: list[dict[str, Any]] = [
    {
        "name": "Access Trace Workflow",
        "objective": "Descobrir de onde um acesso vem, da origem logica ate a evidencia operacional.",
        "preconditions": ["Identificador de usuario, grupo, role, projeto ou sistema-alvo."],
        "integrations": ["jumpcloud", "iga", "github", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "JumpCloud Directory Analyst",
            "GitHub IAM Agent",
            "IGA Agent",
            "IAM Knowledge Agent",
            "Entitlement Reasoning Agent",
        ],
        "steps": [
            "Identificar usuario, role, grupo e alvo do acesso.",
            "Consultar memberships e estado atual no JumpCloud.",
            "Verificar atribuicoes, BRs, excecoes e aprovacoes no IGA.",
            "Ler mappings de repositorios IAM/GCP no GitHub.",
            "Recuperar contexto documental e excecoes oficiais com o IAM Knowledge Agent.",
            "Classificar a origem e adequacao preliminar com o Entitlement Reasoning Agent.",
            "Consolidar cadeia de origem, evidencias e gaps.",
        ],
        "success_criteria": [
            "Cadeia de origem do acesso identificada.",
            "Cada elo relevante tem evidencia ou gap declarado.",
        ],
        "output_format": "origem do acesso, classificacao de adequacao, evidencias, lacunas, proximos passos",
        "failure_handling": [
            "Se uma integracao estiver indisponivel, registrar lacuna e seguir com as demais.",
            "Nao concluir causalidade forte sem evidencia cruzada.",
        ],
        "setup_points": [
            "Solicitar configuracao de JumpCloud antes de consultar memberships.",
            "Solicitar GitHub/IGA/Jira/Confluence na ordem em que forem exigidos pelo plano.",
        ],
        "match_keywords": ["de onde vem", "origem do acesso", "trace", "role", "binding", "permissao"],
    },
    {
        "name": "User Access Review Workflow",
        "objective": "Consolidar acessos de um usuario e destacar pontos de atencao.",
        "preconditions": ["Identificador do usuario."],
        "integrations": ["jumpcloud", "iga", "github", "bigquery"],
        "agents": [
            "IAM Orchestrator",
            "JumpCloud Directory Analyst",
            "IGA Agent",
            "GitHub IAM Agent",
            "BigQuery IAM/Security Agent",
            "Entitlement Reasoning Agent",
            "IAM Risk Analyst",
        ],
        "steps": [
            "Coletar grupos, devices e sinais de diretorio no JumpCloud.",
            "Consultar papeis, vinculos e aprovacoes no IGA.",
            "Correlacionar mappings e repositorios relevantes no GitHub.",
            "Buscar sinais analiticos e historico no BigQuery.",
            "Avaliar adequacao e possivel excesso de privilegio.",
            "Priorizar riscos e consolidar pontos de atencao.",
        ],
        "success_criteria": [
            "Inventario consolidado de acessos entregue.",
            "Excecoes, excesso de privilegio e lacunas sinalizados.",
        ],
        "output_format": "visao consolidada, classificacao de adequacao, riscos, recomendacoes",
        "failure_handling": [
            "Marcar fonte nao consultada quando configuracao estiver ausente.",
        ],
        "setup_points": [
            "Pedir JumpCloud e IGA primeiro.",
            "Pedir GitHub e BigQuery conforme necessidade de correlacao.",
        ],
        "match_keywords": ["review de acesso", "access review", "revisar acessos", "acessos do usuario"],
    },
    {
        "name": "Suspicious Authentication Investigation",
        "objective": "Investigar autenticacoes suspeitas ou comportamento anomalo.",
        "preconditions": ["Usuario, device ou janela temporal."],
        "integrations": ["jumpcloud", "bigquery", "jira", "confluence", "slack"],
        "agents": [
            "IAM Orchestrator",
            "JumpCloud Directory Analyst",
            "BigQuery IAM/Security Agent",
            "IAM Risk Analyst",
            "IAM Knowledge Agent",
            "Jira/Confluence IAM Agent",
        ],
        "steps": [
            "Consultar eventos e padroes recentes no JumpCloud.",
            "Correlacionar atividade e contexto analitico no BigQuery.",
            "Recuperar runbooks, incidentes e contexto operacional.",
            "Classificar risco, severidade e hipoteses com o IAM Risk Analyst.",
            "Consolidar hipotese, evidencias e proximos passos.",
        ],
        "success_criteria": [
            "Padrao suspeito descrito com evidencias.",
            "Hipoteses e gaps separados claramente.",
        ],
        "output_format": "timeline resumida, findings, severidade, hipoteses, proximos passos",
        "failure_handling": [
            "Sem telemetria suficiente, retornar insuficiencia de evidencia em vez de conclusao forte.",
        ],
        "setup_points": [
            "Pedir JumpCloud antes da telemetria principal.",
            "Pedir BigQuery, Jira/Confluence e Slack conforme o caso exija contexto adicional.",
        ],
        "match_keywords": ["autenticacao suspeita", "login suspeito", "muitos ips", "falha de senha", "risk", "analise o risco", "risco"],
    },
    {
        "name": "Provisioning / Reconciliation Diagnostic",
        "objective": "Entender por que o acesso nao refletiu corretamente na cadeia de provisionamento.",
        "preconditions": ["Usuario ou role afetada e alvo esperado."],
        "integrations": ["iga", "github", "jumpcloud", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "IGA Agent",
            "GitHub IAM Agent",
            "JumpCloud Directory Analyst",
            "IAM Knowledge Agent",
            "Entitlement Reasoning Agent",
        ],
        "steps": [
            "Confirmar estado esperado e real do acesso.",
            "Consultar status de atribuicoes e reconciliacao no IGA.",
            "Revisar mapping ou policy-as-code relevante no GitHub.",
            "Confirmar propagacao no JumpCloud.",
            "Usar documentacao para localizar o ponto correto do fluxo.",
            "Consolidar onde a cadeia falhou e se o acesso ficou orfao, incompleto ou fora do processo.",
        ],
        "success_criteria": [
            "Ponto mais provavel da falha identificado.",
            "Proximos passos manuais ou de follow-up definidos.",
        ],
        "output_format": "ponto de falha, evidencias, classificacao, proximos passos",
        "failure_handling": [
            "Se o sistema de destino nao estiver disponivel, explicar a incerteza resultante.",
        ],
        "setup_points": [
            "Pedir IGA antes de investigar reconciliacao.",
            "Solicitar GitHub e JumpCloud conforme os elos da cadeia forem validados.",
        ],
        "match_keywords": ["nao provisionou", "nao refletiu", "reconciliacao", "provisioning", "diagnostic"],
    },
    {
        "name": "Documentation-Assisted Troubleshooting",
        "objective": "Usar documentacao e tickets para acelerar troubleshooting operacional.",
        "preconditions": ["Descricao do problema e, quando possivel, sistema ou role afetada."],
        "integrations": ["jira", "confluence", "slack", "google_drive"],
        "agents": [
            "IAM Orchestrator",
            "IAM Knowledge Agent",
            "Jira/Confluence IAM Agent",
        ],
        "steps": [
            "Recuperar runbooks, processos, post-mortems e excecoes relevantes.",
            "Consultar tickets e mudancas correlatas.",
            "Trazer procedimento oficial e variacoes historicas que possam explicar o problema.",
            "Consolidar orientacao de troubleshooting com referencias.",
        ],
        "success_criteria": [
            "Procedimento oficial resumido com referencias.",
            "Documentacao, ticket ou lacuna documental apontados claramente.",
        ],
        "output_format": "procedimento, referencias, lacunas, proximos passos",
        "failure_handling": [
            "Se nao houver documentacao confiavel, registrar explicitamente a lacuna.",
        ],
        "setup_points": [
            "Pedir Jira/Confluence primeiro.",
            "Solicitar Slack ou Google Drive apenas se o caso exigir contexto fora das fontes principais.",
        ],
        "match_keywords": ["runbook", "documentacao", "procedimento", "troubleshooting", "como faz"],
    },
    {
        "name": "Controlled Change Proposal",
        "objective": "Gerar proposta de mudanca segura, com impacto esperado e validacoes antes de qualquer execucao.",
        "preconditions": ["Mudanca desejada e alvo claramente descritos."],
        "integrations": ["github", "iga", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "GitHub IAM Agent",
            "IGA Agent",
            "Entitlement Reasoning Agent",
            "Change Guard / Approval Agent",
        ],
        "steps": [
            "Confirmar o estado atual e a necessidade da mudanca.",
            "Coletar mappings ou workflows afetados em GitHub e IGA.",
            "Avaliar adequacao do acesso e impacto da alteracao.",
            "Submeter a intencao ao Change Guard.",
            "Retornar proposta auditavel, validacoes e necessidade de aprovacao.",
        ],
        "success_criteria": [
            "Proposta de mudanca estruturada sem execucao automatica.",
            "Necessidade de aprovacao e impactos declarados.",
        ],
        "output_format": "proposta, impacto, validacoes, aprovacao, proximos passos",
        "failure_handling": [
            "Bloquear escrita automatica em caso de incerteza ou alto impacto.",
        ],
        "setup_points": [
            "Pedir GitHub e IGA antes de montar proposta.",
            "Consultar Jira/Confluence se for necessario validar processo ou CAB.",
        ],
        "match_keywords": ["proposta de mudanca", "ajuste de permissao", "prepare mudanca", "pr sugerido"],
    },
    {
        "name": "Entitlement Root Cause Analysis",
        "objective": "Determinar a origem real do acesso e classificar sua adequacao.",
        "preconditions": ["Usuario, grupo, entitlement ou recurso-alvo definidos."],
        "integrations": ["jumpcloud", "iga", "github", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "JumpCloud Directory Analyst",
            "IGA Agent",
            "GitHub IAM Agent",
            "IAM Knowledge Agent",
            "Entitlement Reasoning Agent",
        ],
        "steps": [
            "Coletar evidencias operacionais e de policy.",
            "Recuperar contexto organizacional e excecoes conhecidas.",
            "Montar a cadeia de origem do acesso.",
            "Classificar expected, exception, orphaned, undocumented ou overprivileged.",
        ],
        "success_criteria": [
            "Origem real do acesso explicada.",
            "Classificacao de adequacao entregue com racional.",
        ],
        "output_format": "cadeia de origem, classificacao, evidencias, gaps, acoes recomendadas",
        "failure_handling": ["Se faltarem fontes criticas, retornar insufficient_evidence."],
        "setup_points": ["Pedir configuracao das fontes na ordem em que a cadeia exigir."],
        "match_keywords": ["origem real do acesso", "adequado", "adequacao do acesso", "entitlement", "de onde vem esse acesso"],
    },
    {
        "name": "Access Adequacy Review",
        "objective": "Revisar se o acesso parece apropriado, excessivo, orfao ou fora do processo.",
        "preconditions": ["Usuario, grupo ou role em analise."],
        "integrations": ["jumpcloud", "iga", "github", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "Entitlement Reasoning Agent",
            "IAM Knowledge Agent",
            "JumpCloud Directory Analyst",
            "IGA Agent",
            "GitHub IAM Agent",
        ],
        "steps": [
            "Comparar acesso atual com baseline operacional e documental.",
            "Avaliar grants diretos, herancas, excecoes e BR/SR.",
            "Classificar a adequacao e apontar gaps.",
        ],
        "success_criteria": [
            "Classificacao de adequacao entregue.",
            "Acoes recomendadas e lacunas documentadas.",
        ],
        "output_format": "classificacao, racional, evidencias, recomendacoes",
        "failure_handling": ["Sem baseline ou processo claro, rotular como undocumented_access ou insufficient_evidence."],
        "setup_points": ["Pedir as fontes que sustentam a adequacao antes de concluir."],
        "match_keywords": ["privilgio excessivo", "orfao", "excecao", "adequado", "acesso parece apropriado", "privilegio parece excessivo"],
    },
    {
        "name": "IAM Risk Triage",
        "objective": "Transformar sinais IAM em findings priorizados com severidade, confianca e proximos passos.",
        "preconditions": ["Sinais, usuario, device ou janela temporal."],
        "integrations": ["jumpcloud", "bigquery", "jira", "confluence", "cloud_logging", "findings_store"],
        "agents": [
            "IAM Orchestrator",
            "JumpCloud Directory Analyst",
            "BigQuery IAM/Security Agent",
            "IAM Risk Analyst",
            "IAM Knowledge Agent",
        ],
        "steps": [
            "Coletar telemetria e sinais operacionais.",
            "Correlacionar com baseline e contexto processual.",
            "Gerar findings com severidade, confianca e hipoteses.",
            "Persistir findings apenas se explicitamente autorizado.",
        ],
        "success_criteria": [
            "Findings priorizados e racional explicito.",
            "Proximos passos operacionais claros.",
        ],
        "output_format": "findings, severidade, confianca, hipoteses, proximos passos",
        "failure_handling": ["Se nao houver telemetria suficiente, reduzir confianca e evitar conclusao forte."],
        "setup_points": ["Pedir JumpCloud e BigQuery primeiro; findings_store so quando houver autorizacao de persistencia."],
        "match_keywords": ["risk triage", "classifique o risco", "finding", "severidade", "autenticacao suspeita"],
    },
    {
        "name": "Knowledge-Assisted Investigation",
        "objective": "Usar a camada de conhecimento organizacional como apoio explicito de investigacao.",
        "preconditions": ["Pergunta operacional ou investigativa com necessidade de contexto."],
        "integrations": ["jira", "confluence", "slack", "google_drive"],
        "agents": [
            "IAM Orchestrator",
            "IAM Knowledge Agent",
            "Jira/Confluence IAM Agent",
        ],
        "steps": [
            "Buscar runbooks, glossario, post-mortems, tickets e contexto recente.",
            "Resumir procedimento oficial e excecoes historicas.",
            "Anexar evidencias documentais para suportar a investigacao principal.",
        ],
        "success_criteria": [
            "Contexto documental relevante entregue com referencias.",
        ],
        "output_format": "resumo documental, evidencias, referencias, implicacoes para o caso",
        "failure_handling": ["Sem material relevante, declarar explicitamente a ausencia de contexto formal."],
        "setup_points": ["Pedir Jira/Confluence primeiro; Slack e Drive apenas como complemento."],
        "match_keywords": ["use a documentacao", "procedimento correto", "contexto operacional", "knowledge"],
    },
    {
        "name": "Controlled Change with Guardrails",
        "objective": "Preparar uma mudanca segura com risco, impacto, validacoes e aprovacao humana quando necessario.",
        "preconditions": ["Intencao de mudanca descrita com alvo e objetivo."],
        "integrations": ["github", "iga", "jira", "confluence"],
        "agents": [
            "IAM Orchestrator",
            "GitHub IAM Agent",
            "IGA Agent",
            "Entitlement Reasoning Agent",
            "IAM Knowledge Agent",
            "Change Guard / Approval Agent",
        ],
        "steps": [
            "Confirmar necessidade e baseline do acesso.",
            "Avaliar impactos tecnicos e processuais.",
            "Submeter a proposta ao Change Guard.",
            "Retornar plano guardado, passos manuais e aprovacao requerida.",
        ],
        "success_criteria": [
            "Plano guardado e auditavel entregue.",
            "Escrita sensivel bloqueada por padrao.",
        ],
        "output_format": "decisao de seguranca, aprovacao, impacto, passos manuais, rollback sugerido",
        "failure_handling": ["Em caso de risco alto ou informacao incompleta, responder apenas com proposta e bloquear execucao."],
        "setup_points": ["Pedir GitHub e IGA antes da proposta; validar processo em Jira/Confluence se necessario."],
        "approval_points": ["Antes de qualquer escrita sensivel.", "Antes de mudancas em role, binding ou grant amplo."],
        "match_keywords": ["mude a permissao", "gere uma proposta de mudanca segura", "precisa aprovacao", "guardrail"],
    },
]


def list_workflows() -> list[dict[str, Any]]:
    return IAM_WORKFLOWS


def detect_workflow(message: str) -> tuple[dict[str, Any] | None, list[str]]:
    lowered = message.lower()
    best_match: dict[str, Any] | None = None
    matched_keywords: list[str] = []
    for workflow in IAM_WORKFLOWS:
        workflow_matches = [keyword for keyword in workflow.get("match_keywords", []) if keyword in lowered]
        if len(workflow_matches) > len(matched_keywords):
            best_match = workflow
            matched_keywords = workflow_matches
    return best_match, matched_keywords
