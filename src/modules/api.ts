import { logger } from '../logger.ts';
import { CONFIG } from '../config.ts';
import type { MarketState, Order } from '../types.ts';
import type { StrategyStatusManager } from './status-manager.ts';
import type { ExecutionModule } from './execution.ts';
import type { DiscoveryModule } from './discovery.ts';

interface ServerWebSocketData {
  id: string;
}

export class ApiModule {
  private clients: Set<any> = new Set();
  private port = 8090;

  constructor(
    private discovery: DiscoveryModule,
    private execution: ExecutionModule,
    private statusManager: StrategyStatusManager
  ) {}

  start(): void {
    const self = this;
    
    Bun.serve<ServerWebSocketData>({
      port: this.port,
      async fetch(req, server) {
        // Upgrade to WebSocket
        if (server.upgrade(req, { data: { id: crypto.randomUUID() } })) {
          return;
        }

        const url = new URL(req.url);
        let path = url.pathname;
        if (path === '/') path = '/index.html';

        // Tenta servir arquivos estáticos do frontend
        const file = Bun.file(`./src/web/dist${path}`);
        if (await file.exists()) {
          return new Response(file);
        }

        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        open(ws) {
          self.clients.add(ws);
          logger.debug(`[API] Client connected: ${ws.data.id}`);
          self.syncState(ws);
        },
        message(ws, message) {
          self.handleMessage(ws, message as string);
        },
        close(ws) {
          self.clients.delete(ws);
          logger.debug(`[API] Client disconnected: ${ws.data.id}`);
        },
      },
    });

    // Subscrever aos logs para broadcast
    logger.subscribe((level, message) => {
      this.broadcast({ type: 'LOG_EVENT', level, message, timestamp: Date.now() });
    });

    logger.log(`[API] Server started on http://localhost:${this.port}`);
  }

  private syncState(ws: any): void {
    const state = {
      type: 'SYNC_STATE',
      data: {
        strategies: this.statusManager.getAllStatus(),
        activeOrders: this.execution.getActiveOrders(),
        filledOrders: this.execution.getFilledOrders(),
        markets: Array.from(this.discovery.getMarkets().values()),
        mode: CONFIG.trading.mode,
      }
    };
    ws.send(JSON.stringify(state));
  }

  private handleMessage(ws: any, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'TOGGLE_STRATEGY':
          this.statusManager.toggle(msg.id, msg.active);
          this.broadcast({ type: 'STRATEGY_UPDATE', id: msg.id, active: msg.active });
          break;
        case 'EMERGENCY_CANCEL':
          logger.warn(`[API] EMERGENCY CANCEL received from ${ws.data.id}`);
          this.execution.cancelAll();
          this.broadcast({ type: 'EMERGENCY_CANCEL_EXECUTED' });
          break;
        default:
          logger.warn(`[API] Unknown message type: ${msg.type}`);
      }
    } catch (err) {
      logger.error(`[API] Error handling message: ${err}`);
    }
  }

  broadcast(data: any): void {
    const payload = JSON.stringify(data);
    this.clients.forEach(ws => {
      try {
        ws.send(payload);
      } catch {
        this.clients.delete(ws);
      }
    });
  }

  // Helper para o MonitoringModule disparar updates de mercado
  broadcastMarketUpdate(state: MarketState): void {
    this.broadcast({ type: 'MARKET_UPDATE', data: state });
  }

  broadcastOrderEvent(order: Order): void {
    this.broadcast({ type: 'ORDER_EVENT', data: order });
  }
}
