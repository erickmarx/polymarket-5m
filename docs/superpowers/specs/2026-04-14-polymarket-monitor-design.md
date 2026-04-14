# Design do Monitorador de Mercados Polymarket (2026-04-14)

## 1. Visão Geral
Sistema de monitoramento e execução de trading para o Polymarket, projetado em TypeScript. O sistema integra descoberta de mercados, stream de dados em tempo real, execução de ordens com modos Live/DryRun e um dashboard CLI para observabilidade.

## 2. Arquitetura de Módulos

### 2.1. DiscoveryModule
*   **Responsabilidade:** Consulta a Gamma API (`https://gamma-api.polymarket.com`).
*   **Lógica:** Mapeamento de `outcomes` para `clobTokenIds`.
*   **Gerenciamento:** Mantém um `marketBuffer` (fila) ordenado por `endDate`.
*   **Estratégia de Erro:** Fail-fast com logging.

### 2.2. MonitoringModule
*   **Responsabilidade:** Conexão WebSocket com o CLOB (`wss://ws-subscriptions-clob.polymarket.com/ws/market`).
*   **Funcionalidades:** 
    *   Monitoramento de `price_change`.
    *   Heartbeat (ping) a cada 30 segundos.
    *   Reconexão imediata em caso de queda.
    *   Ciclo de atualização (refresh de 1s) para validar `endDate < now`.

### 2.3. ExecutionModule
*   **Responsabilidade:** Gerenciamento do ciclo de vida de ordens.
*   **Modos:** `Live` (Execução via API) e `DryRun` (Execução simulada via log).
*   **Lógica:** Avalia estratégias dinâmicas (`shouldExecute`, `getOrderPayload`).
*   **Rastreamento:** Monitora o status de preenchimento (`FILLED`) via polling ou stream.

### 2.4. ResolutionHandler
*   **Responsabilidade:** Finalização pós-trade.
*   **Fluxo:** Consulta o status de resolução do mercado após o fechamento, calcula o PnL e registra no histórico.

### 2.5. CLI Dashboard
*   **Responsabilidade:** Observabilidade em tempo real usando TUI.
*   **Componentes:** Exibição de preços em tempo real, status da conexão, lista de ordens ativas/preenchidas e logs de eventos.

## 3. Fluxo de Dados e Segurança
*   **Credenciais:** Gestão exclusiva via variáveis de ambiente (`.env`).
*   **Estado:** Manutenção centralizada em memória durante a execução do processo.
*   **Transição:** O sistema descarta mercados expirados e promove o próximo da fila (`marketBuffer[0]`) automaticamente.

## 4. Estrutura de Dados
```typescript
interface MarketState {
  upTokenId: string;
  downTokenId: string;
  bestBidUp: number;
  bestAskUp: number;
  bestBidDown: number;
  bestAskDown: number;
  updatedAt: number;
  marketEndDate: number;
}
```

## 5. Próximos Passos
1. Finalizar especificação técnica.
2. Planejar implementação (Escopo: Configuração do projeto, Estrutura de diretórios, Módulos).
3. Execução incremental do projeto.
