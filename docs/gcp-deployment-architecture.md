# GCP Deployment Architecture

Guia de deploy recomendado para o `MVP Agent` em GCP, considerando:

- `portal` e persistencia controlados pelo produto
- `agno_service` como runtime de agentes
- MCPs como capacidades instaladas no runtime
- sincronizacao entre `portal <-> agno`
- deploy a partir do repositorio GitHub

## Objetivo

Ter uma arquitetura que permita:

- criar agentes, skills, knowledge sources, handoffs e roteamento no portal
- persistir tudo em banco
- refletir isso no Agno em runtime sem rebuild para cada novo agente
- expor no portal as capacidades realmente instaladas no runtime
- operar MCPs privilegiados com isolamento e observabilidade

## Principios

- configuracao funcional de agentes fica no portal e no banco
- capacidades de runtime ficam instaladas no ambiente do Agno/MCP
- o portal nao instala binarios nem containers
- o runtime publica catalogo do que existe de fato
- ownership deve ser explicito:
  - `managedBy=portal`
  - `managedBy=agno`

## Arquitetura Recomendada

Topologia alvo:

1. `Cloud Run` para `client`
2. `Cloud Run` para `server`
3. `Cloud Run` para `agno_service`
4. `Cloud Run` para MCPs remotos compativeis com HTTP/SSE
5. `Cloud SQL` para banco principal
6. `Secret Manager` para credenciais
7. `Artifact Registry` para imagens
8. `GitHub Actions` para CI/CD
9. `Cloud Logging` e `Cloud Monitoring` para observabilidade

## Quando usar Cloud Run vs VM

Use `Cloud Run` para:

- `client`
- `server`
- `agno_service`
- MCP stateless com endpoint remoto
- integracoes sem dependencia de host local

Use `VM` quando o runtime exigir:

- acesso ao Docker daemon do host
- binario local especifico
- dependencia forte de `stdio`
- dependencia de rede privada local/VPN nao trivial
- MCP que nao foi adaptado para modo servico

## Stack Ideal em Producao

### Camada de Aplicacao

- `client`
  - deploy em `Cloud Run` ou `Cloud Storage + Load Balancer`
- `server`
  - deploy em `Cloud Run`
  - fala com `Cloud SQL`
  - fala com `agno_service`
- `agno_service`
  - deploy em `Cloud Run`
  - recebe catalogo/configuracao do `server`
  - expoe `/health`, `/chat`, `/simulate`, `/catalog`

### Camada de Integracao

- `falcon-mcp`
  - preferencialmente como servico remoto separado
  - deploy em `Cloud Run` se suportar transporte remoto
  - alternativa de transicao: VM dedicada com Docker

### Camada de Dados

- `Cloud SQL`
  - recomendacao: migrar de `SQLite` para `PostgreSQL`
  - manter Prisma como camada de acesso

### Camada de Segredos

- `Secret Manager`
  - `OPENAI_API_KEY`
  - `FALCON_CLIENT_ID`
  - `FALCON_CLIENT_SECRET`
  - `FALCON_BASE_URL`
  - `SESSION_SECRET`
  - `CONFIG_HMAC_SECRET`

## Desenho Recomendado para MCPs

### Modelo Preferido

- MCP sobe como servico persistente
- `agno_service` acessa MCP por URL
- portal apenas habilita, associa e restringe uso

Exemplo:

- `agno_service` -> `falcon-mcp` remoto
- `server` -> `agno_service /catalog`
- `server` sincroniza catalogo runtime no banco
- portal exibe tool/skill runtime como `managedBy=agno`

### Modelo Aceitavel para MVP

Se o MCP ainda nao suportar modo servico remoto:

- usar uma VM de runtime com Docker
- subir `agno_service` e MCPs em `docker compose`
- evitar `docker run` dinamico dentro do `agno_service` sempre que possivel
- preferir MCP como container persistente no mesmo host

## O que pode ser criado no portal e refletido no Agno

Esses recursos devem ser tratados como configuracao de produto:

- agents
- prompts
- tags
- teams
- handoffs
- routing rules
- skills
- knowledge sources
- links `agent <-> tool`
- links `agent <-> skill`
- links `agent <-> knowledge`
- parametros de modelo
- reasoning
- historico/contexto
- guardrails e formatos de resposta

Esses recursos podem ser persistidos no banco e enviados ao Agno em runtime.

## O que nao deve ser “instalado” pelo portal

Esses recursos precisam existir no deploy/runtime:

- MCP servers
- SDKs e CLIs
- containers auxiliares
- acesso ao Docker/socket
- certificados locais
- conectividade privada especial
- credenciais de integracao

O portal pode:

- cadastrar o recurso
- habilitar/desabilitar
- vincular a agentes
- limitar escopo
- mostrar status/catalogo

Mas a instalacao real deve acontecer no processo de deploy.

## Fluxo de Sincronizacao Recomendado

### Portal -> Agno

1. usuario cria/edita agente no portal
2. `server` persiste no banco
3. no `chat/simulate`, `server` envia configuracao do agente ao `agno_service`
4. `agno_service` usa essa configuracao sem precisar rebuild

### Agno -> Portal

1. `agno_service` publica `/catalog`
2. `server` executa sync no startup e sob demanda
3. runtime tools/skills sao materializadas no banco
4. portal mostra o que de fato esta instalado

## Deploy Recomendado via GitHub

Pipeline sugerido:

1. `lint/build/test`
2. build das imagens:
   - `client`
   - `server`
   - `agno_service`
   - MCPs remotos, quando houver
3. push para `Artifact Registry`
4. deploy para `Cloud Run`
5. execucao de migracoes
6. sync de catalogo
7. smoke tests

## Estrutura de Ambientes

### Dev

- docker compose local
- Ollama local
- MCP local ou remoto de teste
- SQLite ainda aceitavel

### Homolog

- Cloud Run
- Cloud SQL
- Secret Manager
- OpenRouter/OpenAI
- Falcon MCP remoto de homolog

### Prod

- Cloud Run
- Cloud SQL HA
- Secret Manager
- logs/metricas/alertas
- MCPs remotos ou VM dedicada para MCP legado

## Modelo de Rede

Recomendacao:

- `client` publico
- `server` publico via HTTPS
- `agno_service` privado, acessivel apenas por `server`
- MCPs privados, acessiveis apenas por `agno_service`
- `Cloud SQL` privado

Se usar Cloud Run:

- restringir ingress quando possivel
- usar service accounts dedicadas
- usar IAM para chamada servico-a-servico

## Gerenciamento do Agno

O `agno_service` deve ser tratado como runtime de agentes, nao como lugar onde cada agente e codificado manualmente.

Responsabilidades do `agno_service`:

- interpretar configuracao vinda do portal
- executar chat/simulacao
- publicar catalogo runtime
- integrar com MCPs instalados

Responsabilidades do portal:

- criar agentes
- versionar configuracao
- governar quem pode editar
- mostrar capacidades disponiveis
- materializar ownership e vinculos

## Decisao Recomendada para o Falcon MCP

### Curto Prazo

- manter suporte no runtime atual
- se necessario, usar VM dedicada com Docker para MCP legado

### Medio Prazo

- adaptar Falcon para modo remoto
- publicar como servico em `Cloud Run`
- fazer `agno_service` acessar por URL

### Longo Prazo

- padronizar MCPs corporativos como servicos remotos
- reduzir dependencia de `stdio` e `docker run`

## Plano de Evolucao Tecnica

1. migrar banco de `SQLite` para `PostgreSQL`
2. separar configuracao de ambiente por `dev/stage/prod`
3. mover segredos para `Secret Manager`
4. publicar `server` e `agno_service` em `Cloud Run`
5. transformar MCPs criticos em servicos remotos
6. manter sync bidirecional via `/catalog`
7. adicionar healthchecks de consistencia de catalogo

## Anti-patterns a Evitar

- uma unica VM com tudo
- `SQLite` local em producao
- `docker run` efemero disparado pelo Agno para cada uso
- expor `/var/run/docker.sock` sem necessidade
- segredos em `.env` versionado
- MCP instalado “na mao” sem catalogo/sync

## Modelo Minimo Viavel de Producao

Se precisar de um caminho mais curto para subir rapido:

- `client` em `Cloud Run`
- `server` em `Cloud Run`
- `agno_service` em `Cloud Run`
- `Cloud SQL`
- `Secret Manager`
- `falcon-mcp` em VM dedicada com Docker, enquanto nao houver modo remoto estavel

Esse desenho ja separa:

- produto
- runtime de agentes
- runtime de integracoes privilegiadas

## Resumo Executivo

O modelo ideal para GCP e:

- portal e persistencia no `server`
- Agno como runtime stateless
- MCPs como servicos instalados no ambiente, preferencialmente remotos
- sync bidirecional entre banco e catalogo runtime
- deploy por pipeline GitHub -> Artifact Registry -> Cloud Run

Para este projeto, a direcao mais solida e:

- `server` e `agno_service` em `Cloud Run`
- `Cloud SQL` no lugar de `SQLite`
- `falcon-mcp` remoto como alvo de medio prazo
- VM com Docker apenas como etapa de transicao para MCP legado
