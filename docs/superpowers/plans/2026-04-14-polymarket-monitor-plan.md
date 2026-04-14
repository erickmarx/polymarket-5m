# Monitorador de Mercados Polymarket Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o monitorador de mercados Polymarket com descoberta, stream de preços, execução de ordens e dashboard CLI.

**Architecture:** Módulos isolados (Discovery, Monitoring, Execution, CLI) com comunicação via estado em memória e eventos.

**Tech Stack:** TypeScript, Node.js (ws, axios, ink para CLI).

---

## Chunk 1: Configuração e DiscoveryModule

### Task 1: Configuração Inicial
**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/config.ts`

- [ ] **Step 1: Inicializar projeto**
Run: `npm init -y && npm install ws axios dotenv ink react @types/ws @types/node typescript`

- [ ] **Step 2: Configurar `tsconfig.json`**
(Configuração padrão TS)

- [ ] **Step 3: Criar `src/config.ts`**
```typescript
import 'dotenv/config';

export const CONFIG = {
  api: {
    gammaBaseUrl: process.env.GAMMA_BASE_URL || "https://gamma-api.polymarket.com",
    clobBaseUrl: process.env.CLOB_BASE_URL || "https://clob.polymarket.com",
    wsUrl: process.env.WS_URL || "wss://ws-subscriptions-clob.polymarket.com/ws/market",
  }
};
```

### Task 2: DiscoveryModule
**Files:**
- Create: `src/modules/discovery.ts`

- [ ] **Step 1: Implementar busca de eventos e mapeamento de tokens**
(Implementar lógica de `GET events`, parser de `outcomes` e ordenação `marketBuffer`).

- [ ] **Step 2: Commit**

## Chunk 2: MonitoringModule e Execução

### Task 3: MonitoringModule
**Files:**
- Create: `src/modules/monitoring.ts`

- [ ] **Step 1: Implementar `PolymarketStream` com Heartbeat (30s)**

- [ ] **Step 2: Implementar ciclo de refresh (1s) e transição de mercado**

### Task 4: ExecutionModule e CLI
**Files:**
- Create: `src/modules/execution.ts`
- Create: `src/ui/cli.tsx`

- [ ] **Step 1: Implementar `ExecutionModule` (DryRun/Live)**

- [ ] **Step 2: Criar dashboard TUI com `ink`**

---
*Este plano divide o projeto em chunks lógicos para garantir TDD e verificação constante.*
