import { useState, useEffect, useCallback, useRef } from 'react';

export interface LogEntry {
  level: string;
  message: string;
  timestamp: number;
}

export interface StrategyStatus {
  active: boolean;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [strategies, setStrategies] = useState<Record<string, StrategyStatus>>({});
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [markets, setMarkets] = useState<any[]>([]);
  const ws = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    // No ambiente local, usamos a porta 8080 do backend
    const socket = new WebSocket('ws://localhost:8080');
    ws.current = socket;

    socket.onopen = () => {
      setIsConnected(true);
      console.log('Connected to Monitor');
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'SYNC_STATE':
          setStrategies(msg.data.strategies);
          setActiveOrders(msg.data.activeOrders);
          setMarkets(msg.data.markets);
          break;
        case 'STRATEGY_UPDATE':
          setStrategies(prev => ({ ...prev, [msg.id]: { active: msg.active } }));
          break;
        case 'LOG_EVENT':
          setLogs(prev => [msg, ...prev].slice(0, 100));
          break;
        case 'MARKET_UPDATE':
          setMarkets(prev => {
            const index = prev.findIndex(m => m.conditionId === msg.data.conditionId);
            if (index === -1) return [msg.data, ...prev];
            const next = [...prev];
            next[index] = msg.data;
            return next;
          });
          break;
        case 'ORDER_EVENT':
          setActiveOrders(prev => {
            const index = prev.findIndex(o => o.id === msg.data.id);
            if (msg.data.status === 'FILLED' || msg.data.status === 'CANCELLED') {
               return prev.filter(o => o.id !== msg.data.id);
            }
            if (index === -1) return [msg.data, ...prev];
            const next = [...prev];
            next[index] = msg.data;
            return next;
          });
          break;
      }
    };

    socket.onclose = () => {
      setIsConnected(false);
      setTimeout(connect, 3000);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => ws.current?.close();
  }, [connect]);

  const toggleStrategy = (id: string, active: boolean) => {
    ws.current?.send(JSON.stringify({ type: 'TOGGLE_STRATEGY', id, active }));
  };

  const emergencyCancel = () => {
    ws.current?.send(JSON.stringify({ type: 'EMERGENCY_CANCEL' }));
  };

  return { isConnected, strategies, logs, activeOrders, markets, toggleStrategy, emergencyCancel };
}
