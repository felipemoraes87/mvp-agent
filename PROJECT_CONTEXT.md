# PROJECT_CONTEXT.md

Este arquivo centraliza o contexto tecnico do projeto para novas sessoes de coding.

Referencias oficiais usadas para a integracao:

- `https://docs.agno.com/introduction`
- `https://docs.agno.com/cookbook/models/local/ollama`

## 1) Objetivo do Produto

Sec Agent Studio e um MVP local para orquestracao de agentes de seguranca por dominio (HRM, IAM/IGA, CloudSec, CorpSec, AppSec, OffSec, Detection&Response, Vuln Mgmt), com autonomia de configuracao e governanca forte.

### Metas principais

- autonomia dos times para configurar agentes, handoffs e regras
- segregacao de funcoes (SoD) para operacoes de escrita
- policy engine e controles server-side
- trilha de auditoria para mudancas e simulacoes
- simulacao local sem dependencias reais externas

## 2) Arquitetura Atual

### 2.1 Server

- Stack: Express + TypeScript + Prisma Client + SQLite
- Porta default: `8787`
- Arquivo principal: `server/src/index.ts`

Componentes chave:

- `src/policy.ts` regras de autorizacao/SoD
- `src/security.ts` guardrails de entrada
- `src/simulator.ts` classificador/rankeador de simulacao
- `src/agno.ts` integracao HTTP com Agno service
- `src/audit.ts` escrita em audit log
- `src/init-db.ts` criacao de schema SQLite via SQL raw
- `prisma/seed.ts` dados iniciais
- `scripts/apply-domain-context.ts` aplica contexto por dominio

### 2.2 Client

- Stack: React + Vite + TypeScript + Tailwind + React Flow
- Porta default: `5173`

Paginas:

- `LoginPage`
- `DashboardPage`
- `GraphPage`
- `PlaygroundPage` (arquivo `SimulatorPage.tsx`)
- `AgentsPage`
- `ToolsPage`
- `KnowledgePage`
- `AccessPage` (somente Admin)

Componentes principais:

- `Sidebar`, `AppLayout`, `RequireAuth`
- `AgentNode`, `ConnectionEdge`, `InspectorPanel`, `ToolBadge`

### 2.3 Agno Service

- Stack: Python + FastAPI + Agno
- Pasta: `agno_service/`
- Porta default: `8010`
- Modelo local default: `qwen2.5:3b` via Ollama
- Provider de LLM suportado: `ollama` (default) e `openai` (via API key)
- Endpoints:
  - `GET /health`
  - `POST /simulate`
  - `POST /chat`

### 2.4 Docker Compose

Arquivo: `docker-compose.yml`

Servicos:

- `ollama` (`11434`)
- `ollama-init` (pull automatico do modelo)
- `agno_service` (`8010`)
- `server` (`8787`)
- `client` (`5173`)

Volumes persistentes:

- `ollama_data` (modelos locais)
- `server_runtime` (SQLite em `server/runtime/dev.db`)

## 3) Modelo de Dados Relevante

Entidades centrais:

- `Team`
- `User`
- `Group`
- `GroupMembership`
- `Agent`
- `Tool`
- `KnowledgeSource`
- `AgentTool`
- `AgentKnowledge`
- `Handoff`
- `RoutingRule`
- `AuditLog`

Relacionamentos criticos:

- `Team -> Agents/Tools/Knowledge/RoutingRules`
- `User -> Team (opcional)`
- `Group -> Team (opcional global)`
- `GroupMembership -> Group + User`
- `Agent <-> Tool` via `AgentTool`
- `Agent <-> KnowledgeSource` via `AgentKnowledge`
- `Handoff` representa edge direcionado no grafo

## 4) Endpoints API (Resumo)

Auth:

- `GET /api/auth/csrf`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

Core:

- `GET /api/dashboard`
- `GET /api/teams`
- CRUD de `agents`, `tools`, `knowledge-sources`
- CRUD de `handoffs` e `routing-rules`
- `POST /api/simulator/run`
- `POST /api/agno/chat`
- `GET /api/config/export`
- `POST /api/config/import`
- `GET /api/audit-logs`

Access Management (Admin only):

- `GET/POST /api/access/users`
- `PUT /api/access/users/:id`
- `POST /api/access/users/:id/reset-password`
- `GET/POST /api/access/groups`
- `PUT/DELETE /api/access/groups/:id`
- `POST /api/access/groups/:id/members`
- `DELETE /api/access/groups/:id/members/:userId`

## 5) Regras de Seguranca Atuais

- RBAC com 3 papeis: `ADMIN`, `TEAM_MAINTAINER`, `OPERATOR`
- Policy engine server-side com default deny
- SoD: tool write restrita a agente `TICKET`
- TeamMaintainer nao pode editar supervisor global nem write tools
- CSRF obrigatorio em mutacoes
- Rate-limit global e login
- Helmet + CORS restrito por `APP_ORIGIN` + `APP_ORIGINS` (lista CSV opcional)
- Auditoria para mudancas relevantes

## 6) Playground: Como Funciona (Agno + Fallback)

Entrada:

- mensagem + suggestedTeam + contextTags

Processamento:

1. backend tenta `Agno Service /simulate` com contexto de times/agentes/regras
2. se Agno estiver indisponivel, cai no simulador local (`src/simulator.ts`)
3. resultado retorna time, agente, confianca, justificativa, top3 e path

Melhorias recentes:

- integracao com Agno e LLM local via Ollama
- chat por agente via `POST /api/agno/chat`
- resumo de decisao em alto nivel no chat (`reasoningSummary`)
- configuracoes avancadas de runtime expostas na GUI

## 7) Contexto de Dominio (Playbooks)

Arquivos em `docs/team-playbooks/`:

- `hrm-playbook.md`
- `iam-iga-playbook.md`
- `cloudsec-playbook.md`
- `corpsec-playbook.md`
- `appsec-playbook.md`
- `offsec-playbook.md`
- `dnr-playbook.md`
- `vuln-mgmt-playbook.md`

O script `npm run context:apply`:

- atualiza prompts/tags dos especialistas
- atualiza keywords/tags das routing rules
- atualiza knowledge sources com URLs file:// dos playbooks
- garante vinculo `AgentKnowledge`

## 8) Decisoes Tecnicas Importantes

1. **Schema SQLite manual**

- o projeto nao usa migracao Prisma tradicional neste ambiente
- schema e criado via `server/src/init-db.ts`
- comando oficial para isso: `npm run prisma:migrate`

2. **CSRF no client**

- token e obtido em `/api/auth/csrf`
- token do login e persistido no estado do cliente
- retry automatico existe para erro `Invalid CSRF token`

3. **Filtro de time no grafo**

- Admin possui opcao `Todos os times`
- Team Maintainer ve escopo do proprio time + globais

4. **Auto layout do grafo**

- layout orientado por handoffs em camadas
- reduz sobreposicao e melhora leitura

5. **Configuracoes avancadas Agno no simulador**

- `modelId` (modelo Ollama)
- `temperature` e `maxTokens`
- `reasoning`, `reasoningMinSteps`, `reasoningMaxSteps`
- `addHistoryToContext`, `historySessions`
- `addStateToContext`
- `markdown` e `showToolCalls`

## 9) Rotina de Desenvolvimento Recomendada

### Subir ambiente

Opcao recomendada:

1. `docker compose up -d --build`
2. validar `GET http://localhost:8787/api/health`
3. validar `GET http://localhost:8010/health`
4. abrir `http://localhost:5173`

Opcao manual:

1. server: `npm run dev`
2. ollama runtime: `ollama serve`
3. agno service: `uvicorn app:app --host 0.0.0.0 --port 8010 --reload`
4. client: `npm run dev`
5. validar `GET /api/health` e `GET http://localhost:8010/health`

No Windows, se `python` nao estiver no PATH:

- usar `py -m uvicorn app:app --host 0.0.0.0 --port 8010 --reload`
- usar `py -m pip install -r requirements.txt` no `agno_service/`

### Reaplicar base/contexto

1. `npm run prisma:migrate`
2. `npm run prisma:seed`
3. `npm run context:apply`

### Validar build

1. `cd server && npm run build`
2. `cd client && npm run build`

## 10) Troubleshooting Rapido

### `Failed to fetch` no frontend

- normalmente backend parado
- verificar healthcheck em `8787`
- confirmar `APP_ORIGIN`/`APP_ORIGINS` incluem a URL usada no browser (ex.: `http://192.168.1.50:5173`)

### Login falhando por validacao

- contas seed usam dominio local (`@local`)
- usar credenciais seed do README

### Simulacao com resultado ruim

- rodar `npm run context:apply`
- revisar routing rules/tags
- revisar knowledge links do especialista
- validar Ollama local e Agno service ativos

### Agno `/chat` ou `/simulate` sem inferencia

- se `GET /health` do Agno responde e o chat retorna erro de Ollama, o problema e somente no runtime do modelo
- iniciar `ollama serve` e baixar o modelo (`ollama pull qwen2.5:3b`)
- manter `AGNO_BASE_URL=http://localhost:8010` no `server/.env`

### Docker Compose sem resposta da LLM

- validar `docker compose ps` (todos os containers em `running`)
- validar logs: `docker compose logs -f ollama ollama-init agno_service`
- confirmar modelo no container:
  - `docker compose exec ollama ollama list`
  - se ausente, `docker compose exec ollama ollama pull qwen2.5:3b`

### Prisma generate com erro de arquivo bloqueado no Windows

- encerrar processos node do server
- reexecutar `npm run prisma:generate`

## 11) Backlog Tecnico Sugerido

1. test suite automatizada (policy/RBAC/simulator)
2. CI pipeline com lint/build/tests
3. policy matrix por grupo
4. soft delete para users/grupos
5. observabilidade com metricas de endpoint/latencia
6. import/export com validacao criptografica expandida

## 12) Checklist para Nova Sessao de Coding

Antes de codar:

1. Ler `README.md`
2. Ler este `PROJECT_CONTEXT.md`
3. Ler `GUI_GUIDE_PTBR.md` para comportamento esperado da UI
4. Validar ambiente rodando (`/api/health` + login)
5. Confirmar se contexto de dominio foi aplicado

Depois de alterar:

1. build server/client
2. smoke test das rotas afetadas
3. atualizar README/contexto se fluxo mudou
