# Sec Agent Studio - Guia de Uso da Interface (Tela a Tela)

Este documento explica cada tela da GUI do MVP, o que cada opcao faz, como usar e como interpretar os resultados.

## 1. Login

**Objetivo**
- Autenticar no sistema com RBAC (Admin, Team Maintainer, Operator).

**Campos**
- `email`: usuario de acesso.
- `password`: senha local.

**Como usar**
1. Preencha email e senha.
2. Clique em `Login`.

**Como ler o resultado**
- Sucesso: redireciona para `Dashboard`.
- Erro de credenciais: mensagem de login invalido.
- Erro de validacao: campos nao atendem formato minimo.

## 2. Layout Principal (Sidebar + Topbar)

**Sidebar**
- Navegacao para:
  - `Dashboard`
  - `Team Graph`
  - `Playground`
  - `Agents`
  - `Tools`
  - `Knowledge Sources`
- Exibe os times cadastrados.

**Topbar**
- Nome do ambiente: `Sec Agent Studio`.
- Exibe papel e usuario logado.
- `Save`: salva um timestamp local de sessao.
- `Export`: exporta configuracao completa em JSON.
- `Logout`: encerra sessao.

## 3. Dashboard

**Objetivo**
- Visao executiva de configuracao + uso/consumo.

**Blocos de informacao**
1. **Cards por time**
   - `Agents`: quantidade de agentes no escopo.
   - `Tools`: quantidade de tools visiveis.
   - `Routes`: quantidade de regras de roteamento.
2. **Resumo de uso**
   - `Simulacoes Totais`
   - `Simulacoes (24h)`
   - `Eventos de Policy Negados (24h)`
   - `Eventos de Auditoria (24h)`
   - `Assign de Tools Write`
   - `Capacidade Configurada (req/min)`
3. **Uso dos Agents**
   - Ranking dos agentes mais acionados.
   - `runs`: quantas vezes foi escolhido.
   - `confianca media`: media da confianca do simulador.
4. **Consumo Diario (7 dias)**
   - Barras por dia com volume de simulacoes.
   - `denied`: negacoes de policy por dia.
5. **Consumo de Tools**
   - `Linked Agents`: quantos agentes ligados a tool.
   - `Assignments`: quantas atribuicoes registradas.
   - `Write Assign`: atribuicoes com permissao de escrita.
   - `Rate Limit`: capacidade configurada por minuto.
6. **Import Config JSON**
   - Permite importar um bundle exportado.

**Como ler o resultado**
- Uso alto + denied alto: indicao de friccao de policy.
- Tool com `write` e muitos `write assignments`: revisar SoD.
- Agente com alta execucao e baixa confianca media: melhorar regras/tags/knowledge.

## 4. Team Graph (Editor Visual Principal)

**Objetivo**
- Modelar handoffs entre agentes em formato grafo.

**Componentes**
- Canvas com grid pontilhado.
- Zoom/pan nativo.
- Nodes arrastaveis.
- Edges direcionais com seta.
- `MiniMap` e controles de navegacao.

**Barra de acoes no canvas**
- Seletor de time: filtra visualizacao do grafo.
- `Auto Layout`: reorganiza nodes em grade.
- `+ Agent`: cria um novo agente specialist no escopo atual.

**Nodes (agentes)**
- Cor por tipo:
  - Supervisor: roxo.
  - Specialist: azul.
  - Ticket: verde.
- Exibe nome, tipo e time/global.

**Interacoes**
1. **Criar conexao**: arraste de um node para outro.
2. **Remover conexao**: duplo clique no edge.
3. **Selecionar node**: abre `Inspector` lateral.
4. **Hover no node**: destaca conexoes relacionadas.

**Inspector (painel direito)**
- Abas:
  - `Configuracao`: nome, descricao, prompt, tipo, time, tags.
  - `Tools`: listar tools ligadas, remover e atribuir novas.
  - `Knowledge`: visualizar fontes de conhecimento associadas.
  - `Permissions`: snapshot de SoD (ex: write em ticket agent).

**Como ler o resultado**
- Fluxo ideal de atendimento:
  - `Global Supervisor`: ponto unico de contato com usuario, confirma entendimento e coleta contexto faltante.
  - `Specialist`: aprofunda no dominio, responde com orientacao pratica e pede dados adicionais quando necessario.
  - `Ticket Agent`: somente quando caso estiver documentado e com dados obrigatorios para abertura de chamado.
- Se houver muitos saltos sem necessidade, simplificar handoffs.
- Se conexoes nao refletem dominio, revisar regras e ownership por time.

## 5. Playground

**Objetivo**
- Simular uma mensagem e validar roteamento usando Agno + LLM local (Ollama).
- Validar experiencia de atendimento fim-a-fim do usuario: acolhimento, perguntas de confirmacao, resposta tecnica e possivel encaminhamento.

**Entradas**
- `message`: texto da demanda.
- `Suggested team (optional)`: dica de time para priorizacao.
- `context tags csv`: tags de contexto para aumentar score.

**Acao principal**
- `Run Playground`.

**Agno Advanced Settings**
- `model id (ollama)`: define o modelo local (ex.: `qwen2.5:3b`).
- `temperature`: controle de variacao da resposta.
- `maxTokens`: limite de tokens de saida.
- `reasoning`: habilita/desabilita raciocinio do agente.
- `reasoningMinSteps` e `reasoningMaxSteps`: limite de passos de raciocinio.
- `add_history_to_context`: inclui historico no contexto do agente.
- `historySessions`: quantidade de sessoes/historico usado.
- `add_session_state_to_context`: inclui estado da sessao no contexto.
- `markdown`: resposta em markdown.
- `show_tool_calls`: exibe chamadas de tools quando aplicavel.

**Saidas**
1. **Outcome**
   - `Team`: time escolhido.
   - `Agent`: agente escolhido.
   - `Confidence`: confianca da classificacao.
   - `Justification`: motivos da decisao.
   - `Highlight path on graph`: caminho de handoff detectado.
2. **Top 3 Ranking**
   - Top 3 agentes com score e motivo.
3. **Sources**
   - Fontes de conhecimento usadas para o agente escolhido.

**Routing Rules (na mesma tela)**
- Criar regra rapida:
  - nome
  - ownerTeam
  - targetAgent
  - keywords
- Lista regras existentes no escopo visivel.

**Agent Conversation Playground (na mesma tela)**
- Selecione um agente.
- Envie mensagens para testar comportamento do agente via Agno.
- Botao `Use Routed Agent` usa automaticamente o agente escolhido no `Outcome`.
- O chat usa o mesmo bloco de `Agno Advanced Settings`.
- Cada resposta do agente inclui `Como chegou nessa resposta` com um resumo de decisao (alto nivel).
- Comportamento esperado por papel:
  - `Global Supervisor`: linguagem gentil, baixa formalidade, pergunta para confirmar entendimento quando houver incerteza.
  - `Specialist`: explica de forma pratica, pede dados faltantes e pode orientar encaminhamento por time (ex.: `@IAM/IGA`).
  - `Ticket Agent`: segue orientacao de documentacao e so avanca com chamado se dados obrigatorios estiverem completos.

**Como ler o resultado**
- Confianca alta + justificativa coerente: roteamento saudavel.
- Confianca baixa: faltam tags/keywords/knowledge.
- Top 3 muito proximo: regras ambiguas, ajustar keywords e handoffs.

## 6. Agents

**Objetivo**
- CRUD de agentes.

**Campos**
- `Name`
- `Type` (`SUPERVISOR`, `SPECIALIST`, `TICKET`)
- `Description`
- `Prompt/system instructions`
- `tags (csv)`
- `Team` ou `Global`

**Como usar**
1. Preencha formulario.
2. Clique em `Create` ou `Update`.
3. Use `Edit`/`Delete` na tabela.

**Como ler o resultado**
- `SUPERVISOR` deve atuar como front-door do usuario: acolher, esclarecer, confirmar entendimento e rotear.
- `SPECIALIST` deve priorizar ajuda direta ao usuario e levantamento de dados faltantes.
- `TICKET` concentra operacoes de escrita e abertura de chamado com checklist/documentacao.

## 7. Tools

**Objetivo**
- CRUD de tools e politicas de risco/acesso.

**Campos principais**
- `name`, `type`, `mode`, `policy`
- `riskLevel`
- `dataClassificationIn/out`
- `rateLimitPerMinute`
- `team` (ou global)
- `inputSchema` e `outputSchema` (JSON)

**Como usar**
1. Configure metadados de seguranca.
2. Salve com `Create`/`Update`.
3. Gerencie com `Edit`/`Delete`.

**Como ler o resultado**
- `policy=write` deve ser excecao e fortemente governado.
- `rateLimit` baixo para write e maior para read e consultas internas.

## 8. Knowledge Sources

**Objetivo**
- Catalogar fontes de conhecimento por time (MVP sem crawling).

**Campos**
- `Name`
- `URL`
- `tags csv`
- `ownerTeam`

**Como usar**
1. Cadastrar fonte.
2. Editar/excluir conforme necessidade.
3. Associacao ao agente ocorre via configuracao do sistema/seed e inspector.

**Como ler o resultado**
- URLs e tags bem definidas aumentam explicabilidade da simulacao.
- Playbooks locais por time foram criados em:
  - `docs/team-playbooks/hrm-playbook.md`
  - `docs/team-playbooks/iam-iga-playbook.md`
  - `docs/team-playbooks/cloudsec-playbook.md`
  - `docs/team-playbooks/corpsec-playbook.md`
  - `docs/team-playbooks/appsec-playbook.md`
  - `docs/team-playbooks/offsec-playbook.md`
  - `docs/team-playbooks/dnr-playbook.md`
  - `docs/team-playbooks/vuln-mgmt-playbook.md`

## 8.1 Access Management (Admin)

**Objetivo**
- Gerenciar acesso com governanca centralizada: usuarios, grupos e memberships.

**Quem pode usar**
- Apenas perfil `ADMIN`.

**Blocos da tela**
1. `Users`
   - Criar usuario com email, senha, role e time.
   - Alterar role rapidamente (`Rotate Role`).
2. `Groups`
   - Criar grupo global ou por time.
   - Selecionar ou remover grupo.
3. `Group Memberships`
   - Adicionar/remover usuarios em grupos.
4. `Password Reset`
   - Resetar senha de usuario.

**Como ler o resultado**
- Alteracoes sao refletidas imediatamente nas listagens.
- Todas as operacoes de acesso geram auditoria (`audit_log`).

## 9. Export/Import de Configuracao

**Export**
- Acionado na topbar (`Export`).
- Gera bundle JSON com assinatura e hash de versao.

**Import**
- Realizado no `Dashboard` via `Import Config JSON`.
- Rejeita payload invalido, assinatura divergente ou violacao de policy de import.

**Boas praticas**
- Versionar JSON exportado em Git.
- Validar em ambiente local antes de promover mudancas.

## 10. Interpretacao Geral de Saude do Sistema

Use este checklist:
1. `Denied events` subindo?
   - Revisar roles, escopo de time e atribuicoes write.
2. `Confidence media` dos top agentes caiu?
   - Ajustar rules, tags, knowledge e prompts.
3. `Write assignments` acima do esperado?
   - Reforcar SoD (somente Ticket Agent com write).
4. `Capacidade req/min` desalinhada com uso?
   - Redimensionar rate limits por risco.

## 11. Fluxo Recomendado de Operacao

1. Cadastre/ajuste `Tools` com policy e risco.
2. Crie/ajuste `Agents` por time com prompts alinhados ao papel (Supervisor/Especialista/Ticket).
3. Modele `Team Graph` (handoffs) com foco no fluxo de atendimento ao usuario.
4. Cadastre `Knowledge Sources` e playbooks de time.
5. Rode `Playground` com casos reais e valide perguntas de confirmacao + qualidade da resposta.
6. Monitore `Dashboard` (uso, consumo e negacoes de policy).
7. Exporte configuracao para versionamento.
