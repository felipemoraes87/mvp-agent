# Agno Service (Local)

Servico Python para orquestracao com Agno + LLM local (Ollama).

## Requisitos

- Python 3.11+
- Ollama instalado e rodando
- Modelo local recomendado: `qwen2.5:3b`

## Setup

```bash
cd agno_service
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

## Modelo local (Ollama)

```bash
ollama pull qwen2.5:3b
```

Opcional: definir outro modelo

```bash
set AGNO_OLLAMA_MODEL=llama3.1:8b
```

Opcional: definir host do Ollama (ex.: Docker network)

```bash
set AGNO_OLLAMA_HOST=http://localhost:11434
```

## Run

```bash
uvicorn app:app --host 0.0.0.0 --port 8010 --reload
```

## Endpoints

- `GET /health`
- `POST /simulate`
- `POST /chat`
- `POST /jumpcloud/execute` (operacoes JumpCloud)

## Falcon MCP (EDR Analyst)

O servico Agno agora consegue ativar consultas read-only ao CrowdStrike Falcon para agentes com perfil/tags de EDR/Falcon, usando `MCPTools`.

Variaveis principais:

```bash
set FALCON_MCP_ENABLED=true
set FALCON_MCP_TRANSPORT_MODE=stdio
set FALCON_MCP_TIMEOUT_SECONDS=90
set FALCON_CLIENT_ID=<client_id>
set FALCON_CLIENT_SECRET=<client_secret>
set FALCON_BASE_URL=https://api.us-2.crowdstrike.com
```

Opcional para futuro MCP remoto:

```bash
set FALCON_MCP_TRANSPORT_MODE=sse
set FALCON_MCP_URL=http://localhost:8080/sse
```

Observacoes:

- o perfil Falcon EDR opera em modo somente leitura
- por padrao, o servico expoe apenas um subconjunto dinamico de tools read-only do Falcon, escolhido pela pergunta do usuario
- para debug/diagnostico, e possivel expor todas as tools configurando `FALCON_MCP_INCLUDE_ALL_TOOLS=true`

## JumpCloud Tool (completa)

A tool JumpCloud foi adicionada no Agno com:

- catalogo de operacoes (`v1`, `v2`, `insights`)
- execucao por operacao nomeada
- execucao raw (endpoint arbitrario)
- consulta de logs (`Directory Insights`)
- modo de seguranca para bloquear escrita por padrao

Variaveis:

```bash
set JUMPCLOUD_TOOL_ENABLED=true
set JUMPCLOUD_API_KEY=<sua_api_key>
set JUMPCLOUD_CLIENT_ID=<seu_client_id>
set JUMPCLOUD_CLIENT_SECRET=<seu_client_secret>
set JUMPCLOUD_BASE_URL=https://console.jumpcloud.com
set JUMPCLOUD_TIMEOUT_SECONDS=30
set JUMPCLOUD_WRITE_ENABLED=false
```

Autenticacao suportada:

- `x-api-key` tradicional com `JUMPCLOUD_API_KEY`
- `OAuth client_credentials` com `JUMPCLOUD_CLIENT_ID` + `JUMPCLOUD_CLIENT_SECRET`
- token endpoint padrao para OAuth: `https://admin-oauth.id.jumpcloud.com/oauth2/token`

Exemplo (listar operacoes):

```bash
curl -X POST http://localhost:8010/jumpcloud/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"operation\":\"list_operations\"}"
```

Exemplo (users via operacao nomeada):

```bash
curl -X POST http://localhost:8010/jumpcloud/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"operation\":\"list_users\",\"query\":{\"limit\":25}}"
```

Exemplo (Directory Insights):

```bash
curl -X POST http://localhost:8010/jumpcloud/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"operation\":\"list_directory_events\",\"query\":{\"limit\":100}}"
```

Exemplo (raw request):

```bash
curl -X POST http://localhost:8010/jumpcloud/execute ^
  -H "Content-Type: application/json" ^
  -d "{\"apiFamily\":\"v2\",\"method\":\"GET\",\"path\":\"/users\",\"query\":{\"limit\":10}}"
```

## Docker

Este servico pode ser executado pelo compose da raiz:

```bash
docker compose up -d --build
```
