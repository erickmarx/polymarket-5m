import { DiscoveryModule } from './modules/discovery.ts';
import { logger } from './logger.ts';
import { MonitoringModule } from './modules/monitoring.ts';
import { ExecutionModule } from './modules/execution.ts';
import { ResolutionHandler } from './modules/resolution.ts';
import { startDashboard } from './ui/cli.tsx';
import { CONFIG } from './config.ts';
import type { MarketState, Order, OrderStrategy } from './types.ts';

// ─── Estratégia de exemplo: compra UP se ask < 0.45 ──────────────────────────
const exampleStrategy: OrderStrategy = {
  shouldExecute(state: MarketState): boolean {
    return state.bestAskUp > 0 && state.bestAskUp < 0.45;
  },
  getOrderPayload(state: MarketState) {
    return {
      tokenId: state.upTokenId,
      side: 'BUY' as const,
      size: 10,
      price: state.bestAskUp,
    };
  },
  shouldExit(state: MarketState, currentPosition: Order): boolean {
    // Exemplo: sai se tiver lucro de 5% ou prejuízo de 2%
    const currentPrice =
      currentPosition.tokenId === state.upTokenId ? state.bestBidUp : state.bestBidDown;
    if (currentPrice === 0) return false;
    const pnl = currentPrice - currentPosition.price;
    return pnl > 0.05 || pnl < -0.02;
  },
  getExitPayload(state: MarketState, currentPosition: Order) {
    return {
      tokenId: currentPosition.tokenId,
      side: 'SELL' as const,
      size: currentPosition.size,
      price: currentPosition.tokenId === state.upTokenId ? state.bestBidUp : state.bestBidDown,
    };
  },
};

async function main() {
  logger.log(`[Main] Iniciando Polymarket Monitor (mode: ${CONFIG.trading.mode})`);
  logger.log(`[Main] Séries configuradas: ${CONFIG.monitoring.seriesIds.length}`);

  const discovery = new DiscoveryModule();
  const execution = new ExecutionModule();
  const resolution = new ResolutionHandler();

  execution.setStrategy(exampleStrategy);

  await discovery.fetchAllSeries();

  if (discovery.getMarkets().size === 0) {
    logger.error('[Main] Nenhum mercado carregado — verifique SERIES_IDS no .env');
    process.exit(1);
  }

  const monitoring = new MonitoringModule(discovery, (state: MarketState) => {
    execution.evaluate(state);
  });

  // Resolve ordens filled assim que o mercado correspondente encerrar
  const resolvedIds = new Set<string>();
  setInterval(async () => {
    const markets = discovery.getMarkets();
    const tokenIndex = discovery.buildTokenIndex();

    for (const order of execution.getFilledOrders()) {
      if (resolvedIds.has(order.id)) continue;

      const conditionId = tokenIndex.get(order.tokenId);
      if (!conditionId) continue;

      const market = markets.get(conditionId);
      // Se o mercado ainda está no Discovery, esperamos ele expirar para tentar resolver
      if (market && market.marketEndDate > Date.now()) continue;

      // Tenta resolver — se retornar UNRESOLVED/UNKNOWN, tentaremos novamente no próximo ciclo
      const record = await resolution.resolve(conditionId, market?.question ?? 'Unknown', order);
      if (record.resolvedOutcome !== 'UNRESOLVED' && record.resolvedOutcome !== 'UNKNOWN') {
        resolvedIds.add(order.id);
      }
    }
  }, 10_000); // 10s é suficiente para resolução sem pesar no log/API

  monitoring.start();

  const unmount = startDashboard({
    getMarkets: () => discovery.getMarkets(),
    getConnectionStatus: () => monitoring.getConnectionStatus(),
    getActiveOrders: () => execution.getActiveOrders(),
    getFilledOrders: () => execution.getFilledOrders(),
    getHistory: () => resolution.getHistory(),
    getTotalPnL: () => resolution.getTotalPnL(),
    mode: CONFIG.trading.mode,
  });

  const shutdown = () => {
    logger.log('\n[Main] Encerrando...');
    monitoring.stop();
    execution.cancelAll();
    unmount();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('[Main] Fatal:', err);
  process.exit(1);
});
