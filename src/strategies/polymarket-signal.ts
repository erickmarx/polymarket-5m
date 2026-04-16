import type { MarketState, Order, OrderStrategy, Candle } from '../types.ts';
import { CONFIG } from '../config.ts';

// Parâmetros genéticos da estratégia — todos os limiares e pesos vêm daqui
const GENE = {
  mom_curto_n: 5,    // janela curta de momentum
  mom_longo_n: 20,   // janela longa de momentum
  rsi_n: 14,         // período do RSI
  vel_norm: 0.02,    // fator de normalização da velocidade (preço/segundo, escala 0-1)
  w1: 0.3,           // peso S1 (momentum curto)
  w2: 0.2,           // peso S2 (momentum longo)
  w3: 0.2,           // peso S3 (pressão de livro — não disponível, sempre 0)
  w4: 0.15,          // peso S4 (velocidade)
  w5: 0.15,          // peso S5 (RSI)
  min_score: 0.3,    // score mínimo para considerar entrada
  min_prob: 0.6,     // probabilidade mínima na janela final
  entry_window: 60,  // segundos antes do fechamento que ativa a janela final
  rev_mult: 1.5,     // multiplicador do min_score para reversão
  stop_loss: 0.05,   // perda fracionária que aciona stop
  take_entry: 0.4,   // preço de entrada máximo para acionar take-profit
  take_target: 0.7,  // preço alvo para take-profit
  valor_trade: 10,   // tamanho máximo da ordem em dólares
};

const TICK = 0.01;

// Buffer de ticks por mercado (conditionId → {prices, timestamps})
// Espelha o hist_up/ts_hist do Predictor Python — opera sobre bestBidUp (escala 0-1)
const HIST_SIZE = Math.max(GENE.mom_longo_n + 5, 50);

interface TickBuffer {
  prices: number[];
  timestamps: number[];
}

const tickBuffers = new Map<string, TickBuffer>();

// Cooldown de re-entrada por mercado (unix ms) — espelha _reentry_cooldown_until do Python
const reentryCooldown = new Map<string, number>();

function getBuffer(conditionId: string): TickBuffer {
  let buf = tickBuffers.get(conditionId);
  if (!buf) {
    buf = { prices: [], timestamps: [] };
    tickBuffers.set(conditionId, buf);
  }
  return buf;
}

// Deve ser chamado todo tick, independente de posição aberta (espelha pred.update_price)
function appendTick(conditionId: string, price: number): void {
  const buf = getBuffer(conditionId);
  buf.prices.push(price);
  buf.timestamps.push(Date.now() / 1000);
  if (buf.prices.length > HIST_SIZE) {
    buf.prices.shift();
    buf.timestamps.shift();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Sinais (todos operam sobre preços 0-1 do token UP da Polymarket) ─────────

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
 * Derivada do preço do token no tempo (últimos 10 ticks), normalizada por vel_norm.
 * Clampada em [-1, 1]. vel_norm=0.02 calibrado para escala 0-1.
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
 * Score composto usando buffer de ticks do token UP (escala 0-1).
 * S3 (pressão de livro) é 0 — MarketState não expõe profundidade.
 */
function computeScore(buf: TickBuffer): [number, number[]] {
  const { prices, timestamps } = buf;
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
const pendingSideByMarket = new Map<string, 'UP' | 'DOWN'>();

// ─── Estratégia ───────────────────────────────────────────────────────────────

export const polymarketSignalStrategy: OrderStrategy = {
  id: 'polymarket-signal',
  seriesIds: CONFIG.monitoring.seriesIds,

  /**
   * Decide se deve entrar numa posição.
   * Primeiro atualiza o buffer de ticks com o bestBidUp atual.
   *
   * Janela de compra-baixa (entry_window < secsLeft < 280):
   *   entra quando o score aponta direção e o preço está abaixo de take_entry.
   *
   * Janela final (3 < secsLeft ≤ entry_window):
   *   exige score acima de min_score E probabilidade do lado ≥ min_prob.
   *   Ordem MAKER se secsLeft > 30, TAKER se ≤ 30 (resolvido em getOrderPayload).
   */
  shouldExecute(state: MarketState, _history: Candle[]): boolean {
    const { conditionId, bestBidUp, bestAskUp, bestBidDown, marketEndDate } = state;
    if (!bestBidUp || !bestBidDown) return false;

    // Tick sempre alimentado aqui (posição aberta → shouldExit cuida; sem posição → shouldExecute)
    appendTick(conditionId, bestBidUp);

    // Cooldown de 2s após saída — espelha _reentry_cooldown_until do Python
    if (Date.now() < (reentryCooldown.get(conditionId) ?? 0)) return false;

    const secsLeft = (marketEndDate - Date.now()) / 1000;
    if (secsLeft <= 3) return false;

    const buf = getBuffer(conditionId);
    const [score] = computeScore(buf);

    // Probabilidade implícita do lado UP = mid do token UP (escala 0-1)
    const prob_up = bestBidUp > 0 && bestAskUp > 0
      ? (bestBidUp + bestAskUp) / 2
      : 0.5;

    if (secsLeft <= GENE.entry_window) {
      // Janela final
      if (Math.abs(score) < GENE.min_score) return false;
      const prob_lado = score > 0 ? prob_up : 1 - prob_up;
      if (prob_lado < GENE.min_prob) return false;
      pendingSideByMarket.set(conditionId, score > 0 ? 'UP' : 'DOWN');
      return true;
    }

    if (secsLeft < 280) {
      // Janela de compra-baixa: só entra se preço estiver "barato"
      if (Math.abs(score) < GENE.min_score) return false;
      if (score > 0 && prob_up < GENE.take_entry) {
        pendingSideByMarket.set(conditionId, 'UP');
        return true;
      }
      if (score < 0 && 1 - prob_up < GENE.take_entry) {
        pendingSideByMarket.set(conditionId, 'DOWN');
        return true;
      }
    }

    return false;
  },

  /**
   * Monta o payload da ordem de entrada.
   * Buy-low: ask - TICK (espelha o Python)
   * MAKER: ask - 0.02 (janela final, secsLeft > 30)
   * TAKER: ask direto (janela final, secsLeft ≤ 30)
   */
  getOrderPayload(state: MarketState, _history: Candle[]) {
    const {
      conditionId,
      bestBidUp, bestAskUp,
      bestBidDown, bestAskDown,
      upTokenId, downTokenId,
      marketEndDate,
    } = state;
    const secsLeft = (marketEndDate - Date.now()) / 1000;

    const side = pendingSideByMarket.get(conditionId) ?? 'UP';
    const inFinalWindow = secsLeft <= GENE.entry_window;
    const isMaker = inFinalWindow && secsLeft > 30;

    let tokenId: string;
    let price: number;

    if (side === 'UP') {
      tokenId = upTokenId;
      if (inFinalWindow) {
        price = isMaker
          ? Math.max(round2(bestAskUp - 0.02), bestBidUp)
          : Math.max(round2(bestAskUp), bestBidUp);
      } else {
        // buy-low: subtrai TICK do ask, igual ao Python
        price = Math.max(round2((bestAskUp || bestBidUp) - TICK), bestBidUp);
      }
    } else {
      tokenId = downTokenId;
      if (inFinalWindow) {
        price = isMaker
          ? Math.max(round2(bestAskDown - 0.02), bestBidDown)
          : Math.max(round2(bestAskDown), bestBidDown);
      } else {
        price = Math.max(round2((bestAskDown || bestBidDown) - TICK), bestBidDown);
      }
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
   * Verifica em ordem: reversão, force-exit (<3s), stop-loss, take-profit.
   *
   * Nota sobre reversão: no Python, fechar+reabrir ocorre no mesmo tick.
   * Aqui o execution loop chama shouldExecute no próximo tick após saída —
   * o efeito é equivalente desde que o score ainda esteja alto.
   */
  shouldExit(state: MarketState, pos: Order, _history: Candle[]): boolean {
    const { conditionId, bestBidUp, bestBidDown, marketEndDate, upTokenId } = state;
    const secsLeft = (marketEndDate - Date.now()) / 1000;

    const isUp = pos.tokenId === upTokenId;
    const bid = isUp ? bestBidUp : bestBidDown;
    if (!bid) return false;

    // Atualiza buffer enquanto posição aberta (shouldExecute não roda neste estado)
    // Só adiciona se bestBidUp válido — evita poluir buffer com 0 em posições DOWN
    if (bestBidUp) appendTick(conditionId, bestBidUp);

    // Reversão: score cruzou o limiar oposto com multiplicador rev_mult
    const buf = getBuffer(conditionId);
    const [score] = computeScore(buf);
    const threshold = GENE.min_score * GENE.rev_mult;

    const triggerExit = (): true => {
      reentryCooldown.set(conditionId, Date.now() + 2000);
      return true;
    };

    if (isUp && score < -threshold) return triggerExit();
    if (!isUp && score > threshold) return triggerExit();

    // Forçar saída antes do fechamento do mercado
    if (secsLeft > 0 && secsLeft < 3) return triggerExit();

    // Stop-loss: perda fracionária ≥ stop_loss
    const perda = bid < pos.price ? (pos.price - bid) / pos.price : 0;
    if (perda >= GENE.stop_loss) return triggerExit();

    // Take-profit: preço de entrada barato e alvo atingido
    if (pos.price < GENE.take_entry && bid >= GENE.take_target) return triggerExit();

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
