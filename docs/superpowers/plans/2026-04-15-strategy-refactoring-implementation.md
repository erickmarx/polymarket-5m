# Strategy Refactoring Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple strategy logic from `index.ts` into individual files in `src/strategies/` and allow strategies to target specific `seriesIds`.

**Architecture:**
1. **Types:** Add `seriesId` to `MarketState` and `seriesIds` to `OrderStrategy`.
2. **Modularization:** Move current example strategy to `src/strategies/example.ts`.
3. **Execution Logic:** Update `ExecutionModule` to manage a list of strategies and filter execution by `seriesId`.
4. **Integration:** Update `index.ts` to register strategies explicitly.

**Tech Stack:** Bun, TypeScript.

---

## Chunk 1: Types & Directory Structure

**Goal:** Update shared interfaces and set up the strategies folder.

**Files:**
- Modify: `src/types.ts`
- Create: `src/strategies/example.ts`

- [ ] **Step 1: Update types.ts**
Add `seriesId: number` to `MarketState` and `seriesIds: number[]` to `OrderStrategy`.

- [ ] **Step 2: Create src/strategies/ folder**
`mkdir -p src/strategies`

- [ ] **Step 3: Create src/strategies/example.ts**
Move the strategy from `index.ts` to this new file, exporting it as `exampleStrategy`.

- [ ] **Step 4: Run validation**
`bun run lint && bun run build`

- [ ] **Step 5: Commit**
`git add . && git commit -m "refactor: update types and create strategies folder"`

---

## Chunk 2: Module Updates

**Goal:** Populate seriesId in Discovery and filter by it in Execution.

**Files:**
- Modify: `src/modules/discovery.ts`
- Modify: `src/modules/execution.ts`

- [ ] **Step 1: Update discovery.ts**
Ensure `parseEvent` and `rebuildIndexes` include the `seriesId` in the `MarketState` object.

- [ ] **Step 2: Update execution.ts**
Update `ExecutionModule` to store a list of strategies and filter them in `evaluate`.

- [ ] **Step 3: Run validation**
`bun run lint && bun run build`

- [ ] **Step 4: Commit**
`git add . && git commit -m "feat: update discovery and execution modules for multi-strategy support"`

---

## Chunk 3: Integration & Finalization

**Goal:** Wired everything up in index.ts and clean up.

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update index.ts**
Import `exampleStrategy`, remove local strategy definition, and register it in `ExecutionModule`.

- [ ] **Step 2: Final validation**
`bun run format && bun run lint && bun run build`

- [ ] **Step 3: Final Commit**
`git add . && git commit -m "chore: finalize strategy refactoring"`
