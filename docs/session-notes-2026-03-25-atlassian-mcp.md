# Session Notes — 2026-03-25 — Atlassian MCP

## Objetivo

Integrar o Atlassian Remote MCP Server ao agno_service para consultas de Jira, Confluence e Compass via agente, e configurar o `jira_confluence_iam_agent` em modo read-only.

---

## Estado antes da sessao

- `connectors/atlassian_mcp.py` e `connectors/atlassian_skills.py` criados na sessao anterior (2026-03-24) mas sem token valido
- Teste com Basic auth (API Token via `ATLASSIAN_EMAIL` + `ATLASSIAN_API_TOKEN`) retornava apenas 2 tools Rovo (sem Jira/Confluence)
- `jira_confluence_iam_agent.yaml` existia mas sem `can_use_atlassian` e sem instrucoes de uso das tools MCP

---

## O que foi feito

### 1. Correcao de transporte no MCPTools

**Problema:** `build_atlassian_mcp_tools` criava `MCPTools(server_params=StreamableHTTPClientParams(...))` sem `transport="streamable-http"`. O agno nao auto-detecta o tipo pelo `server_params` — `self.transport` ficava `None` e o `_connect()` caiu no branch stdio.

**Fix:** adicionado `transport="streamable-http"` em `connectors/atlassian_mcp.py:120`.

### 2. Geracao de token OAuth 2.1

Criado `agno_service/get_atlassian_token.py` — CLI stdlib-only que:
- Gera PKCE (code_verifier + code_challenge SHA-256)
- Abre browser na URL de autorizacao Atlassian
- Inicia HTTP server local em `localhost:8080/callback`
- Captura o code de retorno
- Troca por `access_token` + `refresh_token` via POST em `https://auth.atlassian.com/oauth/token`
- Imprime os valores prontos para `.env`

Escopos solicitados:
```
read:jira-work  read:jira-user  write:jira-work
read:confluence-content.all  read:confluence-space.summary  read:confluence-user
read:compass-component  offline_access
```

Tokens salvos em:
- `secrets/atlassian_mcp_token` — access token (expira em 1h)
- `secrets/atlassian_refresh_token` — refresh token (expira em ~90 dias)

### 3. Resultado do teste de conexao

```
Tools disponiveis: 19
 - addCommentToJiraIssue        - addWorklogToJiraIssue
 - atlassianUserInfo            - createIssueLink
 - createJiraIssue              - editJiraIssue
 - fetchAtlassian               - getAccessibleAtlassianResources
 - getIssueLinkTypes            - getJiraIssue
 - getJiraIssueRemoteIssueLinks - getJiraIssueTypeMetaWithFields
 - getJiraProjectIssueTypesMetadata - getTransitionsForJiraIssue
 - getVisibleJiraProjects       - lookupJiraAccountId
 - searchAtlassian              - searchJiraIssuesUsingJql
 - transitionJiraIssue
```

### 4. Inferencia automatica de `can_use_atlassian`

Adicionado em `agent_profiles.py:normalize_agent_capabilities`:

```python
if any(d in resolved_domains for d in ("jira", "confluence", "atlassian", "compass")):
    inferred.add("can_use_atlassian")
```

Qualquer agente com domain `jira`, `confluence`, `atlassian` ou `compass` recebe a capability automaticamente, sem precisar declarar explicitamente.

### 5. jira_confluence_iam_agent.yaml

Atualizado com:
- `capabilities: [can_use_atlassian, can_query_knowledge, can_handoff]` — ativa MCP explicitamente
- `can_write: false` + `execution_profile: READ_ONLY` — dupla protecao
- Lista das 13 tools read-only permitidas nas instrucoes
- JQL examples para orientar o modelo
- Proibicao explicita das 6 tools de escrita
- `visibility: shared` — visivel para outros agentes do time

---

## Arquivos modificados

| Arquivo | Tipo |
|---|---|
| `connectors/atlassian_mcp.py` | fix transport + remocao de "confluence" duplicado no set de signals |
| `agent_profiles.py` | inferencia de `can_use_atlassian` por domain |
| `config/agents/jira_confluence_iam_agent.yaml` | capabilities + instrucoes MCP read-only |
| `get_atlassian_token.py` | novo — CLI OAuth 2.1 PKCE |
| `secrets/atlassian_mcp_token` | novo — access token salvo |
| `secrets/atlassian_refresh_token` | novo — refresh token salvo |

---

## Variaveis de ambiente necessarias

```bash
# Opcao A — OAuth 2.1 (recomendado, produz 19 tools)
ATLASSIAN_MCP_TOKEN_FILE=/app/secrets/atlassian_mcp_token

# Opcao B — Basic auth (produz apenas 2 tools Rovo, nao recomendado para Jira)
ATLASSIAN_EMAIL=user@company.com
ATLASSIAN_API_TOKEN=<api_token>

# Controle de escrita (default: false)
ATLASSIAN_MCP_ALLOW_WRITE=false
```

---

## Decisoes tecnicas

- **OAuth 2.1 obrigatorio para tools Jira/Confluence:** Basic auth com API Token classico so retorna tools Rovo (Teamwork Graph). O Remote MCP Server da Atlassian requer token OAuth com escopos `read:jira-work` etc.
- **Refresh token valido ~90 dias:** salvo em `secrets/` para renovacao sem browser. Nao ha renovacao automatica implementada ainda — tarefa futura se necessario.
- **Write tools nao removidas do MCPTools:** o `atlassian_mcp.py` tem `filter_atlassian_tools` disponivel para filtragem por prefixo de nome, mas o controle atual e feito por instrucoes + `ATLASSIAN_MCP_ALLOW_WRITE=false`. A filtragem antecipada exigiria descoberta de tools antes de construir o MCPTools, o que complicaria o fluxo async.
- **`get_atlassian_token.py` usa apenas stdlib:** sem dependencias extras — portavel para qualquer ambiente.
