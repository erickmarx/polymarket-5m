import { CONFIG } from '../config.ts';
import { logger } from '../logger.ts';
import type { GammaEvent, MarketState } from '../types.ts';

export class DiscoveryModule {
  private markets: Map<string, MarketState> = new Map();
  private tokenIndex: Map<string, string> = new Map();
  private buffers: Map<number, MarketState[]> = new Map();
  private lastFetch: Map<number, number> = new Map();

  async fetchAllSeries(): Promise<void> {
    const ids = CONFIG.monitoring.seriesIds;
    if (ids.length === 0) {
      throw new Error('[Discovery] SERIES_IDS não configurado. Adicione ao .env.');
    }

    await Promise.all(ids.map((id) => this.fetchSeries(id)));
    this.rebuildIndexes();
    logger.log(`[Discovery] ${this.markets.size}/${ids.length} séries carregadas`);
  }

  private async fetchSeries(seriesId: number): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(seriesId) ?? 0;

    if (now - last < 15_000) {
      logger.debug(`[Discovery] série ${seriesId} fetch skipped (throttled)`);
      return;
    }

    const url = `${CONFIG.api.gammaBaseUrl}/events?series_id=${seriesId}&active=true&closed=false&limit=25`;
    logger.debug(`[Discovery] GET ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const events = (await res.json()) as GammaEvent[];
      if (!Array.isArray(events)) {
        logger.warn(`[Discovery] série ${seriesId} — resposta não é array`);
        return;
      }

      const nowMs = Date.now();

      const parsed = events
        .map((raw) => this.parseEvent(raw, nowMs, seriesId))
        .filter((m): m is MarketState => m !== null && m.marketEndDate > nowMs)
        .sort((a, b) => a.marketEndDate - b.marketEndDate);

      this.buffers.set(seriesId, parsed);
      this.lastFetch.set(seriesId, now);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Discovery] Falha ao buscar série ${seriesId}: ${message}`);
    }
  }

  private parseEvent(raw: GammaEvent, nowMs: number, seriesId: number): MarketState | null {
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

      if (!upTokenId || !downTokenId) return null;

      const endDate = new Date(raw.endDate).getTime();
      if (isNaN(endDate)) return null;

      return {
        conditionId: raw.id,
        seriesId,
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
      return null;
    }
  }

  async refreshExpired(): Promise<boolean> {
    const nowMs = Date.now();
    const previousMarkets = new Set(this.markets.keys());

    for (const seriesId of CONFIG.monitoring.seriesIds) {
      const buffer = this.buffers.get(seriesId) ?? [];
      const active = buffer.filter((m) => m.marketEndDate > nowMs);

      if (active.length !== buffer.length) {
        this.buffers.set(seriesId, active);
      }

      const current = active.find((m) => m.marketEndDate > nowMs);
      const isExpiringSoon = current && current.marketEndDate - nowMs < 60_000;

      // Busca nova série só quando o buffer está vazio OU mercado atual expira em <30s
      // (não a cada tick quando buffer tem 1-2 mercados — causava reconexão WS contínua)
      const criticallyLow = active.length === 0;
      const almostExpired = current && current.marketEndDate - nowMs < 30_000;
      if (criticallyLow || almostExpired) {
        await this.fetchSeries(seriesId);
      }
    }

    this.rebuildIndexes();

    const currentMarkets = new Set(this.markets.keys());
    if (previousMarkets.size !== currentMarkets.size) return true;
    for (const id of currentMarkets) {
      if (!previousMarkets.has(id)) return true;
    }

    return false;
  }

  private rebuildIndexes(): void {
    this.markets.clear();
    this.tokenIndex.clear();
    const now = Date.now();

    for (const buffer of this.buffers.values()) {
      const current = buffer.find((m) => m.marketEndDate > now);
      if (!current) continue;

      this.markets.set(current.conditionId, current);
      this.tokenIndex.set(current.upTokenId, current.conditionId);
      this.tokenIndex.set(current.downTokenId, current.conditionId);
    }
  }

  getBuffers(): Map<number, MarketState[]> {
    return this.buffers;
  }

  getMarkets(): Map<string, MarketState> {
    return this.markets;
  }

  buildTokenIndex(): Map<string, string> {
    return this.tokenIndex;
  }
}
