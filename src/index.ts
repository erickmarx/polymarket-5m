import { DiscoveryModule } from './modules/discovery.ts';
import { logger } from './logger.ts';
import { MonitoringModule } from './modules/monitoring.ts';
import { ExecutionModule } from './modules/execution.ts';
import { ResolutionHandler } from './modules/resolution.ts';
import { PriceHistoryModule } from './modules/price-history.ts';
import { ApiModule } from './modules/api.ts';
import { CONFIG } from './config.ts';
import type { MarketState } from './types.ts';
import { exampleStrategy } from './strategies/example.ts';

const strategies = [exampleStrategy];

async function main() {
  logger.log(`[Main] Iniciando Polymarket 5M Monitor Headless (mode: ${CONFIG.trading.mode})`);

  const discovery = new DiscoveryModule();
  const priceHistory = new PriceHistoryModule();
  const execution = new ExecutionModule(priceHistory);
  const resolution = new ResolutionHandler();
  const api = new ApiModule(discovery, execution, execution.getStatusManager());

  strategies.forEach((s) => execution.registerStrategy(s));

  // 1. Carrega mercados do Polymarket
  await discovery.fetchAllSeries();

  if (discovery.getMarkets().size === 0) {
    logger.error('[Main] Nenhum mercado carregado — verifique SERIES_IDS');
    process.exit(1);
  }

  // 2. Carrega histórico da Binance
  await priceHistory.bootstrap();

  // 3. Inicializa mapeamento de mercados para ativos no ExecutionModule
  const updateMaps = () => {
    const seriesToAsset = CONFIG.monitoring.seriesToAssetMap;
    const conditionToAsset = new Map<string, string>();
    const buffers = discovery.getBuffers();
    if (buffers) {
      for (const [seriesId, markets] of buffers.entries()) {
        const symbol = seriesToAsset[seriesId];
        if (symbol) {
          markets.forEach((m) => conditionToAsset.set(m.conditionId, symbol));
        }
      }
    }
    execution.setConditionToAssetMap(conditionToAsset);
  };
  updateMaps();

  const monitoring = new MonitoringModule(discovery, priceHistory, (state: MarketState) => {
    execution.evaluate(state);
    api.broadcastMarketUpdate(state);
  });

  // 4. Inicia API
  api.start();

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
  }, 10_000);

  // Monitora mudanças no Discovery para atualizar os mapas do Execution
  setInterval(updateMaps, 30_000);

  monitoring.start();

  const shutdown = () => {
    logger.log('\n[Main] Encerrando...');
    monitoring.stop();
    execution.cancelAll();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('[Main] Fatal:', err);
  process.exit(1);
});
