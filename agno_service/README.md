# Agno Service

Servico Python para orquestracao de agentes com Agno + LLM (Ollama, OpenRouter, Vertex AI).

## Requisitos

- Python 3.11+
- Ollama instalado e rodando (para provider local)

## Setup

```bash
cd agno_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

## Estrutura de modulos

```
agno_service/
  app.py                  # endpoints HTTP + orquestracao de agente (~961 linhas)
  models.py               # DTOs Pydantic (request/response)
  utils.py                # helpers puros: texto, JSON, score, formatadores
  agent_profiles.py       # normalizacao de perfil, comportamento e fallbacks
  model_factory.py        # factory de modelo LLM + discovery de providers
  observability.py        # ring buffer de logs de agente
  secret_env.py           # leitura segura de variaveis de ambiente
  connectors/
    __init__.py
    jumpcloud.py           # tool JumpCloud (API v1/v2/insights)
    jumpcloud_skills.py    # planejamento JumpCloud + infer_jumpcloud_plan_with_skill
    jumpcloud_mcp.py       # config e build do MCP JumpCloud (StreamableHTTP)
    falcon_mcp.py          # config e build do contexto MCP Falcon
    falcon_skills.py       # intent detection Falcon + make_falcon_agent_tools
    atlassian_mcp.py       # config e build do MCP Atlassian (Jira/Confluence/Compass)
    atlassian_skills.py    # intent detection Atlassian + infer_atlassian_domain
  config/
    agents/                # YAML de configuracao de agentes
  team_engine/             # IAM Team: coordenacao, knowledge, risk, change guard
  tests/
```

## Providers de LLM

Configurados via variavel de ambiente `AGNO_MODEL_PROVIDER`:

| Provider | Valor | Variaveis principais |
|---|---|---|
| Ollama (local) | `ollama` | `AGNO_OLLAMA_MODEL`, `AGNO_OLLAMA_HOST` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY`, `AGNO_OPENROUTER_MODEL` |
| Vertex AI | `vertexai` | `GOOGLE_CLOUD_PROJECT`, `AGNO_VERTEX_MODEL`, `VERTEX_AI_CREDENTIALS_PATH` |

Exemplo Ollama:

```bash
set AGNO_MODEL_PROVIDER=ollama
set AGNO_OLLAMA_MODEL=qwen2.5:3b
set AGNO_OLLAMA_HOST=http://localhost:11434
ollama pull qwen2.5:3b
```

Exemplo OpenRouter:

```bash
set AGNO_MODEL_PROVIDER=openrouter
set OPENROUTER_API_KEY=sk-...
set AGNO_OPENROUTER_MODEL=openai/gpt-4o-mini
```

## Endpoints

| Metodo | Path | Descricao |
|---|---|---|
| `GET` | `/health` | Status do servico, provider e flags |
| `GET` | `/models` | Catalogo de modelos por provider |
| `GET` | `/catalog` | Catalogo de agentes para sync com o server |
| `GET` | `/agent-logs` | Ring buffer de logs de execucao |
| `POST` | `/chat` | Execucao de agente com historico e MCP |
| `POST` | `/simulate` | Simulacao de agente sem historico |
| `POST` | `/jumpcloud/execute` | Execucao direta de operacoes JumpCloud |
| `POST` | `/workflow/setup-check` | Verificacao de setup de integracao |

## Atlassian MCP (Jira / Confluence / Compass)

O agno_service ativa consultas ao Atlassian para agentes com domain `jira`, `confluence`, `atlassian` ou `compass`, ou com capability `can_use_atlassian`.

Autenticacao (escolha uma):

```bash
# Opcao A — OAuth 2.1 (recomendado)
set ATLASSIAN_MCP_TOKEN=<access_token>

# Opcao B — Basic auth (API Token)
set ATLASSIAN_EMAIL=user@company.com
set ATLASSIAN_API_TOKEN=<api_token>

# Opcional — leitura de arquivo (Docker/secrets)
set ATLASSIAN_MCP_TOKEN_FILE=/app/secrets/atlassian_mcp_token
```

Variaveis opcionais:

```bash
set ATLASSIAN_MCP_ALLOW_WRITE=false      # default: false (somente leitura)
set ATLASSIAN_MCP_TIMEOUT_SECONDS=60    # default: 60
set ATLASSIAN_MCP_URL=https://mcp.atlassian.com/v1/mcp  # default
```

Gerar token OAuth 2.1 (uma vez, requer browser):

```bash
python get_atlassian_token.py --client-id <ID> --client-secret <SECRET>
```

Tools disponiveis (read-only, 19 no total):
- `searchJiraIssuesUsingJql`, `getJiraIssue`, `getVisibleJiraProjects`
- `searchAtlassian`, `fetchAtlassian`, `atlassianUserInfo`
- `getTransitionsForJiraIssue`, `getJiraIssueTypeMetaWithFields`, e outras

Agente pre-configurado: `config/agents/jira_confluence_iam_agent.yaml`

## Falcon MCP (EDR Analyst)

O agno_service ativa consultas read-only ao CrowdStrike Falcon para agentes com perfil/tags EDR/Falcon.

Variaveis:

```bash
set FALCON_MCP_ENABLED=true
set FALCON_MCP_TRANSPORT_MODE=stdio
set FALCON_MCP_TIMEOUT_SECONDS=90
set FALCON_CLIENT_ID=<client_id>
set FALCON_CLIENT_SECRET=<client_secret>
set FALCON_BASE_URL=https://api.us-2.crowdstrike.com
```

Modo remoto (SSE):

```bash
set FALCON_MCP_TRANSPORT_MODE=sse
set FALCON_MCP_URL=http://localhost:8080/sse
```

Comportamento:

- operacoes sempre read-only
- subconjunto dinamico de tools escolhido pela pergunta do usuario
- `FALCON_MCP_INCLUDE_ALL_TOOLS=true` para expor todas as tools (debug)

## JumpCloud Tool

Variaveis:

```bash
set JUMPCLOUD_TOOL_ENABLED=true
set JUMPCLOUD_API_KEY=<api_key>
set JUMPCLOUD_CLIENT_ID=<client_id>
set JUMPCLOUD_CLIENT_SECRET=<client_secret>
set JUMPCLOUD_BASE_URL=https://console.jumpcloud.com
set JUMPCLOUD_TIMEOUT_SECONDS=30
set JUMPCLOUD_WRITE_ENABLED=false
```

Autenticacao suportada: `x-api-key` ou `OAuth client_credentials`.

Exemplos:

```bash
# listar operacoes
curl -X POST http://localhost:8010/jumpcloud/execute \
  -H "Content-Type: application/json" \
  -d "{\"operation\":\"list_operations\"}"

# listar usuarios
curl -X POST http://localhost:8010/jumpcloud/execute \
  -H "Content-Type: application/json" \
  -d "{\"operation\":\"list_users\",\"query\":{\"limit\":25}}"

# Directory Insights
curl -X POST http://localhost:8010/jumpcloud/execute \
  -H "Content-Type: application/json" \
  -d "{\"operation\":\"list_directory_events\",\"query\":{\"limit\":100}}"
```

## Testes

```bash
.\.venv\Scripts\python.exe -m unittest tests.test_iam_team tests.test_falcon_mcp_tool
```

## Docker

```bash
docker compose up -d --build
```

## Verificacao rapida de imports

```bash
.\.venv\Scripts\python.exe -c "import app; print('app OK')"
.\.venv\Scripts\python.exe -c "from models import ChatRequest; print('models OK')"
.\.venv\Scripts\python.exe -c "from utils import parse_json_block; print('utils OK')"
.\.venv\Scripts\python.exe -c "from agent_profiles import normalize_agent_persona; print('agent_profiles OK')"
.\.venv\Scripts\python.exe -c "from model_factory import build_agent_instance; print('model_factory OK')"
.\.venv\Scripts\python.exe -c "from observability import _emit_agent_log; print('observability OK')"
.\.venv\Scripts\python.exe -c "from connectors import make_falcon_agent_tools; print('connectors OK')"
```
