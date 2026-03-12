# Sec Agent Studio (MVP Local)

MVP local para gerenciamento visual de times de agentes de seguranca (estilo workflow), com governanca forte, RBAC, SoD, policy engine server-side e auditoria.

Integracao Agno implementada seguindo os conceitos da documentacao oficial: `https://docs.agno.com/introduction`.

## Leitura Recomendada

1. `PROJECT_CONTEXT.md` (contexto tecnico detalhado para novas sessoes de coding)
2. `GUI_GUIDE_PTBR.md` (guia funcional tela a tela)
3. Este `README.md` (setup, operacao e troubleshooting)

## Stack

- Client: React + Vite + TypeScript + Tailwind + React Flow
- Server: Node.js + Express + TypeScript
- Agno service: Python + FastAPI + Agno
- LLM local: Ollama (default `qwen2.5:3b`)
- LLM opcional via API: OpenAI (ex.: `gpt-4o-mini`)
- DB: SQLite (Prisma Client)
- Auth: sessoes com cookie httpOnly + bcrypt
- Security middleware: helmet + rate-limit + CSRF
- Validation: zod
- Logs: pino (JSON)

## Estrutura

- `server/` API, policy, auditoria, seed, scripts de contexto
- `client/` interface GUI (dashboard, grafo, simulador, access mgmt)
- `agno_service/` engine Agno para simulacao e chat de agentes
- `docker-compose.yml` orquestracao local de todos os servicos (client/server/agno/ollama)
- `.dockerignore` exclusoes para build de imagem
- `docs/team-playbooks/` playbooks por dominio para contexto dos especialistas
- `GUI_GUIDE_PTBR.md` guia de uso funcional
- `PROJECT_CONTEXT.md` contexto tecnico completo

## Features Implementadas

- Dashboard com metricas de uso e consumo
- Team Graph com editor visual (React Flow), auto layout, minimap, inspector
- Playground com roteamento por regras/keywords/tags e caminho no grafo
- Simulador de conversa direta com agente selecionado (via Agno)
- Explicacao de decisao no chat do Playground (`Como chegou nessa resposta`) com resumo de raciocinio em alto nivel
- Opcoes avancadas Agno na GUI (modelo, reasoning, historico em contexto, estado de sessao, markdown, show tool calls)
- CRUD de Agents, Tools, Knowledge Sources
- Access Management (Admin): Users, Groups, Memberships, reset de senha
- Export/Import de configuracao (JSON/YAML com assinatura HMAC)
- RBAC + SoD + trilha de auditoria

## Requisitos

- Node.js 20+
- npm 10+
- Python 3.11+
- Ollama
- Docker + Docker Compose
- Windows/Mac/Linux

## Setup Rapido (Docker Compose)

No diretorio raiz `MVP Agent`:

```bash
docker compose up -d --build
```

O compose sobe:

- `ollama` (porta `11434`)
- `ollama-init` (faz `ollama pull` do modelo e encerra)
- `agno_service` (porta `8010`)
- `server` (porta `8787`)
- `client` (porta `5173`)

Observacao: na primeira subida, o `ollama-init` baixa o modelo `qwen2.5:3b` (~2 GB) e pode demorar alguns minutos.

Para acompanhar logs:

```bash
docker compose logs -f server agno_service client ollama
```

Para parar:

```bash
docker compose down
```

Para parar removendo volumes (zera banco SQLite e cache Ollama):

```bash
docker compose down -v
```

Variaveis opcionais para o compose (shell):

- `SESSION_SECRET`
- `CONFIG_HMAC_SECRET`
- `AGNO_ENABLED`
- `APP_ORIGIN` (origin principal do client para CORS/sessao)
- `APP_ORIGINS` (lista CSV de origins extras permitidos)
- `VITE_API_BASE_URL` (opcional; vazio usa hostname atual com porta `8787`)
- `AGNO_MODEL_PROVIDER` (`ollama` ou `openai`)
- `AGNO_OPENAI_MODEL` (default `gpt-4o-mini`)
- `OPENAI_API_KEY` (obrigatorio quando provider = `openai`)
- `OPENAI_BASE_URL` (opcional)
- `OPENAI_ORG` (opcional)

## Setup Manual (Sem Docker)

### 1) Server

```bash
cd server
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run context:apply
npm run dev
```

### 2) Agno Service

```bash
cd agno_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
ollama serve
ollama pull qwen2.5:3b
uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

No Windows sem alias `python`, use `py`:

```bash
cd agno_service
py -m pip install -r requirements.txt
py -m uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

### 3) Client

```bash
cd client
npm install
npm run dev
```

## URLs

- Client: `http://localhost:5173`
- Server: `http://localhost:8787`
- Agno Service: `http://localhost:8010`
- Ollama: `http://localhost:11434`
- Healthcheck: `http://localhost:8787/api/health`

Importante: para acesso em rede local por IP, ajuste `APP_ORIGIN`/`APP_ORIGINS` no compose para incluir a URL real do client (ex.: `http://192.168.1.50:5173`).

## Credenciais Seed

- `admin@local` / `Admin123!`
- `iam.maintainer@local` / `Maintainer123!`
- `operator@local` / `Operator123!`

## Scripts Importantes

### Server (`server/package.json`)

- `npm run dev` inicia API em modo watch
- `npm run build` compila TypeScript
- `npm run start` roda build compilado
- `npm run prisma:generate` gera Prisma Client
- `npm run prisma:migrate` inicializa schema SQLite local
- `npm run prisma:seed` popula base inicial
- `npm run context:apply` aplica contexto por dominio (playbooks/tags/keywords)

### Client (`client/package.json`)

- `npm run dev` inicia UI
- `npm run build` valida TS e gera build
- `npm run preview` sobe build local

## Modelo de Seguranca

- Roles: `ADMIN`, `TEAM_MAINTAINER`, `OPERATOR`
- SoD:
  - tools `write` so podem ser atribuidas a agente `TICKET`
- Policy engine server-side com default deny
- CSRF para mutacoes
- Rate limit global e sensivel (inclui login)
- Guardrails no simulador (conteudo inseguro/segredos)
- Auditoria com correlation id e config hash

## Dados Seed

- 8 times:
  - HRM, IAM/IGA, CloudSec, CorpSec, AppSec, OffSec, Detection&Response, Vuln Mgmt
- Agentes:
  - 1 Supervisor global
  - 1 Specialist por time
  - 1 Ticket Agent global
- Tools mock:
  - `SearchKnowledge` (read)
  - `LookupRunbook` (read)
  - `CreateTicket` (write)
- Playbooks de dominio criados e associados aos especialistas em `docs/team-playbooks/`

## Fluxo Operacional Sugerido

1. Inicie server e client
2. Login com `admin@local`
3. Valide o grafo em `Team Graph`
4. Rode cenarios em `Playground`
5. Acompanhe metricas em `Dashboard`
6. Ajuste regras, agentes e contexto
7. Exporte configuracao para versionamento

## Troubleshooting

### Erro `Failed to fetch` no login

Causa comum: backend fora do ar.

- Verifique `http://localhost:8787/api/health`
- Se nao responder, rode no `server/`: `npm run dev`

### Erro `Invalid CSRF token`

- Recarregue a pagina e tente novamente
- Se persistir, logout/login
- O client ja implementa refresh/retry automatico de CSRF

### Playground nao escolhe especialista esperado

- Rode: `npm run context:apply` no `server/`
- Revise tags/keywords em routing rules
- Confirme knowledge source associado ao especialista

### Agno responde erro de conexao com Ollama

- Mensagem comum: `Failed to connect to Ollama...`
- Garanta que o runtime Ollama esta ativo (`ollama serve`) e com modelo baixado (`ollama pull qwen2.5:3b`)
- Valide Agno: `http://localhost:8010/health`
- Valide server: `http://localhost:8787/api/health`

### Docker: Agno sobe, mas inferencia nao acontece

- Verifique se `ollama-init` terminou com sucesso:
  - `docker compose ps`
  - `docker compose logs ollama-init`
- Verifique disponibilidade do modelo:
  - `docker compose exec ollama ollama list`
- Se necessario, rode pull manual:
  - `docker compose exec ollama ollama pull qwen2.5:3b`

### CORS

- `APP_ORIGIN` define o origin principal permitido
- `APP_ORIGINS` permite origins adicionais (CSV), ex.: `http://localhost:5173,http://192.168.1.50:5173`
- Default: apenas `http://localhost:5173` (quando `APP_ORIGINS` estiver vazio)

### Prisma / schema local

- Este projeto usa inicializacao de schema SQLite via `scripts/migrate.ts` + `src/init-db.ts`
- Se houver erro de schema, rode novamente:
  - `npm run prisma:generate`
  - `npm run prisma:migrate`

## Variaveis de Ambiente (server/.env)

- `DATABASE_URL=file:./dev.db`
- `PORT=8787`
- `APP_ORIGIN=http://localhost:5173`
- `APP_ORIGINS=`
- `SESSION_SECRET=...`
- `CONFIG_HMAC_SECRET=...`
- `STORE_SIMULATION_CONTENT=false`
- `AUDIT_RETENTION_DAYS=30`
- `AGNO_BASE_URL=http://localhost:8010`
- `AGNO_ENABLED=true`

## Qualidade e Evolucao

Recomendado para proximas iteracoes:

1. testes automatizados (policy, RBAC, endpoints criticos)
2. pipeline CI com lint/build/audit
3. HTTPS local para cookie secure
4. rotacao de segredos e hardening adicional
5. matriz de permissoes por grupo (policy matrix)

## Documentacao Relacionada

- Guia funcional: `GUI_GUIDE_PTBR.md`
- Contexto tecnico detalhado: `PROJECT_CONTEXT.md`
