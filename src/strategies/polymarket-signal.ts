import type { MarketState, Order, OrderStrategy, Candle } from '../types.ts';

// Parâmetros genéticos da estratégia — todos os limiares e pesos vêm daqui
const GENE = {
  mom_curto_n: 5,    // janela curta de momentum
  mom_longo_n: 20,   // janela longa de momentum
  rsi_n: 14,         // período do RSI
  vel_norm: 0.02,    // fator de normalização da velocidade (preço/segundo)
  w1: 0.3,           // peso S1 (momentum curto)
  w2: 0.2,           // peso S2 (momentum longo)
  w3: 0.2,           // peso S3 (pressão de livro — não disponível, sempre 0)
  w4: 0.15,          // peso S4 (velocidade)
  w5: 0.15,          // peso S5 (RSI)
  min_score: 0.3,    // score mínimo para considerar entrada
  min_prob: 0.6,     // probabilidade mínima na janela final
  entry_window: 60,  // segundos antes do fechamento que ativa a janela final
  rev_mult: 1.5,     // multiplicador do min_score para reversão (não usado aqui)
  stop_loss: 0.05,   // perda fracionária que aciona stop
  take_entry: 0.4,   // preço de entrada máximo para acionar take-profit
  take_target: 0.7,  // preço alvo para take-profit
  valor_trade: 10,   // tamanho máximo da ordem em dólares
  lat_ms: 250,       // latência simulada (não usada — host controla execução)
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Sinais ───────────────────────────────────────────────────────────────────

/**
 * S1 / S2 — Momentum
 * Conta ticks de alta vs baixa nos últimos n+1 preços.
 * Retorna (altas - baixas) / total, em [-1, 1].
 */
function momentum(prices: number[], n: number): number {
  const slice = prices.slice(-(n + 1));
  if (slice.length < 2) return 0;
  let ups = 0, downs = 0;
  for (let i = 1; i < slice.length; i++) {
    const cur = slice[i] ?? 0;
    const prev = slice[i - 1] ?? 0;
    if (cur > prev) ups++;
    else if (cur < prev) downs++;
  }
  const total = ups + downs;
  return total === 0 ? 0 : (ups - downs) / total;
}

/**
 * S4 — Velocidade
 * Derivada do preço no tempo (últimos 10 candles), normalizada por vel_norm.
 * Clampada em [-1, 1].
 */
function velocity(prices: number[], timestamps: number[]): number {
  const n = Math.min(10, prices.length);
  if (n < 2) return 0;
  const p = prices.slice(-n);
  const t = timestamps.slice(-n);
  const dt = (t[t.length - 1] ?? 0) - (t[0] ?? 0);
  if (dt < 0.01) return 0;
  return clamp(((p[p.length - 1] ?? 0) - (p[0] ?? 0)) / dt / GENE.vel_norm, -1, 1);
}

/**
 * S5 — RSI normalizado
 * RSI padrão sobre os últimos rsi_n deltas, normalizado para [-1, 1]
 * via (rsi - 50) / 50.
 */
function rsi(prices: number[], n: number): number {
  if (prices.length < n + 1) return 0;
  const slice = prices.slice(-(n + 1));
  let gains = 0, losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = (slice[i] ?? 0) - (slice[i - 1] ?? 0);
    if (d > 0) gains += d;
    else losses -= d;
  }
  const ag = gains / n;
  const al = losses / n;
  if (al === 0) return 1.0;
  return (100 - 100 / (1 + ag / al) - 50) / 50;
}

/**
 * Score composto: soma ponderada dos 5 sinais, clampada em [-1, 1].
 * S3 (pressão de livro) é 0 — MarketState só expõe melhor bid/ask, sem profundidade.
 */
function computeScore(history: Candle[]): [number, number[]] {
  const prices = history.map((c) => c.close);
  const timestamps = history.map((c) => c.timestamp / 1000); // ms → segundos
  const s1 = momentum(prices, GENE.mom_curto_n);
  const s2 = momentum(prices, GENE.mom_longo_n);
  const s3 = 0;
  const s4 = velocity(prices, timestamps);
  const s5 = rsi(prices, GENE.rsi_n);
  const sc = GENE.w1 * s1 + GENE.w2 * s2 + GENE.w3 * s3 + GENE.w4 * s4 + GENE.w5 * s5;
  return [clamp(sc, -1, 1), [s1, s2, s3, s4, s5]];
}

// ─── Estado de entrada ────────────────────────────────────────────────────────

// Direção escolhida em shouldExecute e consumida por getOrderPayload no mesmo tick
let pendingSide: 'UP' | 'DOWN' = 'UP';

// ─── Estratégia ───────────────────────────────────────────────────────────────

export const polymarketSignalStrategy: OrderStrategy = {
  id: 'polymarket-signal',
  seriesIds: [], // preencher com os IDs das séries alvo

  /**
   * Decide se deve entrar numa posição.
   *
   * Janela de compra-baixa (entry_window < secsLeft < 280):
   *   entra quando o score aponta direção e o preço está abaixo de take_entry.
   *
   * Janela final (3 < secsLeft ≤ entry_window):
   *   exige score acima de min_score E probabilidade do lado ≥ min_prob.
   *   Ordem MAKER se secsLeft > 30, TAKER se ≤ 30 (resolvido em getOrderPayload).
   */
  shouldExecute(state: MarketState, history: Candle[]): boolean {
    const { bestBidUp, bestAskUp, bestBidDown, marketEndDate } = state;
    if (!bestBidUp || !bestBidDown) return false;

    const secsLeft = (marketEndDate - Date.now()) / 1000;
    if (secsLeft <= 3) return false;

    const [score] = computeScore(history);

    // Probabilidade implícita do lado UP = mid do UP
    const prob_up = bestBidUp > 0 && bestAskUp > 0
      ? (bestBidUp + bestAskUp) / 2
      : 0.5;

    if (secsLeft <= GENE.entry_window) {
      // Janela final
      if (Math.abs(score) < GENE.min_score) return false;
      const prob_lado = score > 0 ? prob_up : 1 - prob_up;
      if (prob_lado < GENE.min_prob) return false;
      pendingSide = score > 0 ? 'UP' : 'DOWN';
      return true;
    }

    if (secsLeft < 280) {
      // Janela de compra-baixa: só entra se preço estiver "barato"
      if (Math.abs(score) < GENE.min_score) return false;
      if (score > 0 && prob_up < GENE.take_entry) {
        pendingSide = 'UP';
        return true;
      }
      if (score < 0 && 1 - prob_up < GENE.take_entry) {
        pendingSide = 'DOWN';
        return true;
      }
    }

    return false;
  },

  /**
   * Monta o payload da ordem de entrada.
   * MAKER: ask - 0.02 (janela final, secsLeft > 30)
   * TAKER: ask direto (janela final, secsLeft ≤ 30, ou compra-baixa)
   */
  getOrderPayload(state: MarketState, _history: Candle[]) {
    const { bestBidUp, bestAskUp, bestBidDown, bestAskDown, upTokenId, downTokenId, marketEndDate } = state;
    const secsLeft = (marketEndDate - Date.now()) / 1000;

    // MAKER somente na janela final com tempo suficiente para o livro reagir
    const isMaker = secsLeft > 30 && secsLeft <= GENE.entry_window;

    let tokenId: string;
    let price: number;

    if (pendingSide === 'UP') {
      tokenId = upTokenId;
      price = isMaker
        ? Math.max(round2(bestAskUp - 0.02), bestBidUp)
        : Math.max(round2(bestAskUp), bestBidUp);
    } else {
      tokenId = downTokenId;
      price = isMaker
        ? Math.max(round2(bestAskDown - 0.02), bestBidDown)
        : Math.max(round2(bestAskDown), bestBidDown);
    }

    return {
      tokenId,
      side: 'BUY' as const,
      size: GENE.valor_trade,
      price,
    };
  },

  /**
   * Decide se deve fechar a posição aberta.
   * Verifica em ordem: force-exit (<3s), stop-loss, take-profit.
   */
  shouldExit(state: MarketState, pos: Order, _history: Candle[]): boolean {
    const { bestBidUp, bestBidDown, marketEndDate, upTokenId } = state;
    const secsLeft = (marketEndDate - Date.now()) / 1000;

    const isUp = pos.tokenId === upTokenId;
    const bid = isUp ? bestBidUp : bestBidDown;
    if (!bid) return false;

    // Forçar saída antes do fechamento do mercado
    if (secsLeft > 0 && secsLeft < 3) return true;

    // Stop-loss: perda fracionária ≥ stop_loss
    const perda = bid < pos.price ? (pos.price - bid) / pos.price : 0;
    if (perda >= GENE.stop_loss) return true;

    // Take-profit: preço de entrada barato e alvo atingido
    if (pos.price < GENE.take_entry && bid >= GENE.take_target) return true;

    return false;
  },

  /** Vende ao melhor bid atual do lado da posição. */
  getExitPayload(state: MarketState, pos: Order, _history: Candle[]) {
    const isUp = pos.tokenId === state.upTokenId;
    return {
      tokenId: pos.tokenId,
      side: 'SELL' as const,
      size: pos.size,
      price: isUp ? state.bestBidUp : state.bestBidDown,
    };
  },
};
