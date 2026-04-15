# Polymarket 5M Monitor - Contexto do Projeto

## Objetivo
O **Polymarket 5M Monitor** é um bot de trading de alta frequência (HFT) especializado nos mercados de previsão de 5 minutos da Polymarket (Up/Down). Ele monitora múltiplos ativos em paralelo, analisa o histórico de preços e executa estratégias de entrada e saída baseadas em indicadores técnicos.

## Arquitetura Atual

### 1. Monitoramento Paralelo
- **8 Criptos Simultâneas:** O sistema é configurado para monitorar até 8 séries de mercados de 5 minutos ao mesmo tempo.
- **Transição Zero-Downtime:** O `DiscoveryModule` e o `MonitoringModule` realizam checagens a cada 1 segundo para rotacionar mercados assim que expiram, garantindo que o bot esteja sempre ativo no mercado vigente.

### 2. Histórico de Preços (Price History Module)
- **Bootstrap Inicial:** Busca os últimos 50 candles de 5 minutos diretamente da **Binance REST API** ao iniciar.
- **Sincronização em Tempo Real:** Utiliza o **WebSocket RTDS** da Polymarket para atualizar o candle "aberto" com preços spot.
- **Sincronização de Fechamento:** Escuta eventos `market_resolved` do CLOB WebSocket para fechar os candles no milissegundo exato da resolução da exchange, mantendo o histórico 1:1 com os dados usados pelo oracle.

### 3. Ciclo de Vida da Estratégia
- **Controle Total:** A interface `OrderStrategy` gerencia não apenas a entrada (`shouldExecute`), mas também a saída das posições (`shouldExit`), permitindo stop-loss, take-profit ou saídas baseadas em tempo/indicadores.
- **Acesso ao Histórico:** Cada avaliação da estratégia recebe o array de candles (OHLCV) do ativo correspondente.

### 4. Execução e Qualidade
- **Ambiente:** Desenvolvido em **Bun** para máxima performance em I/O (WebSockets).
- **Interface:** Dashboard CLI interativo construído com **Ink (React)**.
- **Padrão de Desenvolvimento:** Toda e qualquer alteração no código **deve** ser validada obrigatoriamente através dos comandos de `build`, `lint` e `format`, e deve ser **comitada imediatamente** após a validação bem-sucedida.
- **Qualidade de Código:** Pipeline integrado de `lint` (ESLint), `format` (Prettier) e `build` (TypeScript check).

## Roadmap / Próximos Passos
- Implementar indicadores técnicos (RSI, Médias Móveis, Bandas de Bollinger) no módulo de histórico.
- Refinar a estratégia de exemplo para uma lógica de trading real (ex: Market Making ou Mean Reversion).
- Implementar tratamento avançado de erros (retry em ordens falhas, monitoramento de ordens parcialmente preenchidas).

---
*Última atualização: 15 de abril de 2026*
