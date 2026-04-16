#!/usr/bin/env python3
"""
Polymarket Paper Trader — gene fixo externo
Todos os parâmetros vêm do dicionário GENE abaixo.
Não há constantes globais de estratégia — tudo é lido do gene.
"""

import asyncio
import curses
import json
import logging
import sys
import time
import tomllib
from collections import deque
from collections.abc import AsyncGenerator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests
import websockets

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass


# ════════════════════════════════════════════════════════════════════
# CONFIG LOADER
# ════════════════════════════════════════════════════════════════════
def load_config(path: str = "config.toml") -> dict:
    p = Path(path)
    if not p.exists():
        print(f"[polybot] ERRO: config.toml não encontrado em '{path}'", file=sys.stderr)
        sys.exit(1)
    with open(p, "rb") as f:
        return tomllib.load(f)


# ════════════════════════════════════════════════════════════════════
# LOG MANAGEMENT
# ════════════════════════════════════════════════════════════════════
_LOGS_DIR = "logs"


def cleanup_old_logs(logs_dir: str = _LOGS_DIR) -> None:
    """Deleta arquivos .log com mtime > 24h. Cria o diretório se não existir."""
    Path(logs_dir).mkdir(parents=True, exist_ok=True)
    cutoff = time.time() - 24 * 3600
    for f in Path(logs_dir).glob("*.log"):
        if f.stat().st_mtime < cutoff:
            f.unlink()


def setup_run_logger(
    slug: str, ts: str, logs_dir: str = _LOGS_DIR
) -> tuple[logging.Logger, logging.FileHandler]:
    """Cria logger com FileHandler para este run. Retorna (logger, handler)."""
    Path(logs_dir).mkdir(parents=True, exist_ok=True)
    log_path = Path(logs_dir) / f"{ts}_{slug}.log"
    handler = logging.FileHandler(log_path, encoding="utf-8")
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s | %(levelname)-5s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        )
    )
    logger = logging.getLogger(f"polybot.{ts}")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(handler)
    # stderr: só WARNING+
    if not any(
        isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
        for h in logger.handlers
    ):
        stderr_h = logging.StreamHandler()
        stderr_h.setLevel(logging.WARNING)
        stderr_h.setFormatter(
            logging.Formatter("%(asctime)s | %(levelname)-5s | %(message)s")
        )
        logger.addHandler(stderr_h)
    return logger, handler


# ════════════════════════════════════════════════════════════════════
# CONFIG — lida de config.toml
# ════════════════════════════════════════════════════════════════════
_CFG = load_config()
GENE: dict = _CFG["gene"]
PAPER_MODE: bool = _CFG["mode"]["paper"]
HEADLESS: bool = _CFG["mode"]["headless"]
SERIES_ID: str = _CFG["market"]["series_id"]
MARKET_SLUG: str = _CFG["market"]["slug"]
WS_URL: str = _CFG["market"]["ws_url"]
GAMMA = "https://gamma-api.polymarket.com"
CAPITAL_INICIO: float = _CFG["market"]["capital_inicio"]
TICK = 0.01


# ════════════════════════════════════════════════════════════════════
# PREDICTOR  (parametrizado pelo gene)
# ════════════════════════════════════════════════════════════════════
class Predictor:
    def __init__(self, gene: dict):
        self.g = gene
        n = max(gene["mom_longo_n"] + 5, 50)
        self.hist_up: deque[float] = deque(maxlen=n)
        self.ts_hist: deque[float] = deque(maxlen=n)
        self.book_up_bids: dict[float, float] = {}
        self.book_up_asks: dict[float, float] = {}
        self.book_dn_bids: dict[float, float] = {}

    def update_book(self, tok, bids_l, asks_l):
        if tok == "UP":
            self.book_up_bids = {float(x["price"]): float(x["size"]) for x in bids_l}
            self.book_up_asks = {float(x["price"]): float(x["size"]) for x in asks_l}
        else:
            self.book_dn_bids = {float(x["price"]): float(x["size"]) for x in bids_l}

    def update_price(self, up_bid, dn_bid):
        if up_bid is None:
            return
        self.hist_up.append(up_bid)
        self.ts_hist.append(time.time())

    def _momentum(self, n):
        h = list(self.hist_up)
        n = min(n, len(h) - 1)
        if n < 2:
            return 0.0
        recent = h[-(n + 1) :]
        ups = sum(1 for i in range(1, len(recent)) if recent[i] > recent[i - 1])
        downs = sum(1 for i in range(1, len(recent)) if recent[i] < recent[i - 1])
        t = ups + downs
        return (ups - downs) / t if t else 0.0

    def _book_pressure(self):
        if not self.book_up_bids or not self.book_up_asks:
            return 0.0
        vb = sum(s for _, s in sorted(self.book_up_bids.items(), reverse=True)[:5])
        va = sum(s for _, s in sorted(self.book_up_asks.items())[:5])
        t = vb + va
        return (vb - va) / t if t else 0.0

    def _velocidade(self):
        h = list(self.hist_up)
        ts = list(self.ts_hist)
        n = 10
        if len(h) < n:
            return 0.0
        dt = ts[-1] - ts[-n]
        if dt < 0.01:
            return 0.0
        vel = (h[-1] - h[-n]) / dt
        norm = self.g["vel_norm"] or 0.02
        return max(-1.0, min(1.0, vel / norm))

    def _rsi(self):
        h = list(self.hist_up)
        n = int(self.g["rsi_n"])
        if len(h) < n + 1:
            return 0.0
        deltas = [h[i] - h[i - 1] for i in range(len(h) - n, len(h))]
        ag = sum(d for d in deltas if d > 0) / n
        al = sum(-d for d in deltas if d < 0) / n
        if al == 0:
            return 1.0
        rsi = 100 - 100 / (1 + ag / al)
        return (rsi - 50) / 50

    def score(self):
        g = self.g
        s1 = self._momentum(int(g["mom_curto_n"]))
        s2 = self._momentum(int(g["mom_longo_n"]))
        s3 = self._book_pressure()
        s4 = self._velocidade()
        s5 = self._rsi()
        sc = g["w1"] * s1 + g["w2"] * s2 + g["w3"] * s3 + g["w4"] * s4 + g["w5"] * s5
        return max(-1.0, min(1.0, sc)), [s1, s2, s3, s4, s5]

    def mid_up(self, up_bid, up_ask):
        if up_bid is None or up_ask is None:
            return None
        return (up_bid + up_ask) / 2

    def book_liquidity(self, preco, lado) -> float:
        book = self.book_up_bids if lado == "UP" else self.book_dn_bids
        return sum(s for p, s in book.items() if abs(p - preco) <= TICK + 0.001)


# ════════════════════════════════════════════════════════════════════
# ORDEM
# ════════════════════════════════════════════════════════════════════
class Order:
    def __init__(self, lado, preco, tipo, signals, lat_ms):
        self.lado = lado
        self.preco = preco
        self.tipo = tipo
        self.signals = signals
        self.ts_criacao = time.time()
        self.ts_exec = self.ts_criacao + lat_ms / 1000.0
        self.filled = False
        self.rejected = False

    @property
    def age(self):
        return time.time() - self.ts_criacao


# ════════════════════════════════════════════════════════════════════
# WS CONNECTION  (reconnect + keepalive)
# ════════════════════════════════════════════════════════════════════
class WSConnection:
    """WebSocket com reconnect automático e keepalive via PING/PONG aplicacional."""

    _PING_INTERVAL = 20.0
    _PONG_TIMEOUT = 10.0

    def __init__(self, url: str, run_logger: logging.Logger) -> None:
        self._url = url
        self._logger = run_logger
        self._ws: Any = None
        self._tok_up: str = ""
        self._tok_dn: str = ""
        self._attempt: int = 0

    def _next_backoff(self) -> float:
        return min(float(2**self._attempt), 30.0)

    async def connect(self, tok_up: str, tok_dn: str) -> None:
        self._tok_up = tok_up
        self._tok_dn = tok_dn
        await self._do_connect()

    async def _do_connect(self) -> None:
        self._ws = await websockets.connect(self._url, ping_interval=None)
        await self._ws.send(
            json.dumps(
                {
                    "assets_ids": [self._tok_up, self._tok_dn],
                    "type": "market",
                    "custom_feature_enabled": True,
                }
            )
        )
        self._attempt = 0
        self._logger.info("WS connected")

    async def _keepalive(self) -> None:
        while True:
            await asyncio.sleep(self._PING_INTERVAL)
            if self._ws is None:
                continue
            try:
                await asyncio.wait_for(self._ws.send("PING"), timeout=self._PONG_TIMEOUT)
            except Exception:
                self._logger.warning("WS keepalive falhou — forçando reconexão")
                try:
                    await self._ws.close()
                except Exception:
                    pass
                self._ws = None
                break

    async def messages(self, end_dt: datetime) -> AsyncGenerator[dict, None]:
        """Yield mensagens parsed. Reconecta se cair, até mercado fechar."""
        while True:
            ping_task = asyncio.create_task(self._keepalive())
            try:
                assert self._ws is not None
                async for raw in self._ws:
                    if raw == "PONG":
                        continue
                    try:
                        data = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    items = data if isinstance(data, list) else [data]
                    for item in items:
                        if isinstance(item, dict):
                            yield item
            except websockets.exceptions.ConnectionClosed:
                pass
            finally:
                ping_task.cancel()

            secs_left = (end_dt - datetime.now(timezone.utc)).total_seconds()
            if secs_left < 0:
                self._logger.info("Mercado encerrado durante reconexão — abortando")
                return

            delay = self._next_backoff()
            self._attempt += 1
            self._logger.warning(
                f"WS disconnected — reconnect attempt {self._attempt} backoff={delay:.0f}s"
            )
            await asyncio.sleep(delay)
            try:
                await self._do_connect()
            except Exception as e:
                self._logger.error(f"Reconnect failed: {e}")

    @property
    def connected(self) -> bool:
        return self._ws is not None and not self._ws.closed

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass


# ════════════════════════════════════════════════════════════════════
# PAPER TRADER  (usa gene para todos os parâmetros)
# ════════════════════════════════════════════════════════════════════
class PaperTrader:
    def __init__(self, gene: dict, pred: Predictor):
        self.gene = gene
        self.pred = pred
        self.capital = CAPITAL_INICIO
        self.posicao: Order | None = None
        self._fila: list[Order] = []
        self.tentativas = 0
        self.preenchidos = 0
        self.wins = self.losses = self.stops = self.takes = self.reversoes = 0
        self.ultimo_pnl = 0.0
        self._reentry_cooldown_until: float = 0.0
        self.log: deque[str] = deque(maxlen=8)
        self.equity_hist: deque[float] = deque(maxlen=300)
        self.equity_hist.append(CAPITAL_INICIO)

    def _log(self, msg: str) -> None:
        self.log.append(f"{datetime.now().strftime('%H:%M:%S')} {msg}")
        if hasattr(self, "_run_logger"):
            self._run_logger.info(msg)  # type: ignore[attr-defined]

    def _fechar(self, preco_saida, motivo):
        o = self.posicao
        self.posicao = None
        pnl = preco_saida - o.preco
        self.capital += preco_saida
        self.ultimo_pnl = pnl
        self._reentry_cooldown_until = time.time() + 2.0
        self.equity_hist.append(self.capital)
        self._log(
            f"{motivo} {o.lado} entry={o.preco:.3f} "
            f"exit={preco_saida:.3f} pnl={pnl:+.4f}"
        )
        return pnl

    @property
    def max_drawdown(self):
        eq = list(self.equity_hist)
        peak = eq[0]
        dd = 0.0
        for v in eq:
            peak = max(peak, v)
            dd = min(dd, (v - peak) / peak)
        return dd * 100

    @property
    def win_rate(self):
        t = self.wins + self.losses
        return (self.wins / t * 100) if t else 0.0

    @property
    def variacao_pct(self):
        return ((self.capital - CAPITAL_INICIO) / CAPITAL_INICIO) * 100

    def reset_mercado(self):
        self.posicao = None
        self._fila = []
        self._reentry_cooldown_until = 0.0

    # ── Enviar ordem ──────────────────────────────────────────────
    def envia(self, lado, preco, tipo, signals):
        if self.posicao or self._fila:
            return
        if time.time() < self._reentry_cooldown_until:
            return

        liq = self.pred.book_liquidity(preco, lado)
        if liq < 1.0:
            self._log(f"SEM LIQ {lado}@{preco:.3f} liq={liq:.1f}")
            return

        custo = min(float(preco), float(self.gene["valor_trade"]))
        if self.capital < custo:
            self._log("SEM CAPITAL")
            return

        self.tentativas += 1
        self.capital -= custo
        lat = float(self.gene["lat_ms"])
        o = Order(lado, custo, tipo, signals, lat)
        self._fila.append(o)
        self._log(f"ENV {tipo} {lado}@{custo:.3f} lat={lat:.0f}ms")

    # ── Processar latência ────────────────────────────────────────
    def processa_fila(self, up_bid, up_ask, dn_bid, dn_ask):
        now = time.time()
        nova = []
        for o in self._fila:
            if now < o.ts_exec:
                nova.append(o)
                continue

            ask_n = up_ask if o.lado == "UP" else dn_ask
            if ask_n is None:
                nova.append(o)
                continue

            if o.tipo == "MAKER":
                fill_ok = o.preco >= ask_n - TICK
            else:
                o.preco = ask_n  # taker: executa ao preço atual
                fill_ok = True

            if fill_ok:
                o.filled = True
                self.posicao = o
                self.preenchidos += 1
                self._log(f"FILL {o.tipo} {o.lado}@{o.preco:.3f}")
            else:
                self.capital += o.preco
                self._log(f"REJEIT {o.lado}@{o.preco:.3f} ask={ask_n:.3f}")
        self._fila = nova

    # ── Monitorar posição ─────────────────────────────────────────
    def monitora(self, up_bid, up_ask, dn_bid, dn_ask, secs_left):
        if not self.posicao:
            return
        o = self.posicao
        b_now = up_bid if o.lado == "UP" else dn_bid
        if b_now is None:
            return

        perda = (o.preco - b_now) / o.preco if b_now < o.preco else 0

        # Stop-loss — gene["stop_loss"]
        if perda >= float(self.gene["stop_loss"]):
            pnl = self._fechar(b_now, "STOP")
            self.losses += 1
            self.stops += 1
            return

        # Take-profit — só dispara se take_target > take_entry
        if o.preco < float(self.gene["take_entry"]) and b_now >= float(
            self.gene["take_target"]
        ):
            pnl = self._fechar(b_now, "TAKE")
            self.wins += 1
            self.takes += 1
            return

        # Saída forçada <3s
        if 0 < secs_left < 3:
            pnl = self._fechar(b_now, "SAIDA<3s")
            if pnl >= 0:
                self.wins += 1
            else:
                self.losses += 1

    # ── Reversão ─────────────────────────────────────────────────
    def reverter(self, novo_lado, up_bid, dn_bid, up_ask, dn_ask, signals):
        if not self.posicao:
            return
        b_now = up_bid if self.posicao.lado == "UP" else dn_bid
        if b_now is None:
            return
        self._fechar(b_now, "REVERT")
        self.losses += 1
        self.reversoes += 1
        preco = (up_ask or up_bid) if novo_lado == "UP" else (dn_ask or dn_bid)
        if preco:
            self.envia(novo_lado, preco, "TAKER", signals)

    # ── Resolver no fechamento ────────────────────────────────────
    def resolve(self, up_bid, dn_bid):
        for o in self._fila:
            self.capital += o.preco  # devolve pendentes
        self._fila = []
        if not self.posicao:
            return
        o = self.posicao
        venc = "UP" if (up_bid or 0) >= (dn_bid or 0) else "DOWN"
        if o.lado == venc:
            self._fechar(1.0, "WIN")
            self.wins += 1
        else:
            self._fechar(0.0, "LOSS")
            self.losses += 1


# ════════════════════════════════════════════════════════════════════
# REAL TRADER  (stub — fase 2)
# ════════════════════════════════════════════════════════════════════
_real_logger = logging.getLogger("polybot.real")


class RealTrader:
    """Interface idêntica ao PaperTrader. Implementação real em fase 2."""

    def reset_mercado(self) -> None:
        pass

    def envia(self, lado: str, preco: float, tipo: str, signals: list[float]) -> None:
        _real_logger.info(
            f"[REAL] ORDER WOULD BE SENT: {tipo} {lado}@{preco:.3f} signals={signals}"
        )

    def processa_fila(
        self,
        up_bid: float | None,
        up_ask: float | None,
        dn_bid: float | None,
        dn_ask: float | None,
    ) -> None:
        pass

    def monitora(
        self,
        up_bid: float | None,
        up_ask: float | None,
        dn_bid: float | None,
        dn_ask: float | None,
        secs_left: float,
    ) -> None:
        pass

    def resolve(self, up_bid: float | None, dn_bid: float | None) -> None:
        pass


# ════════════════════════════════════════════════════════════════════
# ESTRATÉGIA  (parâmetros do gene)
# ════════════════════════════════════════════════════════════════════
def estrategia(
    secs_left, up_bid, up_ask, dn_bid, dn_ask, pred: Predictor, paper: PaperTrader
):
    if up_bid is None or dn_bid is None:
        return

    g = paper.gene
    score, sg = pred.score()
    prob_up = pred.mid_up(up_bid, up_ask) or 0.5
    min_sc = float(g["min_score"])
    min_pr = float(g["min_prob"])
    ew = float(g["entry_window"])
    rm = float(g["rev_mult"])

    # ── Reversão ─────────────────────────────────────────────────
    if paper.posicao:
        o = paper.posicao
        if o.lado == "UP" and score < -(min_sc * rm):
            paper.reverter("DOWN", up_bid, dn_bid, up_ask, dn_ask, sg)
            return
        if o.lado == "DOWN" and score > +(min_sc * rm):
            paper.reverter("UP", up_bid, dn_bid, up_ask, dn_ask, sg)
            return

    if paper.posicao or paper._fila:
        return

    # ── Buy-low antes da janela final ────────────────────────────
    if ew < secs_left < 280 and abs(score) >= min_sc:
        if score > 0 and prob_up < float(g["take_entry"]):
            p = round((up_ask or up_bid) - TICK, 2)
            paper.envia("UP", p, "TAKER", sg)
            return
        if score < 0 and (1 - prob_up) < float(g["take_entry"]):
            p = round((dn_ask or dn_bid) - TICK, 2)
            paper.envia("DOWN", p, "TAKER", sg)
            return

    # ── Janela final ──────────────────────────────────────────────
    if not (3 < secs_left <= ew):
        return
    if abs(score) < min_sc:
        return

    prob_lado = prob_up if score > 0 else (1 - prob_up)
    if prob_lado < min_pr:
        return

    if score > 0:
        tipo = "MAKER" if secs_left > 30 else "TAKER"
        preco = round((up_ask or up_bid) - (0.02 if tipo == "MAKER" else 0), 2)
        preco = max(preco, up_bid)
        paper.envia("UP", preco, tipo, sg)
    else:
        tipo = "MAKER" if secs_left > 30 else "TAKER"
        preco = round((dn_ask or dn_bid) - (0.02 if tipo == "MAKER" else 0), 2)
        preco = max(preco, dn_bid)
        paper.envia("DOWN", preco, tipo, sg)


# ════════════════════════════════════════════════════════════════════
# API
# ════════════════════════════════════════════════════════════════════
def find_market():
    try:
        r = requests.get(f"{GAMMA}/series/{SERIES_ID}", timeout=10)
        now = datetime.now(timezone.utc)
        cands = []
        for ev in r.json().get("events", []):
            if not ev.get("active"):
                continue
            if not ev.get("slug", "").startswith(MARKET_SLUG):
                continue
            raw = ev.get("endDate", "")
            if not raw:
                continue
            end_dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if end_dt > now:
                cands.append((end_dt, ev))
        if not cands:
            return None
        cands.sort(key=lambda x: x[0])
        end_dt, ev = cands[0]
        r2 = requests.get(f"{GAMMA}/events/slug/{ev['slug']}", timeout=10)
        for mkt in r2.json().get("markets", []):
            if not mkt.get("active"):
                continue
            mid = mkt["id"]
            r3 = requests.get(f"{GAMMA}/markets/{mid}", timeout=10)
            raw_tok = r3.json().get("clobTokenIds")
            if not raw_tok:
                continue
            tokens = json.loads(raw_tok)
            if len(tokens) < 2:
                continue
            return {
                "id": mid,
                "question": mkt.get("question", ev["slug"]),
                "end_dt": end_dt,
                "token_up": tokens[0],
                "token_dn": tokens[1],
            }
    except Exception:
        return None


# ════════════════════════════════════════════════════════════════════
# DISPLAY
# ════════════════════════════════════════════════════════════════════
def safe(win, r, c, txt, attr=0):
    try:
        win.addstr(r, c, str(txt)[:80], attr)
    except curses.error:
        pass


SEP = "=" * 66
SEP2 = "-" * 66


def draw_static(win, question):
    win.clear()
    q = question[:62] if len(question) <= 62 else question[:59] + "..."
    safe(win, 0, 0, SEP)
    safe(win, 1, 0, "  POLYMARKET PAPER TRADER  |  Gene Fixo  |  Gen 168")
    safe(win, 2, 0, SEP)
    safe(win, 3, 0, f"  {q}")
    safe(win, 4, 0, "  Tempo:          Capital: $          Var:         DD:      ")
    safe(win, 5, 0, SEP2)
    safe(win, 6, 0, "  UP    bid=         ask=         prob=       ")
    safe(win, 7, 0, "  DOWN  bid=         ask=         prob=       ")
    safe(win, 8, 0, SEP2)
    safe(win, 9, 0, "  Score=          Dir=          Fase=                      ")
    safe(win, 10, 0, "  S1=mom_c   S2=mom_l   S3=book   S4=vel    S5=rsi        ")
    safe(win, 11, 0, "    ---        ---        ---       ---       ---          ")
    safe(win, 12, 0, "  Pesos: w1=      w2=      w3=      w4=      w5=          ")
    safe(win, 13, 0, SEP2)
    safe(win, 14, 0, "  [PAPER]  Fill/Tent=   /     WR=       ")
    safe(win, 15, 0, "  Wins=    Loss=    Stop=    Take=    Rev=    PnL=         ")
    safe(win, 16, 0, "  Posicao:                                                 ")
    safe(win, 17, 0, "  Gene:  ms=       sc=       pr=       sl=       ew=       ")
    safe(win, 18, 0, SEP2)
    safe(win, 19, 0, "  LOG:")
    for i in range(8):
        safe(win, 20 + i, 2, " " * 62)
    safe(win, 28, 0, SEP2)
    safe(win, 29, 0, "  Msgs/s:         | lat=250ms fixo | Ctrl+C sair  Up:         ")
    safe(win, 30, 0, SEP)
    win.refresh()


def draw_values(
    win, end_dt, up_bid, up_ask, dn_bid, dn_ask, msg_count, start_time, pred, paper,
    bot_start_time: float = 0.0,
):
    g = paper.gene
    secs = (end_dt - datetime.now(timezone.utc)).total_seconds()
    tl = "FECHADO" if secs <= 0 else f"{int(secs // 60):02d}:{int(secs % 60):02d}"
    var = paper.variacao_pct
    vs = f"+{var:.2f}%" if var >= 0 else f"{var:.2f}%"

    safe(win, 4, 8, f"{tl}       ")
    safe(win, 4, 22, f"${paper.capital:.4f}  ")
    safe(win, 4, 40, f"{vs}      ")
    safe(win, 4, 52, f"{paper.max_drawdown:.1f}%  ")

    if up_bid is not None:
        pu = ((up_bid + (up_ask or up_bid)) / 2) * 100
        safe(win, 6, 10, f"{up_bid:.4f}  ")
        safe(win, 6, 22, f"{(up_ask or 0):.4f}  ")
        safe(win, 6, 34, f"{pu:.1f}%  ")
    if dn_bid is not None:
        pd = ((dn_bid + (dn_ask or dn_bid)) / 2) * 100
        safe(win, 7, 10, f"{dn_bid:.4f}  ")
        safe(win, 7, 22, f"{(dn_ask or 0):.4f}  ")
        safe(win, 7, 34, f"{pd:.1f}%  ")

    score, sinais = pred.score()
    dir_t = "UP  " if score > 0.05 else ("DOWN" if score < -0.05 else "----")

    ew = float(g["entry_window"])
    if secs > 280:
        fase = "observando"
    elif secs > ew:
        fase = f"buy-low(>{ew:.0f}s)"
    elif secs > 30:
        fase = "maker zone"
    elif secs > 10:
        fase = "taker zone"
    elif secs > 3:
        fase = "max-agress"
    else:
        fase = "SAINDO<3s "

    safe(win, 9, 8, f"{score:+.5f}      ")
    safe(win, 9, 24, f"{dir_t}          ")
    safe(win, 9, 38, fase)

    cols = [4, 15, 26, 36, 46]
    for i, (s, col) in enumerate(zip(sinais, cols)):
        safe(win, 11, col, f"{s:+.3f}  ")

    ws = [g["w1"], g["w2"], g["w3"], g["w4"], g["w5"]]
    safe(win, 12, 11, f"{ws[0]:.4f}  ")
    safe(win, 12, 20, f"{ws[1]:.4f}  ")
    safe(win, 12, 29, f"{ws[2]:.4f}  ")
    safe(win, 12, 38, f"{ws[3]:.4f}  ")
    safe(win, 12, 47, f"{ws[4]:.4f}  ")

    safe(win, 14, 18, f"{paper.preenchidos:<4}")
    safe(win, 14, 23, f"{paper.tentativas:<5}")
    safe(win, 14, 32, f"{paper.win_rate:.1f}%  ")

    safe(win, 15, 8, f"{paper.wins:<5}")
    safe(win, 15, 16, f"{paper.losses:<5}")
    safe(win, 15, 24, f"{paper.stops:<5}")
    safe(win, 15, 32, f"{paper.takes:<5}")
    safe(win, 15, 40, f"{paper.reversoes:<5}")
    pnl_s = f"{paper.ultimo_pnl:+.4f}" if paper.ultimo_pnl else "---    "
    safe(win, 15, 48, pnl_s)

    if paper.posicao:
        o = paper.posicao
        b_now = up_bid if o.lado == "UP" else dn_bid
        pnow = (b_now or o.preco) - o.preco
        safe(
            win,
            16,
            11,
            f"{o.tipo} {o.lado}@{o.preco:.3f} age={o.age:.1f}s pnl={pnow:+.3f}   ",
        )
    elif paper._fila:
        safe(
            win,
            16,
            11,
            f"PENDENTE lat={paper._fila[0].ts_exec - time.time():.2f}s restando  ",
        )
    else:
        safe(win, 16, 11, "nenhuma                                        ")

    safe(win, 17, 10, f"{g['lat_ms']:.0f}ms  ")
    safe(win, 17, 18, f"{g['min_score']:.3f}  ")
    safe(win, 17, 27, f"{g['min_prob']:.3f}  ")
    safe(win, 17, 36, f"{g['stop_loss']:.3f}  ")
    safe(win, 17, 45, f"{g['entry_window']:.0f}s  ")

    logs = list(paper.log)
    for i in range(8):
        txt = logs[i - (8 - len(logs))] if i >= (8 - len(logs)) else ""
        safe(win, 20 + i, 2, f"{txt:<62}")

    elapsed = time.time() - start_time
    mps = msg_count / elapsed if elapsed > 0 else 0
    safe(win, 29, 10, f"{mps:>6.1f}  ")
    uptime = time.time() - (bot_start_time or start_time)
    uptime_h = int(uptime // 3600)
    uptime_m = int((uptime % 3600) // 60)
    uptime_s = int(uptime % 60)
    safe(win, 29, 54, f"{uptime_h:02d}:{uptime_m:02d}:{uptime_s:02d}  ")
    win.refresh()


# ════════════════════════════════════════════════════════════════════
# WEBSOCKET
# ════════════════════════════════════════════════════════════════════
async def monitor(win, mkt, paper: PaperTrader, bot_start_time: float):
    tok_up = mkt["token_up"]
    tok_dn = mkt["token_dn"]
    bid = {tok_up: None, tok_dn: None}
    ask = {tok_up: None, tok_dn: None}

    msg_count = 0
    start_time = time.time()

    # — logging por run —
    cleanup_old_logs()
    ts = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    run_logger, run_handler = setup_run_logger(
        mkt["question"][:30].replace(" ", "-"), ts
    )
    mode_str = "paper" if PAPER_MODE else "real"
    run_logger.info(f"polybot startup | mode={mode_str} | market={mkt['question'][:60]}")
    paper._run_logger = run_logger  # type: ignore[attr-defined]

    paper.reset_mercado()
    draw_static(win, mkt["question"])

    ws_conn = WSConnection(WS_URL, run_logger)
    try:
        await ws_conn.connect(tok_up, tok_dn)
    except Exception as e:
        safe(win, 31, 0, f"Falha WS: {e}")
        win.refresh()
        await asyncio.sleep(5)
        return

    up_bid = up_ask = dn_bid = dn_ask = None

    def upd(aid, b, a):
        if aid in bid:
            if b is not None:
                bid[aid] = float(b)
            if a is not None:
                ask[aid] = float(a)

    try:
        async for item in ws_conn.messages(mkt["end_dt"]):
            et = item.get("event_type", "")
            aid = item.get("asset_id")
            tok = "UP" if aid == tok_up else "DOWN"

            if et == "best_bid_ask":
                upd(aid, item.get("best_bid"), item.get("best_ask"))
            elif et == "book":
                bl = item.get("bids", [])
                al = item.get("asks", [])
                bb = max((float(x["price"]) for x in bl), default=None)
                ba = min((float(x["price"]) for x in al), default=None)
                upd(aid, bb, ba)
                paper.pred.update_book(tok, bl, al)
            elif et == "price_change":
                for ch in item.get("price_changes", []):
                    upd(ch.get("asset_id"), ch.get("best_bid"), ch.get("best_ask"))

            up_bid = bid[tok_up]
            up_ask = ask[tok_up]
            dn_bid = bid[tok_dn]
            dn_ask = ask[tok_dn]

            paper.pred.update_price(up_bid, dn_bid)
            secs_left = (mkt["end_dt"] - datetime.now(timezone.utc)).total_seconds()

            paper.processa_fila(up_bid, up_ask, dn_bid, dn_ask)
            paper.monitora(up_bid, up_ask, dn_bid, dn_ask, secs_left)
            estrategia(secs_left, up_bid, up_ask, dn_bid, dn_ask, paper.pred, paper)
            draw_values(
                win,
                mkt["end_dt"],
                up_bid,
                up_ask,
                dn_bid,
                dn_ask,
                msg_count,
                start_time,
                paper.pred,
                paper,
                bot_start_time,
            )
            msg_count += 1

            if secs_left < -3:
                break

    except KeyboardInterrupt:
        raise
    finally:
        paper.resolve(up_bid, dn_bid)
        run_logger.info(
            f"market closed | capital={paper.capital:.4f} | wins={paper.wins} "
            f"losses={paper.losses} wr={paper.win_rate:.1f}% dd={paper.max_drawdown:.1f}%"
        )
        run_handler.close()
        run_logger.removeHandler(run_handler)
        await ws_conn.close()


# ════════════════════════════════════════════════════════════════════
# MAIN
# ════════════════════════════════════════════════════════════════════
async def run(win):
    curses.curs_set(0)
    win.nodelay(True)

    pred = Predictor(GENE)
    paper: PaperTrader | RealTrader = PaperTrader(GENE, pred) if PAPER_MODE else RealTrader()
    bot_start_time = time.time()

    while True:
        win.clear()
        safe(win, 0, 0, "Buscando mercado ativo...")
        win.refresh()
        mkt = find_market()
        if not mkt:
            safe(win, 1, 0, "Nenhum mercado ativo. Tentando em 15s...")
            win.refresh()
            await asyncio.sleep(15)
            continue
        try:
            await monitor(win, mkt, paper, bot_start_time)
        except KeyboardInterrupt:
            break
        win.clear()
        safe(win, 0, 0, "Mercado encerrado. Buscando proximo em 5s...")
        win.refresh()
        await asyncio.sleep(5)


async def run_headless() -> None:
    """Modo sem TUI curses — só logging. Para Docker detached ou systemd."""

    class _NullWin:
        def clear(self) -> None:
            pass

        def refresh(self) -> None:
            pass

        def nodelay(self, flag: bool) -> None:
            pass

        def addstr(self, *args: object) -> None:
            pass

    null_win = _NullWin()
    pred = Predictor(GENE)
    paper: PaperTrader | RealTrader = PaperTrader(GENE, pred) if PAPER_MODE else RealTrader()

    while True:
        mkt = find_market()
        if not mkt:
            logging.warning("Nenhum mercado ativo. Tentando em 15s...")
            await asyncio.sleep(15)
            continue
        try:
            await monitor(null_win, mkt, paper)  # type: ignore[arg-type]
        except KeyboardInterrupt:
            break
        await asyncio.sleep(5)


def main() -> None:
    if HEADLESS:
        asyncio.run(run_headless())
    else:
        curses.wrapper(lambda win: asyncio.run(run(win)))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Encerrado.")
