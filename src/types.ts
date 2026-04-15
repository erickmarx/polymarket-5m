export interface MarketState {
  conditionId: string;
  question: string;
  upTokenId: string;
  downTokenId: string;
  bestBidUp: number;
  bestAskUp: number;
  bestBidDown: number;
  bestAskDown: number;
  updatedAt: number;
  marketEndDate: number;
}

// Resposta de GET /events?series_id=...
export interface GammaEvent {
  id: string; // usado como conditionId
  title: string;
  startTime: string;
  endDate: string;
  volume24hr?: number;
  markets: [
    {
      outcomes: string; // JSON string: ["Yes","No"] ou ["Up","Down"]
      clobTokenIds: string; // JSON string: ["tokenA","tokenB"]
      acceptingOrders: boolean;
      volume24hr?: number;
    },
  ];
}

export interface Order {
  id: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  size: number;
  price: number;
  status: 'PENDING' | 'LIVE' | 'FILLED' | 'CANCELLED';
  createdAt: number;
  filledAt?: number;
}

export interface TradeRecord {
  conditionId: string;
  question: string;
  order: Order;
  resolvedOutcome?: string;
  pnl?: number;
  resolvedAt?: number;
}

export type OrderStrategy = {
  shouldExecute: (state: MarketState) => boolean;
  getOrderPayload: (state: MarketState) => Omit<Order, 'id' | 'status' | 'createdAt'>;
  shouldExit: (state: MarketState, currentPosition: Order) => boolean;
  getExitPayload: (
    state: MarketState,
    currentPosition: Order,
  ) => Omit<Order, 'id' | 'status' | 'createdAt'>;
};
