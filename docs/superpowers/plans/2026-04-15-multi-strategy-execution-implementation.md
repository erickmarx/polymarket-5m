# Multi-Strategy Parallel Execution Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the execution of N independent trading strategies, allowing multiple overlapping positions per asset/market.

**Architecture:**
1. **Identity:** Add `strategyId` to `Order` and `id` to `OrderStrategy`.
2. **Execution:** `ExecutionModule` iterates over a list of registered strategies instead of a single strategy.
3. **Isolation:** Orders are tracked by `strategyId` + `conditionId`, allowing the same asset to be traded independently by multiple strategies.

**Tech Stack:** Bun, TypeScript.

---

## Chunk 1: Types & Identity

**Goal:** Update types to support strategy identification.

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update Order type**
Add `strategyId: string` to `Order` interface.

- [ ] **Step 2: Update OrderStrategy type**
Add `id: string` to `OrderStrategy` type.

- [ ] **Step 3: Run Validation & Commit**
`bun run lint && git add src/types.ts && git commit -m "feat: add strategyId to Order and id to OrderStrategy"`

---

## Chunk 2: Execution Module Refactor

**Goal:** Allow concurrent strategy execution.

**Files:**
- Modify: `src/modules/execution.ts`

- [ ] **Step 1: Update ExecutionModule**
Change `strategy: OrderStrategy | null` to `strategies: OrderStrategy[] = []`.

- [ ] **Step 2: Refactor evaluate logic**
Update `evaluate` to iterate through all strategies, filtering by `seriesIds`. Pass `strategy.id` to `placeOrder` to tag orders.

- [ ] **Step 3: Update currentPosition lookup**
Update `currentPosition` search to consider `strategyId`.

- [ ] **Step 4: Run Validation & Commit**
`bun run lint && bun run build && git add src/modules/execution.ts && git commit -m "feat: refactor ExecutionModule to support multiple parallel strategies"`

---

## Chunk 3: Integration in Index

**Goal:** Update `index.ts` to register multiple strategies.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update main initialization**
Use `execution.registerStrategy()` (or equivalent list management) for each strategy.

- [ ] **Step 2: Run Validation & Commit**
`bun run format && bun run lint && bun run build && git add src/index.ts && git commit -m "feat: update index.ts to support multi-strategy registration"`
