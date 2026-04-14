Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

---

## Projeto: Polymarket Monitor

Monitor de mercados de predição Polymarket com execução de ordens em TypeScript.

### Visão Geral

Sistema que monitora em paralelo até 8 séries de mercados cripto de 5 minutos no
Polymarket, stream de preços via WebSocket CLOB, execução de ordens (DryRun/Live)
e dashboard CLI em tempo real.

### Estrutura

```
src/
├── config.ts           — CONFIG centralizado, lê .env automaticamente (Bun)
├── types.ts            — Interfaces: MarketState, Order, TradeRecord, OrderStrategy, GammaEvent
├── index.ts            — Entry point: orquestra módulos, shutdown graceful
├── modules/
│   ├── discovery.ts    — Busca séries via Gamma API, buffer por seriesId, refresh automático
│   ├── monitoring.ts   — WebSocket CLOB, subscrição multi-token, heartbeat, reconexão
│   ├── execution.ts    — DryRun/Live, guard de 1 ordem ativa por mercado (conditionId)
│   └── resolution.ts  — Consulta resolução pós-fechamento, calcula PnL, histórico
└── ui/
    └── cli.tsx         — Dashboard TUI (ink + React): mercados, ordens, PnL total
```

### Configuração (.env)

```env
TRADING_MODE=dryrun           # "live" ou "dryrun"
SERIES_IDS=1,2,3              # Até 8 seriesIds de séries cripto (imutáveis entre mercados)

# Obrigatório apenas para TRADING_MODE=live
CLOB_API_KEY=
CLOB_API_SECRET=
CLOB_API_PASSPHRASE=
PRIVATE_KEY=
PROXY_WALLET=
```

### Como rodar

```bash
cp .env.example .env
# preencher SERIES_IDS com os IDs das séries desejadas
bun start
```

### Conceitos-chave

- **seriesId**: identificador imutável de uma série de mercados. Cada série produz
  mercados consecutivos de 5 minutos. Configurado via `SERIES_IDS` no `.env`.
- **conditionId**: identificador do mercado vigente (muda a cada ciclo). Retornado
  como `event.id` pela Gamma API.
- **tokenIndex**: `Map<tokenId, conditionId>` — roteamento de mensagens WebSocket
  para o mercado correto.
- **marketBuffer**: por série, lista de mercados futuros ordenados por `endDate`.
  Auto-renovado quando `buffer.length <= 2`.

### Estratégia de execução

Implementar a interface `OrderStrategy` em `src/index.ts`:

```ts
const myStrategy: OrderStrategy = {
  shouldExecute(state: MarketState): boolean { /* ... */ },
  getOrderPayload(state: MarketState) { /* ... */ },
};
```

A estratégia é avaliada a cada `price_change` recebido do WebSocket, para cada
mercado independentemente. O guard `activeByMarket` garante no máximo 1 ordem
ativa por `conditionId`.

### Dependências externas (somente TUI)

- `ink` + `react` — dashboard CLI
- `@types/react` — tipagem React

Tudo o mais usa built-ins do Bun: `fetch`, `WebSocket`, `crypto.randomUUID()`, `.env`.

### Typecheck

```bash
bun run --bun tsc --noEmit
```
