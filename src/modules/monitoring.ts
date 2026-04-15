import { CONFIG } from '../config.ts';
import { logger } from '../logger.ts';
import type { MarketState } from '../types.ts';
import type { DiscoveryModule } from './discovery.ts';

type PriceChangeCallback = (state: MarketState) => void;

interface WsPriceChange {
  asset_id: string;
  best_bid?: string;
  best_ask?: string;
}

interface WsMessage {
  event_type: string;
  market?: string;
  price_changes?: WsPriceChange[];
}

export class MonitoringModule {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private markets: Map<string, MarketState>;
  private tokenIndex: Map<string, string>;

  constructor(
    private discovery: DiscoveryModule,
    private onPriceChange: PriceChangeCallback,
  ) {
    this.markets = discovery.getMarkets();
    this.tokenIndex = discovery.buildTokenIndex();
  }

  start(): void {
    this.isRunning = true;
    this.connect();
    this.startRefreshCycle();
  }

  stop(): void {
    this.isRunning = false;
    this.clearHeartbeat();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  private startRefreshCycle(): void {
    this.refreshTimer = setInterval(async () => {
      const previousTokens = this.getAllTokenIds();
      const changed = await this.discovery.refreshExpired();

      if (changed) {
        this.markets = this.discovery.getMarkets();
        this.tokenIndex = this.discovery.buildTokenIndex();

        const currentTokens = this.getAllTokenIds();
        const hasTokenChanges =
          previousTokens.length !== currentTokens.length ||
          previousTokens.some((t, i) => t !== currentTokens[i]);

        if (hasTokenChanges) {
          logger.log(
            "[Monitoring] Tokens ativos mudaram — atualizando subscrições...",
          );
          // Re-subscribir com novos tokens (fecha e reabre)
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
        }
      }
    }, 1_000);
  }

  private getAllTokenIds(): string[] {
    const ids: string[] = [];
    for (const m of this.markets.values()) {
      ids.push(m.upTokenId, m.downTokenId);
    }
    return ids.sort();
  }
  private connect(): void {
    if (this.markets.size === 0) {
      logger.log('[Monitoring] Nenhum mercado para monitorar');
      return;
    }

    logger.log(`[Monitoring] Conectando a ${CONFIG.api.wsUrl}`);
    this.ws = new WebSocket(CONFIG.api.wsUrl);

    this.ws.addEventListener('open', () => {
      logger.log('[Monitoring] WebSocket conectado');
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data as string);
    });

    this.ws.addEventListener('close', () => {
      logger.log('[Monitoring] WebSocket fechado — reconectando...');
      this.clearHeartbeat();
      if (this.isRunning) {
        setTimeout(() => this.connect(), 500);
      }
    });

    this.ws.addEventListener('error', () => {
      logger.error('[Monitoring] Erro WebSocket');
    });
  }

  private subscribe(): void {
    const allTokenIds: string[] = [];
    for (const market of this.markets.values()) {
      allTokenIds.push(market.upTokenId, market.downTokenId);
    }

    const payload = {
      auth: {},
      type: 'Market',
      assets_ids: allTokenIds,
    };

    this.ws?.send(JSON.stringify(payload));
    logger.log(
      `[Monitoring] Subscrito a ${this.markets.size} mercados (${allTokenIds.length} tokens)`,
    );
  }

  private handleMessage(raw: string): void {
    try {
      const msg: WsMessage = JSON.parse(raw);
      if (msg.event_type !== 'price_change') return;
      if (!Array.isArray(msg.price_changes)) return;

      for (const change of msg.price_changes) {
        this.applyPriceChange(change);
      }
    } catch {
      // frames não-JSON — ignorar
    }
  }

  private applyPriceChange(msg: WsPriceChange): void {
    const conditionId = this.tokenIndex.get(msg.asset_id);
    if (!conditionId) {
      logger.debug(`[Monitoring] token desconhecido ignorado: ${msg.asset_id.slice(0, 12)}…`);
      return;
    }

    const market = this.markets.get(conditionId);
    if (!market) return;

    const bid = parseFloat(msg.best_bid ?? '0');
    const ask = parseFloat(msg.best_ask ?? '0');
    const isUp = msg.asset_id === market.upTokenId;

    if (isUp) {
      market.bestBidUp = bid;
      market.bestAskUp = ask;
    } else {
      market.bestBidDown = bid;
      market.bestAskDown = ask;
    }

    market.updatedAt = Date.now();

    logger.debug(
      `[Monitoring] ${conditionId.slice(0, 8)}… ${isUp ? 'UP' : 'DOWN'} bid=${bid} ask=${ask}`,
    );

    this.onPriceChange(market);
  }

  // Bun's WebSocket client não expõe ping() — enviamos um keep-alive via texto
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, CONFIG.monitoring.heartbeatIntervalMs);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getConnectionStatus(): 'connected' | 'disconnected' | 'connecting' {
    if (!this.ws) return 'disconnected';
    switch (this.ws.readyState) {
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CONNECTING:
        return 'connecting';
      default:
        return 'disconnected';
    }
  }
}
