# IAM Team Architecture

## Overview

O `MVP Agent` agora suporta um `IAM Team` modular, orientado por um coordenador e agentes especializados. O objetivo e receber uma solicitacao em linguagem natural, decidir entre playbook conhecido ou investigacao aberta, validar configuracoes de integracao na ordem correta e consolidar uma resposta com evidencias.

Na segunda evolucao, essa base ganhou quatro camadas complementares:

- `IAM Knowledge Agent`
  - retrieval pragmatica de documentacao, contexto operacional e referencias
- `Entitlement Reasoning Agent`
  - classifica origem e adequacao de acessos
- `IAM Risk Analyst`
  - transforma sinais em findings priorizados
- `Change Guard / Approval Agent`
  - impede escrita sensivel sem proposta auditavel e aprovacao

## Existing Agent Reuse

O agente `JumpCloud Directory Analyst` foi reaproveitado como membro oficial do IAM Team. Em vez de recria-lo, a sincronizacao do catalogo adiciona metadata de `iamTeamProfile` e preserva customizacoes do usuario.

## Agents

- `IAM Orchestrator`
  - coordena o caso
  - escolhe workflow ou open investigation
  - pede configuracao faltante na ordem correta
  - consolida resposta
- `JumpCloud Directory Analyst`
  - reutilizado do ambiente existente
  - usuarios, grupos, devices e eventos de autenticacao
- `GitHub IAM Agent`
  - roles, bindings, manifests, mappings, PRs e historico
- `IGA Agent`
  - papeis, vinculos, aprovacoes, requests e reconciliacao
- `BigQuery IAM/Security Agent`
  - consultas analiticas, correlacoes e findings controlados
- `Jira/Confluence IAM Agent`
  - runbooks, tickets, excecoes e contexto operacional
- `IAM Knowledge Agent`
  - RAG leve sobre docs locais e knowledge sources linkadas
  - responde com evidencias e referencias
- `Entitlement Reasoning Agent`
  - classifica `expected_access`, `justified_exception`, `overprivileged_access`, `orphaned_access`, `undocumented_access`, `potential_sod_conflict` e `insufficient_evidence`
- `IAM Risk Analyst`
  - gera findings com severidade, confianca, hipoteses e proximos passos
- `Change Guard / Approval Agent`
  - classifica a seguranca da mudanca em `read_only`, `propose_only`, `approval_required` ou `safe_to_execute`

## Coordinator Decision Model

O coordenador usa dois modos:

- `workflow`
  - quando a solicitacao combina com um playbook conhecido
- `open_investigation`
  - quando o caso e ambiguo, novo ou exige combinacao dinamica de fontes

Ele tambem aciona camadas complementares quando identifica sinais de:

- conhecimento/processo
- adequacao de entitlement
- risco e autenticacao suspeita
- intencao de mudanca ou escrita sensivel

Ele classifica a intencao em categorias como:

- `simple_query`
- `investigation`
- `comparison`
- `troubleshooting`
- `audit`
- `operational_action`
- `workflow_known`
- `ambiguous`

## Sequential Integration Setup

O setup de integracoes fica centralizado em `agno_service/iam_team/integration_registry.py`.

Cada integracao declara:

- descricao
- scopes/permissoes esperadas
- campos obrigatorios
- quais campos sao segredos
- exemplos de valor

Quando faltar configuracao, o runtime:

1. detecta a integracao exigida pelo agente ou workflow
2. identifica o primeiro campo faltante
3. devolve um pedido objetivo para esse campo
4. informa o que ainda faltara depois

Integracoes suportadas:

- `jumpcloud`
- `github`
- `iga`
- `bigquery`
- `jira`
- `confluence`
- `slack`
- `google_drive`
- `gcp_asset`
- `cloud_logging`
- `iam_analyzer`
- `findings_store`

Se um conector ainda nao existir no runtime, o sistema retorna uma lacuna controlada em vez de quebrar o fluxo.

## Knowledge Layer

A camada de conhecimento fica em `agno_service/iam_team/knowledge_layer.py`.

Primeiro passo implementado:

- retrieval lexical sobre `docs/*.md`
- suporte a `linked_knowledge` do portal
- retorno de `KnowledgeResult` com `title`, `source_name`, `snippet`, `reference` e `score`

Essa solucao e simples de operar, mas ja deixa o caminho pronto para indexacao externa no futuro.

## Entitlement Reasoning

O modulo `agno_service/iam_team/entitlement_reasoning.py` produz `EntitlementAssessment` usando:

- texto do caso
- referencias documentais recuperadas
- disponibilidade real das integracoes
- lacunas de evidencias

Ele ajuda o coordinator a responder:

- de onde vem o acesso
- se parece aderente ao baseline
- se parece excessivo, orfao ou sem documentacao

## Risk Triage

O modulo `agno_service/iam_team/risk_analysis.py` gera `RiskAssessment` e `RiskFinding` com:

- severidade
- confianca
- racional
- hipoteses
- proximos passos

O objetivo e complementar as fontes operacionais, nao substitui-las.

## Change Guard

O modulo `agno_service/iam_team/change_guard.py` fica antes de qualquer escrita sensivel. Ele:

- classifica a seguranca da mudanca
- exige aprovacao quando necessario
- devolve plano auditavel
- bloqueia execucao automatica perigosa por padrao

No runtime generico, agentes com `executionProfile` diferente de `READ_ONLY` passam por esse guardrail antes da execucao.

## Investigation Memory

O arquivo `agno_service/iam_team/memory.py` implementa uma memoria pragmatica em JSONL em `agno_service/runtime/iam_investigation_memory.jsonl`.

Essa memoria registra:

- query
- workflow
- participantes
- findings
- referencias de evidencia
- tags

## Workflows

Playbooks implementados:

- `Access Trace Workflow`
- `User Access Review Workflow`
- `Suspicious Authentication Investigation`
- `Provisioning / Reconciliation Diagnostic`
- `Documentation-Assisted Troubleshooting`
- `Controlled Change Proposal`
- `Entitlement Root Cause Analysis`
- `Access Adequacy Review`
- `IAM Risk Triage`
- `Knowledge-Assisted Investigation`
- `Controlled Change with Guardrails`

Cada workflow define:

- objetivo
- pre-condicoes
- integracoes necessarias
- agentes participantes
- passos
- criterios de sucesso
- formato de saida
- tratamento de falhas
- pontos de setup/autenticacao

## Runtime Integration

Arquivos principais:

- `agno_service/app.py`
  - intercepta o `IAM Orchestrator`
  - executa setup flow antes do fluxo generico
  - aplica `Change Guard` antes de agentes write-capable
  - publica workflows e tool de setup no `/catalog`
- `agno_service/iam_team/coordinator.py`
  - combina workflow planning, knowledge retrieval, entitlement reasoning, risk triage e guardrails
- `server/scripts/sync-agno-catalog.ts`
  - garante os agentes do IAM Team no portal
  - preserva customizacoes do usuario
  - liga handoffs e routing rules

## Security Model

- leitura e escrita sao separadas por `executionProfile`
- `IGA Agent` e `BigQuery IAM/Security Agent` usam `write_guarded`
- `Change Guard / Approval Agent` usa `approval_required`
- propostas de mudanca sao default `nao aplicar`
- setup flow nunca imprime segredos
- respostas do coordenador destacam gaps e pedem confirmacao antes de qualquer acao sensivel

## Supported Configuration

Variaveis suportadas pelo setup flow:

- JumpCloud
  - `JUMPCLOUD_BASE_URL`
  - `JUMPCLOUD_API_KEY`
- GitHub
  - `GITHUB_BASE_URL`
  - `GITHUB_PAT` ou `GITHUB_TOKEN`
  - `IAM_GITHUB_REPOSITORY`
- IGA
  - `IGA_BASE_URL` ou `IGA_WEBHOOK_BASE_URL`
  - `IGA_API_TOKEN` ou `IGA_WEBHOOK_TOKEN`
- BigQuery
  - `BIGQUERY_PROJECT_ID` ou `GOOGLE_CLOUD_PROJECT`
  - `BIGQUERY_DATASET`
  - `GOOGLE_APPLICATION_CREDENTIALS` ou `BIGQUERY_CREDENTIALS_JSON`
- Jira
  - `JIRA_BASE_URL`
  - `JIRA_USERNAME` ou `JIRA_EMAIL`
  - `JIRA_API_TOKEN`
- Confluence
  - `CONFLUENCE_BASE_URL`
  - `CONFLUENCE_USERNAME` ou `CONFLUENCE_EMAIL`
  - `CONFLUENCE_API_TOKEN`

## Adding New Agents

1. definir o novo agente em `server/scripts/sync-agno-catalog.ts`
2. declarar `runtimeConfig.iamTeamProfile`
3. informar `requiredIntegrations`
4. publicar skill/tool no catalogo, se aplicavel
5. atualizar workflows se o agente participar de algum playbook
6. se o agente escrever, garantir passagem pelo `Change Guard`

## Adding New Workflows

1. adicionar um item em `agno_service/iam_team/workflows.py`
2. definir `match_keywords`
3. listar integracoes, agentes, passos e falhas
4. declarar pontos de setup e, se aplicavel, pontos de aprovacao humana
5. sincronizar catalogo para publicar o workflow first-class correspondente

## Local Run

1. subir o ambiente existente do `MVP Agent`
2. garantir que `agno_service` esteja ativo
3. ao iniciar ou reiniciar o `server`, o entrypoint agora executa `sync:agno-catalog` automaticamente antes do start
4. se a sync falhar, o server continua subindo com os dados atuais do portal e registra warning
5. configurar as integracoes necessarias via env vars ou `integrationOverrides`

## Example Requests

- `investigue o acesso do usuario alice ao projeto billing-prod`
- `descubra de onde vem a role roles/bigquery.dataViewer`
- `analise autenticacoes suspeitas do usuario bob`
- `por que o acesso nao foi provisionado no JumpCloud`
- `gere proposta de ajuste de permissao para o grupo finance-admins`
- `explique de onde vem esse acesso e se ele e adequado`
- `esse privilegio parece excessivo`
- `analise o risco desse comportamento de autenticacao`
- `use a documentacao para me dizer o procedimento correto`
- `gere uma proposta de mudanca segura e me diga se precisa aprovacao`
