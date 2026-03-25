# PROJECT_CONTEXT.md

Este arquivo resume o estado tecnico atual do `MVP Agent` para novas sessoes de coding.

## 1. Objetivo do Produto

`MVP Agent` e um portal administrativo + runtime local para modelagem, operacao e governanca de agentes. O foco atual do produto esta em:

- portal de administracao de times, agentes, workflows, tools e knowledge
- simulacao e chat com runtime Agno
- IAM Team com coordenacao, reasoning, knowledge, risk e guardrails
- arquitetura extensivel para MCPs, APIs e future control plane

## 2. Arquitetura Atual

### 2.1 Client

- Stack: React + Vite + TypeScript + React Router + React Flow
- Porta default: `5173`
- Layout principal: `client/src/components/AppLayout.tsx`
- Navegacao principal: `client/src/components/Sidebar.tsx`
- Rotas: `client/src/App.tsx`

Paginas relevantes:

- `DashboardPage`
- `AgentsPage`
- `WorkflowsPage`
- `ToolsPage`
- `SkillsPage`
- `KnowledgePage`
- `GraphPage`
- `GraphTestPage`
- `SimulatorPage`
- `ExecDashboardPage`
- `ConfigurationPage`
- `DebugPage`
- `LogsPage`
- `DocsPage`
- `AccessPage`

Pontos importantes:

- `Workflows` agora e entidade first-class no portal
- `SkillsPage` nao deve mais ser usada para representar workflows
- `GraphPage` e a tela operacional principal de visualizacao
- `Graph Test` e um laboratorio grafico/control plane isolado

### 2.2 Server

- Stack: Express + TypeScript + Prisma Client + PostgreSQL
- Porta default: `8787`
- Arquivo principal: `server/src/index.ts`

Componentes chave:

- `src/policy.ts`
- `src/security.ts`
- `src/simulator.ts`
- `src/agno.ts`
- `src/validation.ts`
- `src/agent-classification.ts`
- `prisma/schema.prisma`
- `prisma/seed.ts`
- `scripts/apply-domain-context.ts`
- `scripts/sync-agno-catalog.ts`

Mudancas relevantes:

- o banco atual e PostgreSQL, nao SQLite
- `Workflow` virou model first-class
- `Agent` ganhou `persona`, `routingRole`, `executionProfile`, `capabilities` e `domains`
- o sync do catalogo consome `/catalog` do Agno e materializa agentes, tools, skills e workflows
- o start/restart do `server` executa migrations e sync de catalogo

### 2.3 Agno Service

- Stack: Python + FastAPI + Agno
- Porta default: `8010`
- Arquivo principal: `agno_service/app.py` (~961 linhas — orquestracao + endpoints)

Estrutura modular (refatorada em 2026-03-24, Atlassian MCP adicionado em 2026-03-25):

```
agno_service/
  app.py               # endpoints HTTP + run_agent_with_optional_mcp
  models.py            # DTOs Pydantic de request/response
  utils.py             # helpers puros: texto, JSON, score, formatadores
  agent_profiles.py    # normalizacao de perfil + comportamento + fallbacks
  model_factory.py     # factory LLM + discovery de providers (Ollama/OpenRouter/Vertex)
  observability.py     # ring buffer de logs de agente
  get_atlassian_token.py  # CLI para gerar access token OAuth 2.1 Atlassian
  connectors/
    jumpcloud.py          # tool JumpCloud
    jumpcloud_skills.py   # planejamento JumpCloud + infer_jumpcloud_plan_with_skill
    jumpcloud_mcp.py      # config e build MCP JumpCloud (StreamableHTTP)
    falcon_mcp.py         # config e contexto MCP Falcon
    falcon_skills.py      # intent detection + make_falcon_agent_tools
    atlassian_mcp.py      # config e build MCP Atlassian (Jira/Confluence/Compass)
    atlassian_skills.py   # intent detection Atlassian + domain inference
  config/
    agents/               # YAML por agente (jira_confluence_iam_agent.yaml, etc.)
```

Endpoints principais:

- `GET /health`
- `GET /catalog`
- `GET /models`
- `GET /agent-logs`
- `POST /simulate`
- `POST /chat`
- `POST /jumpcloud/execute`
- `POST /workflow/setup-check`

IAM Team:

- codigo em `agno_service/team_engine/`
- coordenador em `coordinator.py`
- knowledge layer em `knowledge_layer.py`
- entitlement reasoning em `entitlement_reasoning.py`
- risk analysis em `risk_analysis.py`
- change guard em `change_guard.py`
- integration setup flow em `integration_registry.py`
- workflows em `workflows.py` (carregados de `config/workflows.yaml`)
- mapeamento de roles e triagem de tickets em `role_mapping.py`
- investigation memory em `memory.py`
- definicoes de agentes em `config/agents.yaml`
- definicoes de workflows em `config/workflows.yaml`

### 2.4 Docker Compose

Arquivo: `docker-compose.yml`

Servicos principais:

- `postgres`
- `ollama`
- `agno_service`
- `server`
- `client`
- `falcon_mcp`

Comportamento importante:

- `server` aplica migrations e executa `sync:agno-catalog` no start
- `client` precisa de rebuild para refletir mudancas de UI no ambiente docker

## 3. Modelo de Dados Relevante

Entidades centrais:

- `Team`
- `User`
- `Group`
- `Agent`
- `Workflow`
- `Tool`
- `Skill`
- `KnowledgeSource`
- `Handoff`
- `RoutingRule`
- `AuditLog`

Entidades de ligacao:

- `AgentTool`
- `AgentSkill`
- `AgentWorkflow`
- `AgentKnowledge`
- `GroupMembership`

Pontos importantes do model:

- `Workflow` tem `objective`, `preconditions`, `integrationKeys`, `steps`, `successCriteria`, `failureHandling` e `setupPoints`
- `Agent` separa identidade e comportamento operacional via `persona`, `routingRole` e `executionProfile`
- `tags` ainda existem, mas nao sao a unica base de comportamento

## 4. Catalogo e Sync

Fonte principal:

- `agno_service/app.py` publica `/catalog`

Consumo:

- `server/scripts/sync-agno-catalog.ts`

Responsabilidades da sync:

- upsert de agentes runtime-managed
- publicacao de tools/skills/workflows
- preservacao de customizacoes do usuario
- ligacao de handoffs e routing rules
- migracao de workflows legacy que antes vinham como `Skill(category=workflow)`

Regra operacional:

- se algo novo nao apareceu no portal, primeiro conferir o `/catalog`
- depois reiniciar `server` para disparar a sync

## 5. IAM Team

Documentacao detalhada:

- `docs/iam-team-architecture.md`

Agentes/camadas ativas:

- `IAM Orchestrator`
- `JumpCloud Directory Analyst`
- `GitHub IAM Agent`
- `IGA Agent`
- `BigQuery IAM/Security Agent`
- `Jira/Confluence IAM Agent`
- `IAM Knowledge Agent`
- `Entitlement Reasoning Agent`
- `IAM Risk Analyst`
- `Change Guard / Approval Agent`

Definicao dos agentes:

- as capacidades de cada agente (`AgentCapability`) eram hardcoded; agora sao carregadas de `config/agents.yaml`
- o YAML define: `agent_name`, `role`, `summary`, `domains`, `can_write`, `reuse_existing_agent`

Capacidades do coordenador:

- decidir entre workflow conhecido e `open_investigation`
- exigir setup sequencial de integracoes
- consolidar evidencias e gaps
- acionar knowledge, reasoning, risk e change guard
- triar tickets Jira de acesso via `role_mapping.py` e mapear para business role no IGA

Triagem de tickets Jira (`role_mapping.py`):

- extrai contexto estruturado do ticket (`AccessRequestContext`): issue_key, system, target_user, request_type, justification
- classifica o ticket: `fulfillable_access_request`, `unclear_request`, `not_access_request`
- mapeia para business role usando tabela de regras (`DEFAULT_ROLE_MAPPING_RULES`) ou regras vindas de `linked_knowledge`
- retorna `TicketTriageResult` com acao sugerida para Jira e IGA

Schemas novos:

- `AccessRequestContext`: contexto extraido de mensagens de solicitacao de acesso
- `TicketTriageResult`: resultado da triagem de ticket Jira, com classificacao, business role e passos recomendados

## 6. Setup Sequencial de Integracoes

Local:

- `agno_service/iam_team/integration_registry.py`

Padrao:

- cada integracao declara requisitos
- se faltar configuracao, o runtime pede o primeiro campo faltante
- o fluxo nao quebra quando um conector ainda nao existe
- conectores indisponiveis devem retornar uma resposta controlada de indisponibilidade

Integracoes previstas:

- JumpCloud
- GitHub
- IGA
- BigQuery
- Jira
- Confluence
- Slack
- Google Drive
- GCP Asset
- Cloud Logging
- IAM Analyzer
- Findings Store

## 7. Seguranca e Governanca

- papeis: `ADMIN`, `TEAM_MAINTAINER`, `OPERATOR`
- policy engine server-side com default deny
- CSRF em mutacoes
- auditoria para alteracoes relevantes
- write-capable passa por `executionProfile` e guardrails
- `Change Guard` deve ficar antes de qualquer escrita sensivel
- logs nao devem vazar segredos

Observacao importante:

- regras antigas do tipo "so `TICKET` escreve" foram sendo substituidas pela modelagem nova com `executionProfile` e capacidades

## 8. Estado Atual de UI/Grafo

`GraphPage`:

- usado para mapa de times e visualizacao de workflows
- passou por varias iteracoes recentes e merece leitura cuidadosa antes de mexer
- a UX atual privilegia selecao de time/workflow, visualizacao manual e exploracao do fluxo

`Graph Test`:

- pagina separada para experimentar control plane/observability
- codigo em `client/src/features/graphTest/`
- deve continuar isolada de `GraphPage` para nao quebrar o fluxo principal

## 9. Desenvolvimento Recomendado

### Subir ambiente

```bash
docker compose up -d --build
```

Checks minimos:

- `http://localhost:8787/api/health`
- `http://localhost:8010/health`
- `http://localhost:8010/catalog`
- `http://localhost:5173`

### Quando mexer no backend

```bash
cd server
npm run prisma:generate
npm run prisma:migrate
npm run build
npm run test
```

### Quando mexer no Agno

```bash
cd agno_service
.\.venv\Scripts\python.exe -m unittest tests.test_iam_team tests.test_falcon_mcp_tool
```

### Quando mexer no client

```bash
cd client
npm run build
docker compose up -d --build client
```

## 10. Troubleshooting Rapido

### Mudanca nao apareceu no portal

1. verificar `/catalog`
2. verificar logs do `server`
3. reiniciar `server`
4. se for UI, rebuild do `client`

### Workflow/agent sumiu ou voltou apos restart

- checar `server/scripts/sync-agno-catalog.ts`
- olhar regras de preservacao de customizacao e tombstones de handoff

### Mudanca de UI nao refletiu

- o `client` em Docker precisa de rebuild
- depois usar `Ctrl + F5`

### Problema de banco

- verificar `DATABASE_URL`
- reaplicar `npm run prisma:migrate`

## 11. Historico de Sessoes

| Data | Arquivo | Resumo |
|---|---|---|
| 2026-03-24 | [session-notes-2026-03-24-agno-refactor.md](docs/session-notes-2026-03-24-agno-refactor.md) | Refatoracao do agno_service/app.py: 1901 → 961 linhas, 7 modulos extraidos |
| 2026-03-25 | [session-notes-2026-03-25-atlassian-mcp.md](docs/session-notes-2026-03-25-atlassian-mcp.md) | Integracao Atlassian MCP: connector, OAuth 2.1, 19 tools Jira/Confluence, agente read-only |

## 12. Checklist para Nova Sessao

Antes de mexer:

1. ler `README.md`
2. ler este arquivo
3. ler `docs/iam-team-architecture.md` se o assunto for IAM Team
4. ler notas da ultima sessao relevante em `docs/session-notes-*.md`
5. verificar `git status`
6. validar healthchecks

Depois de mexer:

1. rodar build/test do stack afetado
2. se mudou catalogo/runtime, validar `/catalog`
3. se mudou UI, rebuild do `client`
4. atualizar documentacao se fluxo mudou
5. registrar notas da sessao em `docs/session-notes-YYYY-MM-DD-*.md` e linkar neste arquivo
