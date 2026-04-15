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
  return <Text color={color}>{symbol} {status}</Text>;
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
  // Truncagem inteligente para perguntas de 5m
  const label = market.question
    .replace("Will ", "")
    .replace(" be above $", ">")
    .replace(" at ", "@")
    .slice(0, 48);

  return (
    <Box>
      <Text color="white" dimColor={market.bestAskUp === 0}>{label.padEnd(50)}</Text>
      <Text color="cyan"> UP </Text>
      <Text color="green" bold={market.bestBidUp > 0}>{market.bestBidUp > 0 ? market.bestBidUp.toFixed(3) : '-.---'}</Text>
      <Text color="gray">/</Text>
      <Text color="red" bold={market.bestAskUp > 0}>{market.bestAskUp > 0 ? market.bestAskUp.toFixed(3) : '-.---'}</Text>
      <Text color="cyan">  DN </Text>
      <Text color="green" bold={market.bestBidDown > 0}>{market.bestBidDown > 0 ? market.bestBidDown.toFixed(3) : '-.---'}</Text>
      <Text color="gray">/</Text>
      <Text color="red" bold={market.bestAskDown > 0}>{market.bestAskDown > 0 ? market.bestAskDown.toFixed(3) : '-.---'}</Text>
      <Text color="yellow" bold>  {timeLeft.padStart(5)}</Text>
    </Box>
  );
}

function OrderRow({ order }: { order: Order }) {
  const color = order.status === 'FILLED' ? 'green' : order.status === 'CANCELLED' ? 'red' : 'yellow';
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
    const t = setInterval(() => setTick(n => n + 1), TICK_MS);
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
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">POLYMARKET 5M MONITOR</Text>
        <Text>  </Text>
        <StatusBadge status={status} />
        <Text>  </Text>
        <Text color="magenta">{mode.toUpperCase()}</Text>
        <Text dimColor>  {markets.length} series</Text>
        <Text dimColor>  tick:{tick}</Text>
      </Box>

      {/* Markets */}
      <Box borderStyle="single" borderColor="yellow" flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="yellow">MERCADOS </Text>
          <Newline />
        </Box>
        {markets.length === 0 ? (
          <Text color="red">Buscando séries...</Text>
        ) : (
          markets.map(m => <MarketRow key={m.conditionId} market={m} />)
        )}
      </Box>

      <Box flexDirection="row">
        {/* Active Orders */}
        <Box borderStyle="single" borderColor="blue" flexDirection="column" paddingX={1} flexGrow={1} minHeight={4}>
          <Text bold color="blue">ATIVAS ({activeOrders.length})</Text>
          {activeOrders.slice(-2).map(o => <OrderRow key={o.id} order={o} />)}
        </Box>

        {/* Recent Fills */}
        <Box borderStyle="single" borderColor="green" flexDirection="column" paddingX={1} flexGrow={1} minHeight={4}>
          <Text bold color="green">FILLS</Text>
          {filledOrders.slice(-2).map(o => <OrderRow key={o.id} order={o} />)}
        </Box>
      </Box>

      {/* PnL & History */}
      <Box borderStyle="single" borderColor="magenta" flexDirection="column" paddingX={1} minHeight={5}>
        <Box>
          <Text bold color="magenta">PNL: </Text>
          <Text bold color={pnlColor}>
            {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(4)} USDC
          </Text>
        </Box>
        {history.slice(-3).map((r, i) => (
          <Box key={i}>
            <Text dimColor>{r.question.slice(0, 38).padEnd(40)}</Text>
            <Text color={(r.pnl ?? 0) >= 0 ? 'green' : 'red'}>
              {(r.pnl ?? 0) >= 0 ? '+' : ''}{(r.pnl ?? 0).toFixed(4)}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export function startDashboard(props: DashboardProps) {
  const { unmount } = render(<Dashboard {...props} />);
  return unmount;
}
