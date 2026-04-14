import { CONFIG } from '../config.ts';
import type { GammaEvent, MarketState } from '../types.ts';

export class DiscoveryModule {
  // conditionId → MarketState (mercado vigente por série)
  private markets: Map<string, MarketState> = new Map();
  // tokenId → conditionId (lookup rápido no WebSocket)
  private tokenIndex: Map<string, string> = new Map();
  // seriesId → buffer de mercados futuros ordenados por endDate
  private buffers: Map<number, MarketState[]> = new Map();

  async fetchAllSeries(): Promise<void> {
    const ids = CONFIG.monitoring.seriesIds;
    if (ids.length === 0) {
      throw new Error('[Discovery] SERIES_IDS não configurado. Adicione ao .env.');
    }

    await Promise.all(ids.map(id => this.fetchSeries(id)));
    this.rebuildIndexes();
    console.log(`[Discovery] ${this.markets.size}/${ids.length} séries carregadas`);
  }

  private async fetchSeries(seriesId: number): Promise<void> {
    const url = `${CONFIG.api.gammaBaseUrl}/events?series_id=${seriesId}&active=true&closed=false&limit=25`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const events = await res.json() as GammaEvent[];
      if (!Array.isArray(events)) return;

      const nowMs = Date.now();

      const parsed = events
        .map(raw => this.parseEvent(raw, nowMs))
        .filter((m): m is MarketState => m !== null && m.marketEndDate > nowMs)
        .sort((a, b) => a.marketEndDate - b.marketEndDate);

      this.buffers.set(seriesId, parsed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Discovery] Falha ao buscar série ${seriesId}: ${message}`);
    }
  }

  private parseEvent(raw: GammaEvent, nowMs: number): MarketState | null {
    try {
      const market = raw.markets[0];
      if (!market) return null;

      const outcomes: string[] = market.outcomes ? JSON.parse(market.outcomes) : ['Yes', 'No'];
      const tokenIds: string[] = market.clobTokenIds ? JSON.parse(market.clobTokenIds) : [];

      let upTokenId = '';
      let downTokenId = '';

      outcomes.forEach((outcome, i) => {
        const label = outcome.toLowerCase();
        if (['yes', 'up'].includes(label)) upTokenId = tokenIds[i] ?? '';
        else if (['no', 'down'].includes(label)) downTokenId = tokenIds[i] ?? '';
      });

      // Fallback se labels não bateram
      if (!upTokenId) upTokenId = tokenIds[0] ?? '';
      if (!downTokenId) downTokenId = tokenIds[1] ?? '';

      if (!upTokenId || !downTokenId) return null;

      const endDate = new Date(raw.endDate).getTime();
      if (isNaN(endDate)) return null;

      return {
        conditionId: raw.id,
        question: raw.title,
        upTokenId,
        downTokenId,
        bestBidUp: 0,
        bestAskUp: 0,
        bestBidDown: 0,
        bestAskDown: 0,
        updatedAt: 0,
        marketEndDate: endDate,
      };
    } catch {
      console.error(`[Discovery] Falha ao parsear evento ${raw.id}`);
      return null;
    }
  }

  // Chamado periodicamente pelo MonitoringModule para renovar mercados expirados
  async refreshExpired(): Promise<boolean> {
    const nowMs = Date.now();
    let changed = false;

    for (const seriesId of CONFIG.monitoring.seriesIds) {
      const buffer = this.buffers.get(seriesId) ?? [];
      const active = buffer.filter(m => m.marketEndDate > nowMs);

      // Renova se buffer está baixo
      if (active.length <= 2) {
        await this.fetchSeries(seriesId);
        changed = true;
      } else {
        this.buffers.set(seriesId, active);
      }
    }

    if (changed) this.rebuildIndexes();
    return changed;
  }

  private rebuildIndexes(): void {
    this.markets.clear();
    this.tokenIndex.clear();

    for (const buffer of this.buffers.values()) {
      const current = buffer[0];
      if (!current) continue;
      this.markets.set(current.conditionId, current);
      this.tokenIndex.set(current.upTokenId, current.conditionId);
      this.tokenIndex.set(current.downTokenId, current.conditionId);
    }
  }

  getMarkets(): Map<string, MarketState> {
    return this.markets;
  }

  buildTokenIndex(): Map<string, string> {
    return this.tokenIndex;
  }
}
