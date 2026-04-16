import type { MarketState, Order, OrderStrategy, Candle } from "../types.ts";

let lastActionTime = 0;
const TEST_INTERVAL_MS = 1000;

export const exampleStrategy: OrderStrategy = {
  id: "example-test-strat",
  seriesIds: [10684, 10685, 10686],
  shouldExecute(state: MarketState, _history: Candle[]): boolean {
    const now = Date.now();
    if (now - lastActionTime < TEST_INTERVAL_MS) return false;

    // Entrada ultra-permissiva para teste constante
    if (state.bestAskUp > 0) {
      lastActionTime = now;
      return true;
    }
    return false;
  },
  getOrderPayload(state: MarketState, _history: Candle[]) {
    return {
      tokenId: state.upTokenId,
      side: "BUY" as const,
      size: 1,
      price: state.bestAskUp,
    };
  },
  shouldExit(
    _state: MarketState,
    _currentPosition: Order,
    _history: Candle[],
  ): boolean {
    const now = Date.now();
    if (now - lastActionTime < TEST_INTERVAL_MS) return false;

    // Saída imediata após o intervalo para testar fluxo da UI
    lastActionTime = now;
    return true;
  },
  getExitPayload(
    state: MarketState,
    currentPosition: Order,
    _history: Candle[],
  ) {
    return {
      tokenId: currentPosition.tokenId,
      side: "SELL" as const,
      size: currentPosition.size,
      price:
        currentPosition.tokenId === state.upTokenId
          ? state.bestBidUp
          : state.bestBidDown,
    };
  },
};
