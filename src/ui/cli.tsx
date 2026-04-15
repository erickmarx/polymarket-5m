import React, { useState, useEffect } from 'react';
import { render, Box, Text, Newline } from 'ink';
import type { MarketState, Order, TradeRecord } from '../types.ts';

interface DashboardProps {
  getMarkets: () => Map<string, MarketState>;
  getConnectionStatus: () => 'connected' | 'disconnected' | 'connecting';
  getActiveOrders: () => Order[];
  getFilledOrders: () => Order[];
  getHistory: () => TradeRecord[];
  getTotalPnL: () => number;
  mode: 'live' | 'dryrun';
}

const TICK_MS = 500;

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) {
  const color = status === 'connected' ? 'green' : status === 'connecting' ? 'yellow' : 'red';
  const symbol = status === 'connected' ? '●' : status === 'connecting' ? '◌' : '○';
  return (
    <Text color={color}>
      {symbol} {status}
    </Text>
  );
}

function fmtAge(targetTime: number): string {
  const diff = Math.floor((targetTime - Date.now()) / 1000);
  if (diff <= 0) return '0:00';
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function MarketRow({ market }: { market: MarketState }) {
  const timeLeft = fmtAge(market.marketEndDate);

  return (
    <Box>
      <Text color="white">{market.question.slice(0, 52).padEnd(54)}</Text>
      <Text color="cyan"> UP </Text>
      <Text color="green">{market.bestBidUp > 0 ? market.bestBidUp.toFixed(3) : '-.---'}</Text>
      <Text color="gray">/</Text>
      <Text color="red">{market.bestAskUp > 0 ? market.bestAskUp.toFixed(3) : '-.---'}</Text>
      <Text color="cyan"> DN </Text>
      <Text color="green">{market.bestBidDown > 0 ? market.bestBidDown.toFixed(3) : '-.---'}</Text>
      <Text color="gray">/</Text>
      <Text color="red">{market.bestAskDown > 0 ? market.bestAskDown.toFixed(3) : '-.---'}</Text>
      <Text dimColor> {timeLeft}</Text>
    </Box>
  );
}

function OrderRow({ order }: { order: Order }) {
  const color =
    order.status === 'FILLED' ? 'green' : order.status === 'CANCELLED' ? 'red' : 'yellow';
  return (
    <Box>
      <Text color={color}>{order.status.padEnd(10)}</Text>
      <Text>{order.side.padEnd(5)}</Text>
      <Text>size: {order.size.toFixed(2).padEnd(8)}</Text>
      <Text>@ {order.price.toFixed(4)}</Text>
    </Box>
  );
}

function Dashboard({
  getMarkets,
  getConnectionStatus,
  getActiveOrders,
  getFilledOrders,
  getHistory,
  getTotalPnL,
  mode,
}: DashboardProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(t);
  }, []);

  const markets = Array.from(getMarkets().values());
  const status = getConnectionStatus();
  const activeOrders = getActiveOrders();
  const filledOrders = getFilledOrders().slice(-5);
  const history = getHistory().slice(-5);
  const totalPnL = getTotalPnL();
  const pnlColor = totalPnL >= 0 ? 'green' : 'red';

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          POLYMARKET MONITOR
        </Text>
        <Text> </Text>
        <StatusBadge status={status} />
        <Text> </Text>
        <Text color="magenta">MODE: {mode.toUpperCase()}</Text>
        <Text> </Text>
        <Text dimColor>{markets.length} mercados</Text>
        <Text dimColor> tick:{tick}</Text>
      </Box>

      <Newline />

      {/* Markets */}
      <Box borderStyle="single" borderColor="yellow" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="yellow">
            MERCADOS
          </Text>
          <Text dimColor> {'pergunta'.padEnd(38)}UP bid/ask DN bid/ask age</Text>
        </Box>
        {markets.length === 0 ? (
          <Text color="red">Nenhum mercado carregado</Text>
        ) : (
          markets.map((m) => <MarketRow key={m.conditionId} market={m} />)
        )}
      </Box>

      <Newline />

      {/* Active Orders */}
      <Box borderStyle="single" borderColor="blue" flexDirection="column" paddingX={1}>
        <Text bold color="blue">
          ORDENS ATIVAS ({activeOrders.length})
        </Text>
        {activeOrders.length === 0 ? (
          <Text dimColor>nenhuma</Text>
        ) : (
          activeOrders.map((o) => <OrderRow key={o.id} order={o} />)
        )}
      </Box>

      <Newline />

      {/* Recent Fills */}
      <Box borderStyle="single" borderColor="green" flexDirection="column" paddingX={1}>
        <Text bold color="green">
          FILLS RECENTES (últimos 5)
        </Text>
        {filledOrders.length === 0 ? (
          <Text dimColor>nenhum</Text>
        ) : (
          filledOrders.map((o) => <OrderRow key={o.id} order={o} />)
        )}
      </Box>

      <Newline />

      {/* PnL & History */}
      <Box borderStyle="single" borderColor="magenta" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="magenta">
            HISTÓRICO
          </Text>
          <Text> PnL Total: </Text>
          <Text bold color={pnlColor}>
            {totalPnL >= 0 ? '+' : ''}
            {totalPnL.toFixed(4)} USDC
          </Text>
        </Box>
        {history.length === 0 ? (
          <Text dimColor>sem trades resolvidos</Text>
        ) : (
          history.map((r, i) => (
            <Box key={i}>
              <Text dimColor>{r.question.slice(0, 38).padEnd(40)}</Text>
              <Text>{(r.resolvedOutcome ?? '?').padEnd(12)}</Text>
              <Text color={(r.pnl ?? 0) >= 0 ? 'green' : 'red'}>
                {(r.pnl ?? 0) >= 0 ? '+' : ''}
                {(r.pnl ?? 0).toFixed(4)}
              </Text>
            </Box>
          ))
        )}
      </Box>
    </Box>
  );
}

export function startDashboard(props: DashboardProps) {
  const { unmount } = render(<Dashboard {...props} />);
  return unmount;
}
