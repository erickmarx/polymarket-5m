import { CONFIG } from '../config.ts';
import type { MarketState } from '../types.ts';
import type { DiscoveryModule } from './discovery.ts';

type PriceChangeCallback = (state: MarketState) => void;

interface WsBookMessage {
  event_type: string;
  asset_id: string;
  best_bid?: string;
  best_ask?: string;
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
    if (this.refreshTimer) { clearInterval(this.refreshTimer); this.refreshTimer = null; }
    this.ws?.close();
    this.ws = null;
  }

  private startRefreshCycle(): void {
    // A cada 30s verifica se algum mercado expirou e re-subscribir se necessário
    this.refreshTimer = setInterval(async () => {
      const changed = await this.discovery.refreshExpired();
      if (changed) {
        this.markets = this.discovery.getMarkets();
        this.tokenIndex = this.discovery.buildTokenIndex();
        // Re-subscribir com novos tokens (fecha e reabre)
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
      }
    }, 30_000);
  }

  private connect(): void {
    if (this.markets.size === 0) {
      console.log('[Monitoring] Nenhum mercado para monitorar');
      return;
    }

    console.log(`[Monitoring] Conectando a ${CONFIG.api.wsUrl}`);
    this.ws = new WebSocket(CONFIG.api.wsUrl);

    this.ws.addEventListener('open', () => {
      console.log('[Monitoring] WebSocket conectado');
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.addEventListener('message', (event) => {
      this.handleMessage(event.data as string);
    });

    this.ws.addEventListener('close', () => {
      console.log('[Monitoring] WebSocket fechado — reconectando...');
      this.clearHeartbeat();
      if (this.isRunning) {
        setTimeout(() => this.connect(), 500);
      }
    });

    this.ws.addEventListener('error', () => {
      console.error('[Monitoring] Erro WebSocket');
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
    console.log(`[Monitoring] Subscrito a ${this.markets.size} mercados (${allTokenIds.length} tokens)`);
  }

  private handleMessage(raw: string): void {
    try {
      const msgs: WsBookMessage[] = JSON.parse(raw);
      if (!Array.isArray(msgs)) return;

      for (const msg of msgs) {
        if (msg.event_type !== 'price_change') continue;
        this.applyPriceChange(msg);
      }
    } catch {
      // frames não-JSON — ignorar
    }
  }

  private applyPriceChange(msg: WsBookMessage): void {
    const conditionId = this.tokenIndex.get(msg.asset_id);
    if (!conditionId) return;

    const market = this.markets.get(conditionId);
    if (!market) return;

    const bid = parseFloat(msg.best_bid ?? '0');
    const ask = parseFloat(msg.best_ask ?? '0');

    if (msg.asset_id === market.upTokenId) {
      market.bestBidUp = bid;
      market.bestAskUp = ask;
    } else {
      market.bestBidDown = bid;
      market.bestAskDown = ask;
    }

    market.updatedAt = Date.now();
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
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CONNECTING: return 'connecting';
      default: return 'disconnected';
    }
  }
}
