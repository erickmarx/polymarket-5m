# Spec: Price History Module for Polymarket 5M Monitor

**Date:** 2026-04-15
**Status:** Draft
**Goal:** Implement a high-fidelity price history system for 8 cryptocurrencies using Binance for historical data and Polymarket RTDS for real-time synchronization, aligned with 5-minute market resolution events.

---

## 1. Overview
The `PriceHistoryModule` serves as a high-frequency data warehouse for the trading bot. It maintains a rolling buffer of the last 50 candles (5m interval) for up to 8 assets. It ensures that candle closing is perfectly synchronized with Polymarket's market resolution cycle rather than local system time.

## 2. Architecture & Components

### 2.1 PriceHistoryModule (Core)
- **State Management:** A `Map<string, Candle[]>` storing the historical buffer and a `Map<string, Candle>` for the active "open" candle.
- **Synchronization Logic:** Listens to `market_resolved` events from the CLOB WebSocket to trigger candle closing.
- **Provider Aggregator:** Orchestrates Binance (REST) for initialization and Polymarket RTDS (WS) for live updates.

### 2.2 Data Sources
- **Binance REST API (`/api/v3/klines`):** Source for the initial 50 candles of 5m intervals.
- **Polymarket RTDS WebSocket (`ws-live-data.polymarket.com`):** Source for real-time spot price updates (Binance/Pyth feeds).
- **Polymarket CLOB WebSocket (`ws-subscriptions-clob.polymarket.com`):** Source for `market_resolved` events used as the primary sync signal.

## 3. Detailed Workflow

### 3.1 Bootstrap (Initialization)
1. For each `seriesId` in configuration:
   - Identify the underlying asset (e.g., BTCUSDT).
   - Fetch the last 50 candles from Binance: `GET https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=50`.
   - Store in `histories` map.
   - Initialize the `currentCandle` for the active interval.

### 3.2 Real-time Streaming
1. Subscribe to RTDS `crypto_price` topic for all 8 symbols.
2. On every price update:
   - Update `Close` price of the `currentCandle`.
   - Update `High` if price > current High.
   - Update `Low` if price < current Low.
   - Accumulate `Volume` (if provided by RTDS).

### 3.3 Event-Driven Candle Closing
1. Monitor CLOB WebSocket for `market_resolved` events.
2. When an event matches an active `conditionId`:
   - "Close" the `currentCandle` for that asset.
   - Push to `histories` buffer.
   - Shift the buffer (remove index 0) to maintain size 50.
   - Create a new `currentCandle` with Open = previous Close.

### 3.4 Fallback Synchronization
- If no `market_resolved` is received within 10 seconds of the 5m UTC mark (e.g., 10:05:10), the module triggers an emergency close using the local clock/exchange timestamp to prevent data corruption.

## 4. Strategy Interface Expansion
The `OrderStrategy` will be updated to include history in its evaluation:

```typescript
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number; // UTC Open Time
}

// Updated Strategy Interface
shouldExecute: (state: MarketState, history: Candle[]) => boolean;
```

## 5. Performance & Reliability
- **Memory:** ~8 symbols * 50 candles * small object size = negligible (< 1MB).
- **Network:** Single WS connection for RTDS, single WS connection for CLOB (shared with existing monitoring).
- **Race Conditions:** Use a locking mechanism or sequential processing for candle closing to ensure no price updates are lost during the push to history.

---
