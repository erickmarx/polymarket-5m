import { CONFIG } from '../config.ts';
import { logger } from '../logger.ts';
import type { MarketState, Order, OrderStrategy } from '../types.ts';
import type { PriceHistoryModule } from './price-history.ts';
import { StrategyStatusManager } from './status-manager.ts';

export class ExecutionModule {
  private activeOrders: Map<string, Order> = new Map();
  private filledOrders: Order[] = [];
  private strategies: OrderStrategy[] = [];
  private conditionToAsset: Map<string, string> = new Map();
  private statusManager: StrategyStatusManager;
  private onOrderEvent: ((order: Order) => void) | null = null;

  constructor(private priceHistory: PriceHistoryModule) {
    this.statusManager = new StrategyStatusManager();
  }

  setOrderEventCallback(cb: (order: Order) => void): void {
    this.onOrderEvent = cb;
  }

  private emitOrder(order: Order): void {
    this.onOrderEvent?.(order);
  }

  getStatusManager(): StrategyStatusManager {
    return this.statusManager;
  }

  registerStrategy(strategy: OrderStrategy): void {
    this.strategies.push(strategy);
    this.statusManager.ensure(strategy.id);
  }

  setConditionToAssetMap(map: Map<string, string>): void {
    this.conditionToAsset = map;
  }

  async evaluate(state: MarketState): Promise<void> {
    // symbol pode ser null durante transição de mercado — não bloqueia a estratégia
    // pois polymarket-signal usa tick buffer interno, não o histórico Binance
    const symbol = this.conditionToAsset.get(state.conditionId);
    const history = symbol ? this.priceHistory.getHistory(symbol) : [];
    if (symbol) {
      logger.debug(`[Execution] ${symbol}: ${history.length} candles carregados para avaliação.`);
    }

    for (const strategy of this.strategies) {
      if (!strategy.seriesIds.includes(state.seriesId)) continue;
      
      if (!this.statusManager.isActive(strategy.id)) {
        continue;
      }

      // Busca ordem BUY FILLED ativa para este mercado E estratégia
      const currentPosition = this.filledOrders.find(
        (o) =>
          o.status === 'FILLED' &&
          o.side === 'BUY' &&
          o.strategyId === strategy.id &&
          this.isOrderForMarket(o, state),
      );

      if (currentPosition) {
        if (await strategy.shouldExit(state, currentPosition, history)) {
          logger.log(
            `[Execution] ${strategy.id}: Iniciando SAÍDA para ${state.conditionId.slice(0, 8)}…`,
          );
          const payload = await strategy.getExitPayload(state, currentPosition, history);
          // Marca como CANCELLED para não re-triggerar shouldExit nos próximos ticks
          currentPosition.status = 'CANCELLED';
          this.dispatchOrder(state.conditionId, payload, strategy.id);
        }
        continue;
      }

      // Bloqueia nova entrada se já há ordem PENDING/LIVE para este mercado+estratégia
      // Espelha: "if paper.posicao or paper._fila: return" do Python
      const hasPending = Array.from(this.activeOrders.values()).some(
        (o) => o.strategyId === strategy.id && this.isOrderForMarket(o, state),
      );
      if (hasPending) continue;

      if (await strategy.shouldExecute(state, history)) {
        logger.log(
          `[Execution] ${strategy.id}: Iniciando ENTRADA para ${state.conditionId.slice(0, 8)}…`,
        );
        const payload = await strategy.getOrderPayload(state, history);
        this.dispatchOrder(state.conditionId, payload, strategy.id);
      }
    }
  }

  private createOrder(
    conditionId: string,
    strategyId: string,
    payload: Omit<Order, 'id' | 'status' | 'createdAt' | 'strategyId'>,
  ): Order {
    return {
      ...payload,
      strategyId,
      id: crypto.randomUUID(),
      status: 'PENDING',
      createdAt: Date.now(),
    };
  }

  private dispatchOrder(
    conditionId: string,
    payload: Omit<Order, 'id' | 'status' | 'createdAt' | 'strategyId'>,
    strategyId: string,
  ): void {
    const order = this.createOrder(conditionId, strategyId, payload);
    if (CONFIG.trading.mode === 'dryrun') {
      this.executeDryRun(conditionId, order);
    } else {
      this.executeLive(conditionId, order);
    }
  }

  private isOrderForMarket(order: Order, state: MarketState): boolean {
    return order.tokenId === state.upTokenId || order.tokenId === state.downTokenId;
  }

  private executeDryRun(conditionId: string, order: Order): void {
    order.status = 'LIVE';
    this.activeOrders.set(order.id, order);
    this.emitOrder(order);
    logger.log(
      `[Execution][DryRun] ${order.side} ${order.size} @ ${order.price} — market: ${conditionId.slice(0, 10)}...`,
    );

    setTimeout(() => {
      order.status = 'FILLED';
      order.filledAt = Date.now();
      this.activeOrders.delete(order.id);
      this.filledOrders.push(order);
      this.emitOrder(order);
      logger.log(`[Execution][DryRun] FILLED ${order.id}`);
    }, 2_000);
  }

  private async executeLive(conditionId: string, order: Order): Promise<void> {
    try {
      order.status = 'LIVE';
      this.activeOrders.set(order.id, order);
      this.emitOrder(order);

      const response = await fetch(`${CONFIG.api.clobBaseUrl}/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CLOB-API-KEY': CONFIG.trading.apiKey,
          'CLOB-SECRET': CONFIG.trading.apiSecret,
          'CLOB-PASS-PHRASE': CONFIG.trading.apiPassphrase,
        },
        body: JSON.stringify({
          token_id: order.tokenId,
          price: order.price,
          size: order.size,
          side: order.side.toLowerCase(),
          type: 'GTC',
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = (await response.json()) as { orderID?: string };
      const remoteId = data.orderID ?? order.id;
      logger.log(`[Execution][Live] Ordem enviada: ${remoteId}`);
      this.pollOrderStatus(order, remoteId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Execution][Live] Falha: ${message}`);
      order.status = 'CANCELLED';
      this.activeOrders.delete(order.id);
      this.emitOrder(order);
    }
  }

  private async pollOrderStatus(order: Order, remoteId: string): Promise<void> {
    const interval = setInterval(async () => {
      try {
        const response = await fetch(`${CONFIG.api.clobBaseUrl}/order/${remoteId}`, {
          headers: {
            'CLOB-API-KEY': CONFIG.trading.apiKey,
            'CLOB-SECRET': CONFIG.trading.apiSecret,
            'CLOB-PASS-PHRASE': CONFIG.trading.apiPassphrase,
          },
        });

        if (!response.ok) return;

        const data = (await response.json()) as { status?: string };
        const status = data.status;

        if (status === 'FILLED' || status === 'MATCHED') {
          clearInterval(interval);
          order.status = 'FILLED';
          order.filledAt = Date.now();
          this.activeOrders.delete(order.id);
          this.filledOrders.push(order);
          this.emitOrder(order);
          logger.log(`[Execution][Live] FILLED: ${remoteId}`);
        } else if (status === 'CANCELLED' || status === 'REJECTED') {
          clearInterval(interval);
          order.status = 'CANCELLED';
          this.activeOrders.delete(order.id);
          this.emitOrder(order);
          logger.log(`[Execution][Live] ${status}: ${remoteId}`);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`[Execution] Poll error: ${message}`);
      }
    }, 5_000);
  }

  getActiveOrders(): Order[] {
    return Array.from(this.activeOrders.values());
  }

  getFilledOrders(): Order[] {
    return this.filledOrders;
  }

  cancelAll(): void {
    for (const order of this.activeOrders.values()) {
      order.status = 'CANCELLED';
    }
    this.activeOrders.clear();
  }
}
