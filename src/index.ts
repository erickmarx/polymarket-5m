import { DiscoveryModule } from './modules/discovery.ts';
import { MonitoringModule } from './modules/monitoring.ts';
import { ExecutionModule } from './modules/execution.ts';
import { ResolutionHandler } from './modules/resolution.ts';
import { startDashboard } from './ui/cli.tsx';
import { CONFIG } from './config.ts';
import type { MarketState, OrderStrategy } from './types.ts';

// ─── Estratégia de exemplo: compra UP se ask < 0.45 ──────────────────────────
const exampleStrategy: OrderStrategy = {
  shouldExecute(state: MarketState): boolean {
    return state.bestAskUp > 0 && state.bestAskUp < 0.45;
  },
  getOrderPayload(state: MarketState) {
    return {
      tokenId: state.upTokenId,
      side: 'BUY',
      size: 10,
      price: state.bestAskUp,
    };
  },
};

async function main() {
  console.log(`[Main] Iniciando Polymarket Monitor (mode: ${CONFIG.trading.mode})`);
  console.log(`[Main] Séries configuradas: ${CONFIG.monitoring.seriesIds.length}`);

  const discovery = new DiscoveryModule();
  const execution = new ExecutionModule();
  const resolution = new ResolutionHandler();

  execution.setStrategy(exampleStrategy);

  await discovery.fetchAllSeries();

  if (discovery.getMarkets().size === 0) {
    console.error('[Main] Nenhum mercado carregado — verifique SERIES_IDS no .env');
    process.exit(1);
  }

  const monitoring = new MonitoringModule(
    discovery,
    (state: MarketState) => {
      execution.evaluate(state);
    },
  );

  // Resolve ordens filled ainda não resolvidas
  const resolvedIds = new Set<string>();
  setInterval(() => {
    const markets = discovery.getMarkets();
    const tokenIndex = discovery.buildTokenIndex();
    for (const order of execution.getFilledOrders()) {
      if (resolvedIds.has(order.id)) continue;
      const conditionId = tokenIndex.get(order.tokenId);
      if (!conditionId) continue;
      const market = markets.get(conditionId);
      if (!market) continue;
      resolvedIds.add(order.id);
      resolution.resolve(conditionId, market.question, order);
    }
  }, 5_000);

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
    console.log('\n[Main] Encerrando...');
    monitoring.stop();
    execution.cancelAll();
    unmount();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Main] Fatal:', err);
  process.exit(1);
});
