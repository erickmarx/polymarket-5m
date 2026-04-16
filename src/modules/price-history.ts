import { CONFIG } from '../config.ts';
import { logger } from '../logger.ts';
import type { Candle } from '../types.ts';

export class PriceHistoryModule {
  // Histórico por símbolo Binance (ex: BTCUSDT)
  private histories: Map<string, Candle[]> = new Map();
  // Candle atual (aberto) em tempo real
  private currentCandles: Map<string, Candle> = new Map();

  constructor() {
    // Inicializa maps vazios para os ativos configurados
    Object.values(CONFIG.monitoring.seriesToAssetMap).forEach((symbol) => {
      this.histories.set(symbol, []);
    });
  }

  /**
   * Inicializa o histórico buscando candles passados da Binance.
   */
  async bootstrap(): Promise<void> {
    const assets = Array.from(new Set(Object.values(CONFIG.monitoring.seriesToAssetMap)));
    logger.log(`[PriceHistory] Bootstrapping ${assets.length} ativos...`);

    await Promise.all(assets.map((symbol) => this.fetchBinanceHistory(symbol)));

    logger.log(
      `[PriceHistory] Bootstrap completo: ${Array.from(this.histories.keys()).join(', ')}`,
    );
  }

  private async fetchBinanceHistory(symbol: string): Promise<void> {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=50`;

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as unknown[][];
      const candles: Candle[] = data.map((k) => ({
        timestamp: Number(k[0]),
        open: parseFloat(String(k[1])),
        high: parseFloat(String(k[2])),
        low: parseFloat(String(k[3])),
        close: parseFloat(String(k[4])),
        volume: parseFloat(String(k[5])),
      }));

      this.histories.set(symbol, candles);
      logger.debug(`[PriceHistory] ${symbol} carregado: ${candles.length} candles`);

      // Inicializa o currentCandle com o fechamento do último histórico
      const last = candles[candles.length - 1];
      if (last) {
        this.currentCandles.set(symbol, { ...last, timestamp: Date.now() });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[PriceHistory] Erro ao carregar ${symbol}: ${message}`);
    }
  }

  /**
   * Atualiza o candle atual (tempo real) com novos dados do RTDS.
   */
  update(symbol: string, price: number, timestamp: number): void {
    let current = this.currentCandles.get(symbol);
    if (!current) {
      current = {
        open: price,
        high: price,
        low: price,
        close: price,
        volume: 0,
        timestamp,
      };
      this.currentCandles.set(symbol, current);
      return;
    }

    current.close = price;
    if (price > current.high) current.high = price;
    if (price < current.low) current.low = price;
    // RTDS do Polymarket costuma ter o timestamp da exchange
    current.timestamp = timestamp;
  }

  /**
   * Fecha o candle atual e o move para o histórico.
   */
  closeCandle(symbol: string): void {
    const current = this.currentCandles.get(symbol);
    if (!current) return;

    const history = this.histories.get(symbol) || [];
    history.push({ ...current });

    // Mantém apenas os últimos 50
    if (history.length > 50) {
      history.shift();
    }

    this.histories.set(symbol, history);

    // Reinicia o candle aberto para o próximo intervalo
    this.currentCandles.set(symbol, {
      ...current,
      open: current.close,
      high: current.close,
      low: current.close,
      timestamp: Date.now(),
    });

    logger.debug(`[PriceHistory] Candle FECHADO para ${symbol}`);
  }

  getHistory(symbol: string): Candle[] {
    return this.histories.get(symbol) || [];
  }

  getCurrentCandle(symbol: string): Candle | undefined {
    return this.currentCandles.get(symbol);
  }
}
