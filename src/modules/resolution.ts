import { CONFIG } from '../config.ts';
import type { Order, TradeRecord } from '../types.ts';

export class ResolutionHandler {
  private history: TradeRecord[] = [];

  async resolve(
    conditionId: string,
    question: string,
    filledOrder: Order,
  ): Promise<TradeRecord> {
    const outcome = await this.fetchResolution(conditionId);
    const pnl = this.calculatePnL(filledOrder, outcome);

    const record: TradeRecord = {
      conditionId,
      question,
      order: filledOrder,
      resolvedOutcome: outcome,
      pnl,
      resolvedAt: Date.now(),
    };

    this.history.push(record);
    console.log(
      `[Resolution] "${question}" → ${outcome} | PnL: ${pnl > 0 ? '+' : ''}${pnl.toFixed(4)} USDC`,
    );

    return record;
  }

  private async fetchResolution(conditionId: string): Promise<string> {
    try {
      const url = new URL(`${CONFIG.api.gammaBaseUrl}/markets`);
      url.searchParams.set('conditionId', conditionId);

      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const markets = await response.json() as Array<{
        conditionId: string;
        resolvedOutcome: string;
        closed: boolean;
      }>;

      const market = markets.find(m => m.conditionId === conditionId);
      if (market?.closed && market.resolvedOutcome) return market.resolvedOutcome;

      return 'UNRESOLVED';
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Resolution] Falha ao buscar resolução: ${message}`);
      return 'UNKNOWN';
    }
  }

  private calculatePnL(order: Order, resolvedOutcome: string): number {
    const upOutcomes = ['Yes', 'Up', '1', 'YES', 'UP'];
    const isUp = upOutcomes.some(o => resolvedOutcome.includes(o));

    if (order.side === 'BUY') {
      return isUp
        ? order.size * (1 - order.price)
        : -order.size * order.price;
    } else {
      return isUp
        ? -order.size * (1 - order.price)
        : order.size * order.price;
    }
  }

  getHistory(): TradeRecord[] {
    return this.history;
  }

  getTotalPnL(): number {
    return this.history.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
  }
}
