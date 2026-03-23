# MVP Agent

Portal administrativo e runtime local para operacao de times de agentes, com foco atual em IAM, seguranca, governanca e integracao com Agno.

O projeto combina:

- `client/`: portal React para administracao, simulacao, mapa de times e workflows
- `server/`: API Express + Prisma + PostgreSQL, com policy engine, auditoria e sync de catalogo
- `agno_service/`: runtime Python/FastAPI + Agno para coordenacao, chat, workflows e IAM Team
- `falcon_mcp/`: servico MCP para integracao Falcon
- `docs/`: arquitetura, playbooks e material operacional

## Leitura Recomendada

1. `PROJECT_CONTEXT.md`
2. `GUI_GUIDE_PTBR.md`
3. `docs/iam-team-architecture.md`
4. `docs/gcp-deployment-architecture.md`

## Stack

- Client: React + Vite + TypeScript + React Router + React Flow
- Server: Node.js + Express + TypeScript + Prisma
- Banco: PostgreSQL
- Runtime de agentes: Python + FastAPI + Agno
- LLM local: Ollama
- LLM opcional: OpenAI
- Observabilidade e logs: pino + audit log
- Seguranca: session cookie, CSRF, rate limit, helmet, policy engine

## Estrutura

- `client/` portal administrativo
- `server/` API, catalog sync, policy, seed, migrations, validacao
- `agno_service/` runtime Agno, IAM Team, setup flow, reasoning, risk, knowledge
- `falcon_mcp/` MCP Falcon
- `docs/team-playbooks/` contexto por dominio
- `docs/reports/` relatorios HTML de testes

## Principais Funcionalidades

- Catalogo de `Agents`, `Workflows`, `Tools`, `Skills` e `Knowledge`
- Pagina dedicada de `Workflows` como entidade first-class
- `GraphPage` para mapa de times e visualizacao de workflows
- `Graph Test` como laboratorio grafico/control plane
- `Playground`/`Simulator` com roteamento, explicacao de decisao e chat via Agno
- IAM Team com:
  - `IAM Orchestrator`
  - reaproveitamento do `JumpCloud Directory Analyst`
  - agentes para GitHub, IGA, BigQuery e Jira/Confluence
  - `IAM Knowledge Agent`
  - `Entitlement Reasoning Agent`
  - `IAM Risk Analyst`
  - `Change Guard / Approval Agent`
- Setup sequencial de integracoes para MCPs/APIs
- Workflows/playbooks IAM e suporte a `open investigation`
- Access Management, RBAC, SoD e auditoria

## Rotas Principais do Portal

- `/` dashboard
- `/agents`
- `/workflows`
- `/tools`
- `/skills`
- `/knowledge`
- `/graph`
- `/graph-test`
- `/playground`
- `/exec-dashboard`
- `/configuration`
- `/debug`
- `/logs`
- `/docs`
- `/access`

## Requisitos

- Node.js 20+
- npm 10+
- Python 3.11+
- Docker + Docker Compose
- Ollama, se usar modelo local

## Setup Rapido

Na raiz do projeto:

```bash
docker compose up -d --build
```

Servicos esperados:

- `postgres`
- `ollama`
- `agno_service`
- `server`
- `client`
- `falcon_mcp`

Observacao:

- o `server` agora executa migrations e `sync:agno-catalog` no start/restart
- se a sync do catalogo falhar, o server continua subindo e registra warning

## URLs

- Client: `http://localhost:5173`
- Server: `http://localhost:8787`
- Server health: `http://localhost:8787/api/health`
- Agno Service: `http://localhost:8010`
- Agno health: `http://localhost:8010/health`
- Ollama: `http://localhost:11434`

## Setup Manual

### Server

```bash
cd server
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run context:apply
npm run sync:agno-catalog
npm run dev
```

### Agno Service

```bash
cd agno_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

Se usar Ollama local:

```bash
ollama serve
ollama pull qwen2.5:3b
```

### Client

```bash
cd client
npm install
npm run dev
```

## Credenciais Seed

- `admin@local` / `Admin123!`
- `iam.maintainer@local` / `Maintainer123!`
- `operator@local` / `Operator123!`

## Scripts Importantes

### Server

- `npm run dev`
- `npm run build`
- `npm run test`
- `npm run prisma:generate`
- `npm run prisma:migrate`
- `npm run prisma:migrate:dev`
- `npm run prisma:seed`
- `npm run bootstrap`
- `npm run context:apply`
- `npm run sync:agno-catalog`

### Client

- `npm run dev`
- `npm run build`
- `npm run preview`

### Agno Service

- `python -m unittest tests.test_iam_team`
- `python -m unittest tests.test_falcon_mcp_tool`
- `python tests/generate_iam_team_html_report.py`

## Modelo de Seguranca

- papeis: `ADMIN`, `TEAM_MAINTAINER`, `OPERATOR`
- policy engine server-side com default deny
- segregacao clara entre leitura e escrita
- `executionProfile` por agente:
  - `READ_ONLY`
  - `WRITE_GUARDED`
  - `WRITE_ALLOWED`
  - `APPROVAL_REQUIRED`
- `Change Guard` antes de operacoes sensiveis
- CSRF em mutacoes
- rate limit e hardening HTTP
- auditoria para alteracoes relevantes

## IAM Team

O IAM Team fica descrito em `docs/iam-team-architecture.md`.

Capacidades principais:

- decidir entre workflow conhecido e investigacao aberta
- pedir configuracao faltante na ordem correta
- consolidar evidencias de varias fontes
- classificar adequacao de acesso
- priorizar risco
- propor mudancas com guardrails

Workflows publicados atualmente:

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

## Variaveis de Ambiente Relevantes

### Server

- `DATABASE_URL`
- `PORT`
- `APP_ORIGIN`
- `APP_ORIGINS`
- `SESSION_SECRET`
- `CONFIG_HMAC_SECRET`
- `AGNO_BASE_URL`
- `AGNO_ENABLED`

### Agno / LLM

- `AGNO_MODEL_PROVIDER`
- `AGNO_OPENAI_MODEL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_ORG`

### Falcon MCP

- `FALCON_MCP_ENABLED`
- `FALCON_MCP_TRANSPORT_MODE`
- `FALCON_MCP_URL`
- `FALCON_MCP_TIMEOUT_SECONDS`
- `FALCON_MCP_INCLUDE_ALL_TOOLS`
- `FALCON_CLIENT_ID`
- `FALCON_CLIENT_SECRET`
- `FALCON_BASE_URL`

### Integracoes IAM

- `JUMPCLOUD_BASE_URL`
- `JUMPCLOUD_API_KEY`
- `GITHUB_BASE_URL`
- `GITHUB_PAT` ou `GITHUB_TOKEN`
- `IAM_GITHUB_REPOSITORY`
- `IGA_BASE_URL`
- `IGA_API_TOKEN`
- `BIGQUERY_PROJECT_ID`
- `BIGQUERY_DATASET`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `JIRA_BASE_URL`
- `JIRA_API_TOKEN`
- `CONFLUENCE_BASE_URL`
- `CONFLUENCE_API_TOKEN`

## Testes e Validacao

Validacoes uteis antes de finalizar mudancas:

```bash
cd server && npm run build && npm run test
cd client && npm run build
cd agno_service && .\.venv\Scripts\python.exe -m unittest tests.test_iam_team tests.test_falcon_mcp_tool
```

Relatorio HTML dos testes do IAM Team:

```bash
cd agno_service
.\.venv\Scripts\python.exe tests\generate_iam_team_html_report.py
```

## Troubleshooting Rapido

### Portal nao refletiu agentes/workflows novos

- confirme `http://localhost:8010/catalog`
- reinicie o `agno_service` se o runtime mudou
- reinicie o `server`; ele executa `sync:agno-catalog` no start

### Graph / Workflows nao atualizaram na UI

- rode `docker compose up -d --build client`
- faca `Ctrl + F5` no navegador

### Erro de chat/simulacao

- valide `http://localhost:8010/health`
- valide `http://localhost:8787/api/health`
- confirme Ollama ativo, quando aplicavel

### Prisma / banco

- rode `npm run prisma:generate`
- rode `npm run prisma:migrate`

## Proximos Passos Recomendados

1. conectar mais integracoes reais alem de JumpCloud/Falcon
2. enriquecer telemetria operacional do portal
3. persistir findings/memoria investigativa em store dedicada
4. expandir testes automatizados de UI e API

