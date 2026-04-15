import { CONFIG } from "../config.ts";
import { logger } from "../logger.ts";
import type { GammaEvent, MarketState } from "../types.ts";

export class DiscoveryModule {
  // conditionId → MarketState (mercado vigente por série)
  private markets: Map<string, MarketState> = new Map();
  // tokenId → conditionId (lookup rápido no WebSocket)
  private tokenIndex: Map<string, string> = new Map();
  // seriesId → buffer de mercados futuros ordenados por endDate
  private buffers: Map<number, MarketState[]> = new Map();
  // seriesId → timestamp do último fetch bem-sucedido
  private lastFetch: Map<number, number> = new Map();

  async fetchAllSeries(): Promise<void> {
    const ids = CONFIG.monitoring.seriesIds;
    if (ids.length === 0) {
      throw new Error(
        "[Discovery] SERIES_IDS não configurado. Adicione ao .env."
      );
    }

    await Promise.all(ids.map((id) => this.fetchSeries(id)));
    this.rebuildIndexes();
    logger.log(
      `[Discovery] ${this.markets.size}/${ids.length} séries carregadas`
    );
  }

  private async fetchSeries(seriesId: number): Promise<void> {
    const now = Date.now();
    const last = this.lastFetch.get(seriesId) ?? 0;

    // Throttle de 15s para não sobrecarregar em caso de buffer baixo frequente
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

      logger.debug(
        `[Discovery] série ${seriesId} — ${events.length} eventos recebidos`
      );
      const nowMs = Date.now();

      const parsed = events
        .map((raw) => this.parseEvent(raw, nowMs))
        .filter((m): m is MarketState => m !== null && m.marketEndDate > nowMs)
        .sort((a, b) => a.marketEndDate - b.marketEndDate);

      logger.debug(`[Discovery] série ${seriesId} parsed:`, parsed);
      logger.debug(
        `[Discovery] série ${seriesId} — ${parsed.length}/${events.length} mercados válidos no buffer`
      );

      this.buffers.set(seriesId, parsed);
      this.lastFetch.set(seriesId, now);
      } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Discovery] Falha ao buscar série ${seriesId}: ${message}`);
    }
  }

  private parseEvent(raw: GammaEvent, nowMs: number): MarketState | null {
    try {
      const market = raw.markets[0];
      if (!market) {
        logger.debug(`[Discovery] parseEvent skip ${raw.id} — sem markets[0]`);
        return null;
      }

      const outcomes: string[] = market.outcomes
        ? JSON.parse(market.outcomes)
        : ["Yes", "No"];
      const tokenIds: string[] = market.clobTokenIds
        ? JSON.parse(market.clobTokenIds)
        : [];

      logger.debug(
        `[Discovery] parseEvent ${raw.id} outcomes=${JSON.stringify(
          outcomes
        )} tokens=${tokenIds.length}`
      );

      let upTokenId = "";
      let downTokenId = "";

      outcomes.forEach((outcome, i) => {
        const label = outcome.toLowerCase();
        if (["yes", "up"].includes(label)) upTokenId = tokenIds[i] ?? "";
        else if (["no", "down"].includes(label))
          downTokenId = tokenIds[i] ?? "";
      });

      // Fallback se labels não bateram
      if (!upTokenId) {
        logger.debug(
          `[Discovery] parseEvent ${raw.id} — fallback upToken (label não reconhecido)`
        );
        upTokenId = tokenIds[0] ?? "";
      }
      if (!downTokenId) {
        logger.debug(
          `[Discovery] parseEvent ${raw.id} — fallback downToken (label não reconhecido)`
        );
        downTokenId = tokenIds[1] ?? "";
      }

      if (!upTokenId || !downTokenId) {
        logger.warn(
          `[Discovery] parseEvent skip ${raw.id} — tokenIds insuficientes (up="${upTokenId}" down="${downTokenId}")`
        );
        return null;
      }

      const endDate = new Date(raw.endDate).getTime();
      if (isNaN(endDate)) {
        logger.warn(
          `[Discovery] parseEvent skip ${raw.id} — endDate inválido: "${raw.endDate}"`
        );
        return null;
      }

      const msSinceEnd = nowMs - endDate;
      if (msSinceEnd > 0) {
        logger.debug(
          `[Discovery] parseEvent ${raw.id} — expirado há ${Math.round(
            msSinceEnd / 1000
          )}s`
        );
      }

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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[Discovery] Falha ao parsear evento ${raw.id}: ${message}`);
      return null;
    }
  }

  // Chamado periodicamente pelo MonitoringModule para renovar mercados expirados
  async refreshExpired(): Promise<boolean> {
    const nowMs = Date.now();
    let changed = false;
    const previousMarkets = new Set(this.markets.keys());

    for (const seriesId of CONFIG.monitoring.seriesIds) {
      const buffer = this.buffers.get(seriesId) ?? [];
      const active = buffer.filter((m) => m.marketEndDate > nowMs);
      
      // Se o buffer mudou (algum mercado expirou), marcamos como potencial mudança
      if (active.length !== buffer.length) {
        this.buffers.set(seriesId, active);
        // Não setamos 'changed' ainda, rebuildIndexes dirá se o mercado ATIVO mudou
      }

      // Renova se buffer está baixo (menos de 3 mercados futuros)
      if (active.length <= 2) {
        logger.log(
          `[Discovery] série ${seriesId} — buffer baixo (${active.length}), renovando via API...`
        );
        await this.fetchSeries(seriesId);
      }
    }

    this.rebuildIndexes();
    
    // Verifica se os mercados ativos (vigentes) mudaram
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
      // Pega o primeiro mercado do buffer que ainda não terminou
      const current = buffer.find(m => m.marketEndDate > now);
      if (!current) continue;
      
      this.markets.set(current.conditionId, current);
      this.tokenIndex.set(current.upTokenId, current.conditionId);
      this.tokenIndex.set(current.downTokenId, current.conditionId);
    }

    logger.log(
      `[Discovery] Index rebuilt: ${this.markets.size} mercados, ${this.tokenIndex.size} tokens`
    );
    for (const [condId, market] of this.markets) {
      const end = new Date(market.marketEndDate).toISOString();
      logger.debug(
        `[Discovery]   ${condId.slice(0, 10)}… "${market.question.slice(
          0,
          40
        )}" ends=${end}`
      );
    }
  }

  getMarkets(): Map<string, MarketState> {
    return this.markets;
  }

  buildTokenIndex(): Map<string, string> {
    return this.tokenIndex;
  }
}
