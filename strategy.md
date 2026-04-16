# Polymarket Paper Trader — Strategy Spec

**Target:** TypeScript (any runtime)  
**Source:** `main.py` (Python 3.12)  
**Config format:** TOML (library choice left to implementer)  
**Spec style:** Language-agnostic prose  
**Scope:** Financial logic, signal generation, risk management, capital management, configuration. Infrastructure (connectivity, UI, persistence) is provided by the host platform.

---

## 1. Overview

This spec describes the trading brain of a binary-market bot. The host platform is responsible for delivering tick data (bid/ask/book updates) and executing orders. This module receives that data, computes signals, manages positions and capital, and decides when and how to act.

### Module Map

| Module | Responsibility |
|--------|---------------|
| `config` | Parse `config.toml`, export typed constants |
| `predictor` | 5 technical signals → normalized composite score |
| `trader` | Capital tracking, order simulation (paper) or stub (real) |
| `strategy` | Entry, exit, and reversal decision logic |

---

## 2. Config

Reads `config.toml`. If the file does not exist, abort with an error message. Exports these constants:

| Constant | Source | Type |
|----------|--------|------|
| `GENE` | `[gene]` table | object |
| `PAPER_MODE` | `mode.paper` | boolean |
| `CAPITAL_INICIO` | `market.capital_inicio` | float |
| `TICK` | hardcoded `0.01` | float |

### Gene Object Fields

All strategy parameters come exclusively from the `[gene]` config section. No strategy constants exist outside the gene. Fields:

```
mom_curto_n   — short momentum window (int)
mom_longo_n   — long momentum window (int)
rsi_n         — RSI period (int)
vel_norm      — velocity normalization factor (float, default 0.02 if falsy)
w1..w5        — signal weights (float)
min_score     — minimum |score| to consider entry (float)
min_prob      — minimum probability threshold for final window (float)
entry_window  — seconds before close to activate final window (float)
rev_mult      — reversal multiplier applied to min_score (float)
stop_loss     — fractional loss threshold to stop out (float)
take_entry    — price must be below this to trigger take-profit (float)
take_target   — price must reach this to take profit (float)
valor_trade   — max trade size in dollars (float)
lat_ms        — simulated order latency in milliseconds (float)
```

### TOML Schema Reference

```toml
[mode]
paper = true

[market]
capital_inicio = 100.0

[gene]
mom_curto_n  = 5
mom_longo_n  = 20
rsi_n        = 14
vel_norm     = 0.02
w1           = 0.3
w2           = 0.2
w3           = 0.2
w4           = 0.15
w5           = 0.15
min_score    = 0.3
min_prob     = 0.6
entry_window = 60.0
rev_mult     = 1.5
stop_loss    = 0.05
take_entry   = 0.4
take_target  = 0.7
valor_trade  = 10.0
lat_ms       = 250.0
```

---

## 3. Predictor (Signal Generation)

Maintains a circular price history of size `max(mom_longo_n + 5, 50)`.

### State

```
hist_up      — circular buffer of UP bid prices (float)
ts_hist      — circular buffer of timestamps matching hist_up (unix seconds)
book_up_bids — map of price → size for UP bids
book_up_asks — map of price → size for UP asks
book_dn_bids — map of price → size for DOWN bids
```

### Input Methods

**`updateBook(tok, bids, asks)`**  
Replace the full book (not merge). If `tok === "UP"`: replace `book_up_bids` and `book_up_asks`. If `tok === "DOWN"`: replace only `book_dn_bids`. Each entry in `bids`/`asks` is `{price: string, size: string}` — parse both as floats.

**`updatePrice(up_bid, dn_bid)`**  
If `up_bid` is null/undefined, do nothing. Otherwise append `up_bid` and the current unix timestamp (seconds) to their respective buffers.

### Signals

All signals return a value in `[-1.0, 1.0]`.

**S1 / S2 — Momentum(n)**

Take the last `n+1` prices from `hist_up`. Count `ups` (ticks where price rose) and `downs` (ticks where price fell). Return `(ups - downs) / (ups + downs)`. If fewer than 2 prices or total is 0, return 0.

**S3 — Book Pressure**

Sum the size of the top 5 bid levels (highest prices) → `vb`.  
Sum the size of the top 5 ask levels (lowest prices) → `va`.  
Return `(vb - va) / (vb + va)`. If book is empty, return 0.

**S4 — Velocity**

Take last 10 prices and their timestamps from `hist_up` / `ts_hist`. Compute `vel = (price[-1] - price[-10]) / (ts[-1] - ts[-10])`. If `dt < 0.01`, return 0. Normalize: `vel / vel_norm`, clamp result to `[-1, 1]`.

**S5 — RSI**

Over the last `rsi_n` price deltas: compute average gain `ag` and average loss `al`. If `al === 0`, return `1.0`. Otherwise: `rsi = 100 - 100 / (1 + ag / al)`. Normalize to `[-1, 1]` as `(rsi - 50) / 50`. Return 0 if fewer than `rsi_n + 1` prices available.

### Output Methods

**`score() → [number, number[5]]`**

```
sc = w1·S1 + w2·S2 + w3·S3 + w4·S4 + w5·S5
return [clamp(sc, -1, 1), [S1, S2, S3, S4, S5]]
```

**`midUp(up_bid, up_ask) → number | null`**  
Returns `(up_bid + up_ask) / 2`. Returns null if either argument is null.

**`bookLiquidity(preco, lado) → number`**  
Select book: `book_up_bids` if `lado === "UP"`, else `book_dn_bids`.  
Sum `size` for all levels where `|price - preco| <= TICK + 0.001`.

---

## 4. Trading

### Order

Plain data object created inside `envia()`:

```
lado:       "UP" | "DOWN"
preco:      float  — actual deducted cost (may be updated on TAKER fill)
tipo:       "MAKER" | "TAKER"
signals:    float[5]
ts_criacao: float  — unix timestamp (seconds)
ts_exec:    float  — ts_criacao + lat_ms / 1000
filled:     boolean
rejected:   boolean
age:        computed getter → now - ts_criacao
```

### PaperTrader

Simulates order execution and tracks capital through the life of a market.

**State:**

```
gene                 — reference to GENE config object
pred                 — reference to Predictor instance
capital              — float, starts at CAPITAL_INICIO
posicao              — Order | null
fila                 — Order[]
tentativas           — int (orders attempted)
preenchidos          — int (orders filled)
wins, losses         — int
stops, takes         — int (subsets of losses/wins respectively)
reversoes            — int
ultimoPnl            — float
reentryCooldownUntil — float (unix timestamp)
log                  — circular buffer, last 8 string entries
equityHist           — circular buffer, last 300 float values (initialized with CAPITAL_INICIO)
```

**Computed properties:**

- `maxDrawdown` → iterate equity history, track running peak, return `min((v - peak) / peak) * 100`
- `winRate` → `wins / (wins + losses) * 100`, or 0 if no trades
- `variacaoPct` → `(capital - CAPITAL_INICIO) / CAPITAL_INICIO * 100`

---

**`resetMercado()`**  
Clear `posicao`, `fila`, reset `reentryCooldownUntil` to 0. Called between markets.

---

**`envia(lado, preco, tipo, signals)`**  
Reject (silently return) if any of:
- `posicao` is set or `fila` is non-empty
- `now < reentryCooldownUntil`
- `bookLiquidity(preco, lado) < 1.0` — log `SEM LIQ`
- `capital < custo` — log `SEM CAPITAL`

Where `custo = min(preco, gene.valor_trade)`.

Otherwise: deduct `custo` from capital, increment `tentativas`, create Order with `lat_ms` latency, push to `fila`, log `ENV {tipo} {lado}@{custo}`.

---

**`processaFila(up_bid, up_ask, dn_bid, dn_ask)`**  
For each order in `fila`:
- If `now < ts_exec`: keep in queue, skip
- Get relevant ask: `up_ask` if `lado === "UP"`, else `dn_ask`. If null: keep in queue, skip.
- MAKER: fill if `preco >= ask - TICK`
- TAKER: always fill, update `preco = ask`
- On fill: set `filled=true`, set `posicao`, increment `preenchidos`, log `FILL`
- On reject: return `preco` to capital, log `REJEIT`

---

**`monitora(up_bid, up_ask, dn_bid, dn_ask, secs_left)`**  
Skip if no open position. Get current bid: `up_bid` if `posicao.lado === "UP"`, else `dn_bid`. Skip if null.

Loss fraction: `perda = (posicao.preco - b_now) / posicao.preco` if `b_now < posicao.preco`, else 0.

Checks in order:
1. **Stop-loss**: if `perda >= gene.stop_loss` → `_fechar(b_now, "STOP")`, increment `losses` and `stops`
2. **Take-profit**: if `posicao.preco < gene.take_entry` AND `b_now >= gene.take_target` → `_fechar(b_now, "TAKE")`, increment `wins` and `takes`
3. **Force exit**: if `0 < secs_left < 3` → `_fechar(b_now, "SAIDA<3s")`, increment `wins` or `losses` based on sign of pnl

---

**`_fechar(preco_saida, motivo)` (internal)**  
Clear `posicao`, compute `pnl = preco_saida - posicao.preco`, add `preco_saida` to capital, set `ultimoPnl = pnl`, set `reentryCooldownUntil = now + 2.0`, append capital to `equityHist`, log `{motivo} {lado} entry={preco} exit={preco_saida} pnl={pnl}`.

---

**`reverter(novo_lado, up_bid, dn_bid, up_ask, dn_ask, signals)`**  
If no open position, return. Get current bid for the active side. Close with `_fechar(b_now, "REVERT")`, increment `losses` and `reversoes`. Then immediately call `envia()` on `novo_lado` at `ask || bid` price as TAKER.

---

**`resolve(up_bid, dn_bid)`**  
Called at market close. Return each pending order's `preco` to capital, clear `fila`. If position open: winner is `"UP"` if `(up_bid ?? 0) >= (dn_bid ?? 0)`. If `posicao.lado === winner`: `_fechar(1.0, "WIN")`, increment `wins`. Otherwise: `_fechar(0.0, "LOSS")`, increment `losses`.

---

### RealTrader (Stub)

Same interface as PaperTrader. All methods are no-ops except `envia()`, which emits: `[REAL] ORDER WOULD BE SENT: {tipo} {lado}@{preco} signals={signals}`. Full implementation deferred to phase 2.

---

## 5. Strategy

Called every tick, after `processaFila` and `monitora` have run.

**Inputs:**
```
secs_left         — float: seconds until market closes
up_bid, up_ask    — float | null
dn_bid, dn_ask    — float | null
predictor         — Predictor instance
trader            — PaperTrader | RealTrader
```

Skip entirely if `up_bid` or `dn_bid` is null.

Read from gene: `min_score`, `min_prob`, `entry_window`, `rev_mult`.  
Compute: `[score, signals] = predictor.score()`, `prob_up = midUp(up_bid, up_ask) ?? 0.5`.

---

### Reversal Check (only if position open)

- If `posicao.lado === "UP"` and `score < -(min_score * rev_mult)` → `trader.reverter("DOWN", ...)`
- If `posicao.lado === "DOWN"` and `score > +(min_score * rev_mult)` → `trader.reverter("UP", ...)`
- Return after either reversal

If position or queue still exists, return.

---

### Buy-Low Window (`entry_window < secs_left < 280`)

Requires `|score| >= min_score`.

- If `score > 0` and `prob_up < gene.take_entry` → send UP TAKER at `round((up_ask ?? up_bid) - TICK, 2)`
- If `score < 0` and `(1 - prob_up) < gene.take_entry` → send DOWN TAKER at `round((dn_ask ?? dn_bid) - TICK, 2)`

---

### Final Window (`3 < secs_left <= entry_window`)

Requires `|score| >= min_score`.

Compute `prob_lado = prob_up` if `score > 0`, else `1 - prob_up`. Requires `prob_lado >= min_prob`.

Order type: MAKER if `secs_left > 30`, else TAKER.

If bullish (`score > 0`):
- MAKER price: `max(round(up_ask - 0.02, 2), up_bid)`
- TAKER price: `max(round(up_ask, 2), up_bid)`
- Call `trader.envia("UP", preco, tipo, signals)`

If bearish (`score < 0`):
- MAKER price: `max(round(dn_ask - 0.02, 2), dn_bid)`
- TAKER price: `max(round(dn_ask, 2), dn_bid)`
- Call `trader.envia("DOWN", preco, tipo, signals)`
