import { CONFIG } from "../config.ts";
import { logger } from "../logger.ts";
import type { MarketState } from "../types.ts";
import type { DiscoveryModule } from "./discovery.ts";
import type { PriceHistoryModule } from "./price-history.ts";

type PriceChangeCallback = (state: MarketState) => void;

interface WsPriceChange {
  asset_id: string;
  best_bid?: string;
  best_ask?: string;
}

interface WsMessage {
  event_type: string;
  market?: string;
  condition_id?: string;
  price_changes?: WsPriceChange[];
}

interface RTDSMessage {
  topic: string;
  payload: {
    symbol: string;
    price: number;
    timestamp: number;
  };
}

export class MonitoringModule {
  private ws: WebSocket | null = null;
  private rtds: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private rtdsHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;
  private markets: Map<string, MarketState>;
  private tokenIndex: Map<string, string>;
  // Mapeamento de conditionId para assetSymbol (ex: 10684 -> BTCUSDT)
  private conditionToAsset: Map<string, string> = new Map();

  constructor(
    private discovery: DiscoveryModule,
    private priceHistory: PriceHistoryModule,
    private onPriceChange: PriceChangeCallback,
  ) {
    this.markets = discovery.getMarkets();
    this.tokenIndex = discovery.buildTokenIndex();
    this.updateConditionToAssetMap();
  }

  start(): void {
    this.isRunning = true;
    this.connect();
    this.connectRTDS();
    this.startRefreshCycle();
  }

  stop(): void {
    this.isRunning = false;
    this.clearHeartbeats();
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.ws?.close();
    this.rtds?.close();
    this.ws = null;
    this.rtds = null;
  }

  private updateConditionToAssetMap(): void {
    this.conditionToAsset.clear();
    const seriesToAsset = CONFIG.monitoring.seriesToAssetMap;

    // Precisamos descobrir a qual série cada mercado pertence
    // DiscoveryModule.buffers tem essa info
    // Simplificando: vamos iterar pelos buffers
    // Para simplificar, assumimos que o Discovery já populou os buffers no bootstrap
    // (Acessando buffers via getter público do Discovery)
    const buffers = this.discovery.getBuffers();
    if (buffers) {
      for (const [seriesId, markets] of buffers.entries()) {
        const symbol = seriesToAsset[seriesId];
        if (symbol) {
          markets.forEach((m) => this.conditionToAsset.set(m.conditionId, symbol));
        }
      }
    }
  }

  private startRefreshCycle(): void {
    this.refreshTimer = setInterval(async () => {
      const previousTokens = this.getAllTokenIds();
      const changed = await this.discovery.refreshExpired();

      if (changed) {
        this.markets = this.discovery.getMarkets();
        this.tokenIndex = this.discovery.buildTokenIndex();
        this.updateConditionToAssetMap();

        const currentTokens = this.getAllTokenIds();
        const hasTokenChanges =
          previousTokens.length !== currentTokens.length ||
          previousTokens.some((t, i) => t !== currentTokens[i]);

        if (hasTokenChanges) {
          logger.log(
            "[Monitoring] Tokens ativos mudaram — atualizando subscrições...",
          );
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.close();
          }
          // RTDS é por símbolo, só muda se SERIES_IDS/ASSETS no .env mudarem (raro em runtime)
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
      logger.log("[Monitoring] Nenhum mercado para monitorar");
      return;
    }

    logger.log(`[Monitoring] Conectando CLOB WS: ${CONFIG.api.wsUrl}`);
    this.ws = new WebSocket(CONFIG.api.wsUrl);

    this.ws.addEventListener("open", () => {
      logger.log("[Monitoring] CLOB WebSocket conectado");
      this.subscribe();
      this.startHeartbeat();
    });

    this.ws.addEventListener("message", (event) => {
      this.handleCLOBMessage(event.data as string);
    });

    this.ws.addEventListener("close", () => {
      if (this.isRunning) {
        logger.log("[Monitoring] CLOB WS fechado — reconectando...");
        this.clearHeartbeats();
        setTimeout(() => this.connect(), 1000);
      }
    });
  }

  private connectRTDS(): void {
    const assets = Array.from(
      new Set(Object.values(CONFIG.monitoring.seriesToAssetMap)),
    );
    if (assets.length === 0) return;

    logger.log(`[Monitoring] Conectando RTDS WS: ${CONFIG.api.rtdsUrl}`);
    this.rtds = new WebSocket(CONFIG.api.rtdsUrl);

    this.rtds.addEventListener("open", () => {
      logger.log("[Monitoring] RTDS WebSocket conectado");
      this.subscribeRTDS(assets);
      this.startRTDSHeartbeat();
    });

    this.rtds.addEventListener("message", (event) => {
      this.handleRTDSMessage(event.data as string);
    });

    this.rtds.addEventListener("close", () => {
      if (this.isRunning) {
        logger.log("[Monitoring] RTDS WS fechado — reconectando...");
        setTimeout(() => this.connectRTDS(), 1000);
      }
    });
  }

  private subscribe(): void {
    const allTokenIds = this.getAllTokenIds();
    const allConditionIds = Array.from(this.markets.keys());

    // Inscrição em preços (CLOB)
    this.ws?.send(
      JSON.stringify({
        type: "Market",
        assets_ids: allTokenIds,
      }),
    );

    // Inscrição em resoluções (CLOB)
    this.ws?.send(
      JSON.stringify({
        type: "market",
        markets: allConditionIds,
      }),
    );

    logger.log(
      `[Monitoring] Subscrito a ${this.markets.size} mercados (Prices & Resolutions)`,
    );
  }

  private subscribeRTDS(symbols: string[]): void {
    symbols.forEach((symbol) => {
      this.rtds?.send(
        JSON.stringify({
          action: "subscribe",
          subscriptions: [
            {
              topic: "crypto_price",
              type: "update",
              filters: { symbol: symbol.toUpperCase() },
            },
          ],
        }),
      );
    });
    logger.log(`[Monitoring] RTDS subscrito em: ${symbols.join(", ")}`);
  }

  private handleCLOBMessage(raw: string): void {
    try {
      const msg: WsMessage = JSON.parse(raw);

      // 1. Mudança de preço no mercado (CLOB)
      if (msg.event_type === "price_change" && Array.isArray(msg.price_changes)) {
        for (const change of msg.price_changes) {
          this.applyPriceChange(change);
        }
      }

      // 2. Mercado resolvido (Sinal para fechar candle)
      if (msg.event_type === "market_resolved") {
        const condId = msg.condition_id || msg.market;
        if (condId) {
          const symbol = this.conditionToAsset.get(condId);
          if (symbol) {
            logger.log(`[Monitoring] Resolução detectada para ${symbol} (${condId.slice(0, 8)}…)`);
            this.priceHistory.closeCandle(symbol);
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  private handleRTDSMessage(raw: string): void {
    if (raw === "PONG") return;
    try {
      const msg: RTDSMessage = JSON.parse(raw);
      if (msg.topic === "crypto_price") {
        const { symbol, price, timestamp } = msg.payload;
        this.priceHistory.update(symbol.toUpperCase(), price, timestamp);
      }
    } catch {
      /* ignore */
    }
  }

  private applyPriceChange(msg: WsPriceChange): void {
    const conditionId = this.tokenIndex.get(msg.asset_id);
    if (!conditionId) return;

    const market = this.markets.get(conditionId);
    if (!market) return;

    const bid = parseFloat(msg.best_bid ?? "0");
    const ask = parseFloat(msg.best_ask ?? "0");
    const isUp = msg.asset_id === market.upTokenId;

    if (isUp) {
      market.bestBidUp = bid;
      market.bestAskUp = ask;
    } else {
      market.bestBidDown = bid;
      market.bestAskDown = ask;
    }

    market.updatedAt = Date.now();
    this.onPriceChange(market);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, CONFIG.monitoring.heartbeatIntervalMs);
  }

  private startRTDSHeartbeat(): void {
    this.rtdsHeartbeatTimer = setInterval(() => {
      if (this.rtds?.readyState === WebSocket.OPEN) {
        this.rtds.send("PING");
      }
    }, 5_000); // RTDS requer PING a cada 5s
  }

  private clearHeartbeats(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.rtdsHeartbeatTimer) clearInterval(this.rtdsHeartbeatTimer);
    this.heartbeatTimer = null;
    this.rtdsHeartbeatTimer = null;
  }

  getConnectionStatus(): "connected" | "disconnected" | "connecting" {
    if (!this.ws || !this.rtds) return "disconnected";
    const clobOpen = this.ws.readyState === WebSocket.OPEN;
    const rtdsOpen = this.rtds.readyState === WebSocket.OPEN;
    return clobOpen && rtdsOpen ? "connected" : "connecting";
  }
}
