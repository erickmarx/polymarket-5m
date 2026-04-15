import type { MarketState, Order, OrderStrategy, Candle } from "../types.ts";

export const exampleStrategy: OrderStrategy = {
  id: "example-rsi-strat",
  seriesIds: [10684, 10685, 10686], // Exemplo de séries alvo
  shouldExecute(state: MarketState, _history: Candle[]): boolean {
    // Muito mais permissivo: entra se houver liquidez no ask
    return state.bestAskUp > 0;
  },
  getOrderPayload(state: MarketState, _history: Candle[]) {
    return {
      tokenId: state.upTokenId,
      side: "BUY" as const,
      size: 1, // Tamanho menor para teste
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
    // Sai com qualquer lucro ou perda mínima para girar ordens rápido
    return Math.abs(pnl) > 0.001; 
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
