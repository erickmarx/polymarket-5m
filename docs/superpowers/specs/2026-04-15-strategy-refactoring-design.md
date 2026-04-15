# Spec: Strategy Refactoring for Polymarket 5M Monitor

**Date:** 2026-04-15
**Status:** Draft
**Goal:** Decouple the strategy logic from `src/index.ts` into individual files within `src/strategies/`, and allow strategies to target specific `seriesIds`.

---

## 1. Overview
The current strategy implementation is hardcoded in `src/index.ts`. This refactor will move strategies to a dedicated folder, update the `OrderStrategy` type to include metadata (target series), and update the `ExecutionModule` to evaluate strategies based on market series.

## 2. Changes

### 2.1 Types (`src/types.ts`)
Update `OrderStrategy` to include `seriesIds: number[]`.

### 2.2 Directory Structure
- Create `src/strategies/`
- Create `src/strategies/example.ts` (moving the current example strategy there).

### 2.3 ExecutionModule (`src/modules/execution.ts`)
- Update `evaluate(state, history, seriesId)` to check if the strategy is allowed to run for that `seriesId`.
- Support multiple strategies or a single strategy filter.

### 2.4 Index (`src/index.ts`)
- Import strategies from `src/strategies/`.
- Register them in `ExecutionModule`.

## 3. Workflow Details

1. **Strategy Filter:** Before calling `shouldExecute`, the `ExecutionModule` will check if `state.seriesId` (to be added to `MarketState`) exists in the strategy's `seriesIds` array.
2. **MarketState Update:** Add `seriesId: number` to the `MarketState` interface to allow filtering.

## 4. Implementation Plan (Bite-sized)
1. Update `types.ts` with `OrderStrategy` and `MarketState` changes.
2. Create `src/strategies/example.ts`.
3. Update `DiscoveryModule` to populate `seriesId` in `MarketState`.
4. Update `ExecutionModule` to filter by `seriesId`.
5. Update `index.ts` to use the new file.

---
