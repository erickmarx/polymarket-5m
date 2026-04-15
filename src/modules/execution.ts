import { CONFIG } from '../config.ts';
import { logger } from '../logger.ts';
import type { MarketState, Order, OrderStrategy } from '../types.ts';

export class ExecutionModule {
  private activeOrders: Map<string, Order> = new Map();
  private filledOrders: Order[] = [];
  private strategy: OrderStrategy | null = null;
  private activeByMarket: Map<string, boolean> = new Map();

  setStrategy(strategy: OrderStrategy): void {
    this.strategy = strategy;
  }

  evaluate(state: MarketState): void {
    if (!this.strategy) return;
    if (this.activeByMarket.get(state.conditionId)) {
      logger.debug(`[Execution] skip ${state.conditionId.slice(0, 8)}… — ordem já ativa`);
      return;
    }
    if (!this.strategy.shouldExecute(state)) {
      logger.debug(
        `[Execution] skip ${state.conditionId.slice(0, 8)}… — strategy=false` +
        ` bidUp=${state.bestBidUp} askUp=${state.bestAskUp}` +
        ` bidDown=${state.bestBidDown} askDown=${state.bestAskDown}`,
      );
      return;
    }

    const payload = this.strategy.getOrderPayload(state);
    this.placeOrder(state.conditionId, payload);
  }

  private placeOrder(
    conditionId: string,
    payload: Omit<Order, 'id' | 'status' | 'createdAt'>,
  ): void {
    const order: Order = {
      ...payload,
      id: crypto.randomUUID(),
      status: 'PENDING',
      createdAt: Date.now(),
    };

    this.activeByMarket.set(conditionId, true);

    if (CONFIG.trading.mode === 'dryrun') {
      this.executeDryRun(conditionId, order);
    } else {
      this.executeLive(conditionId, order);
    }
  }

  private executeDryRun(conditionId: string, order: Order): void {
    order.status = 'LIVE';
    this.activeOrders.set(order.id, order);
    logger.log(
      `[Execution][DryRun] ${order.side} ${order.size} @ ${order.price} — market: ${conditionId.slice(0, 10)}...`,
    );

    setTimeout(() => {
      order.status = 'FILLED';
      order.filledAt = Date.now();
      this.activeOrders.delete(order.id);
      this.filledOrders.push(order);
      this.activeByMarket.set(conditionId, false);
      logger.log(`[Execution][DryRun] FILLED ${order.id}`);
    }, 2_000);
  }

  private async executeLive(conditionId: string, order: Order): Promise<void> {
    try {
      order.status = 'LIVE';
      this.activeOrders.set(order.id, order);

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

      const data = await response.json() as { orderID?: string };
      const remoteId = data.orderID ?? order.id;
      logger.log(`[Execution][Live] Ordem enviada: ${remoteId}`);
      this.pollOrderStatus(conditionId, order, remoteId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Execution][Live] Falha: ${message}`);
      order.status = 'CANCELLED';
      this.activeOrders.delete(order.id);
      this.activeByMarket.set(conditionId, false);
    }
  }

  private async pollOrderStatus(
    conditionId: string,
    order: Order,
    remoteId: string,
  ): Promise<void> {
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

        const data = await response.json() as { status?: string };
        const status = data.status;

        if (status === 'FILLED' || status === 'MATCHED') {
          clearInterval(interval);
          order.status = 'FILLED';
          order.filledAt = Date.now();
          this.activeOrders.delete(order.id);
          this.filledOrders.push(order);
          this.activeByMarket.set(conditionId, false);
          logger.log(`[Execution][Live] FILLED: ${remoteId}`);
        } else if (status === 'CANCELLED' || status === 'REJECTED') {
          clearInterval(interval);
          order.status = 'CANCELLED';
          this.activeOrders.delete(order.id);
          this.activeByMarket.set(conditionId, false);
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
    this.activeByMarket.clear();
  }
}
