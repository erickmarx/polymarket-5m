import type { MarketState, Order, OrderStrategy, Candle } from "../types.ts";

export const exampleStrategy: OrderStrategy = {
  seriesIds: [10684, 10685, 10686], // Exemplo de séries alvo
  shouldExecute(state: MarketState, history: Candle[]): boolean {
    if (history.length < 2) return state.bestAskUp > 0 && state.bestAskUp < 0.45;
    return state.bestAskUp > 0 && state.bestAskUp < 0.45;
  },
  getOrderPayload(state: MarketState, _history: Candle[]) {
    return {
      tokenId: state.upTokenId,
      side: "BUY" as const,
      size: 10,
      price: state.bestAskUp,
    };
  },
  shouldExit(
    state: MarketState,
    currentPosition: Order,
    _history: Candle[],
  ): boolean {
    const currentPrice =
      currentPosition.tokenId === state.upTokenId
        ? state.bestBidUp
        : state.bestBidDown;
    if (currentPrice === 0) return false;
    const pnl = currentPrice - currentPosition.price;
    return pnl > 0.05 || pnl < -0.02;
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
