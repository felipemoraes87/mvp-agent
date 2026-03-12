# Executive Dashboard (Mock)

## Acesso

- Rota: `/exec-dashboard`
- Navegação: Sidebar > `Executive Dashboard`

## Estrutura

- `src/features/execDashboard/ExecDashboardPageContent.tsx`: tela principal
- `src/features/execDashboard/components/*`: componentes reutilizáveis (cards, tabelas, gráficos simples)
- `src/features/execDashboard/types.ts`: tipagem forte da feature
- `src/mocks/execDashboard.mock.ts`: datasets mock para 7/30/90 dias

## Como alterar os mocks

1. Edite `MODEL_ASSUMPTIONS`, `TEAM_DEFINITIONS` e listas base em `src/mocks/execDashboard.mock.ts`.
2. Ajuste os geradores (`buildModelUsage`, `buildTeams`, `buildRoutes`, `buildAudit`) para mudar distribuição/custos.
3. Recarregue a página e alterne período (7/30/90 dias) para validar o comportamento.
