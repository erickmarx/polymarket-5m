# Price History Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a high-fidelity price history system (50 candles of 5m) for 8 cryptos, syncing Binance (past) and Polymarket RTDS (live) via event-driven market resolution.

**Architecture:**
1. **Config:** Map `seriesId` to `assetSymbol` (e.g., 123 -> "BTCUSDT").
2. **Bootstrap:** Parallel Binance REST calls for initial 50 candles.
3. **Live Sync:** Polymarket RTDS WebSocket updates a `currentCandle` in real-time.
4. **Resolution Sync:** CLOB WebSocket `market_resolved` event triggers the official "close" of the 5m candle.

**Tech Stack:** Bun, TypeScript, Binance API, Polymarket RTDS/CLOB WS.

---

## Chunk 1: Configuration & Types

**Goal:** Define the data structures and update the environment config.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Update types.ts**
Add `Candle` interface and update `OrderStrategy` to accept `history`.
```typescript
export interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}
```

- [ ] **Step 2: Update config.ts**
Add `seriesToAssetMap` (e.g., `seriesIds: [1, 2]`, `assets: ["BTCUSDT", "ETHUSDT"]`).

- [ ] **Step 3: Commit**
`git add src/types.ts src/config.ts && git commit -m "feat: add Candle types and asset mapping config"`

---

## Chunk 2: PriceHistoryModule (Core Logic)

**Goal:** Implement the module that fetches Binance data and manages the rolling buffer.

**Files:**
- Create: `src/modules/price-history.ts`

- [ ] **Step 1: Implement bootstrap logic**
Fetch 50 candles from Binance: `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=50`.

- [ ] **Step 2: Implement real-time update logic**
Method `update(symbol, price)` to update the `currentCandle`.

- [ ] **Step 3: Implement candle closing logic**
Method `closeCandle(symbol)` to push `currentCandle` to history and shift buffer.

- [ ] **Step 4: Commit**
`git add src/modules/price-history.ts && git commit -m "feat: implement PriceHistoryModule core and Binance bootstrap"`

---

## Chunk 3: WebSocket Integration & Event Sync

**Goal:** Connect RTDS for prices and CLOB for resolution events.

**Files:**
- Modify: `src/modules/monitoring.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Update MonitoringModule to support RTDS**
Connect to `wss://ws-live-data.polymarket.com` and pipe prices to `PriceHistoryModule`.

- [ ] **Step 2: Connect CLOB market_resolved events**
Listen for resolution events to trigger `priceHistory.closeCandle()`.

- [ ] **Step 3: Pass history to strategy in index.ts**
Ensure `execution.evaluate` receives the history from the new module.

- [ ] **Step 4: Commit**
`git add . && git commit -m "feat: integrate RTDS and CLOB events for price history sync"`

---

## Chunk 4: Validation & Cleanup

- [ ] **Step 1: Run Quality Gate**
`bun run lint && bun run build`

- [ ] **Step 2: Final Commit**
`git commit -m "chore: finalize Price History Module implementation"`
