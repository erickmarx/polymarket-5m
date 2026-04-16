import { useState, useEffect, useCallback, useRef } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface LogEntry {
  type: 'LOG_EVENT'
  level: 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
  message: string
  timestamp: number
}

export interface StrategyStatus {
  active: boolean
}

export interface MarketData {
  conditionId: string
  seriesId: string
  question: string
  bestBidUp: number
  bestAskUp: number
  bestBidDown: number
  bestAskDown: number
  upTokenId: string
  downTokenId: string
  updatedAt: number
  marketEndDate: number
}

export interface Order {
  id: string
  side: 'BUY' | 'SELL'
  size: number
  price: number
  tokenId: string
  status: 'PENDING' | 'LIVE' | 'FILLED' | 'CANCELLED'
  strategyId: string
  createdAt: number
  filledAt?: number
}

export interface DashboardState {
  status: ConnectionStatus
  strategies: Record<string, StrategyStatus>
  logs: LogEntry[]
  activeOrders: Order[]
  filledOrders: Order[]
  markets: MarketData[]
  mode: string
  toggleStrategy: (id: string, active: boolean) => void
  emergencyCancel: () => void
}

export function useWebSocket(): DashboardState {
  const [connStatus, setConnStatus] = useState<ConnectionStatus>('connecting')
  const [strategies, setStrategies] = useState<Record<string, StrategyStatus>>({})
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [activeOrders, setActiveOrders] = useState<Order[]>([])
  const [filledOrders, setFilledOrders] = useState<Order[]>([])
  const [markets, setMarkets] = useState<MarketData[]>([])
  const [mode, setMode] = useState('unknown')

  const ws = useRef<WebSocket | null>(null)
  const reconnectDelay = useRef(1000)

  const connect = useCallback(() => {
    const socket = new WebSocket('ws://localhost:8090')
    ws.current = socket

    socket.onopen = () => {
      setConnStatus('connected')
      reconnectDelay.current = 1000
    }

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data as string)
      switch (msg.type) {
        case 'SYNC_STATE':
          setStrategies(msg.data.strategies ?? {})
          setActiveOrders(msg.data.activeOrders ?? [])
          setFilledOrders(msg.data.filledOrders ?? [])
          setMarkets(msg.data.markets ?? [])
          if (msg.data.mode) setMode(msg.data.mode)
          break
        case 'STRATEGY_UPDATE':
          setStrategies(prev => ({ ...prev, [msg.id]: { active: msg.active } }))
          break
        case 'LOG_EVENT':
          setLogs(prev => [msg as LogEntry, ...prev].slice(0, 300))
          break
        case 'MARKET_UPDATE':
          setMarkets(prev => {
            const idx = prev.findIndex(
              m => m.conditionId === msg.data.conditionId || m.seriesId === msg.data.seriesId
            )
            if (idx === -1) return [msg.data, ...prev]
            const next = [...prev]
            next[idx] = msg.data
            return next
          })
          break
        case 'ORDER_EVENT': {
          const order = msg.data as Order
          if (order.status === 'FILLED') {
            setActiveOrders(prev => prev.filter(o => o.id !== order.id))
            setFilledOrders(prev => [order, ...prev])
          } else if (order.status === 'CANCELLED') {
            setActiveOrders(prev => prev.filter(o => o.id !== order.id))
          } else {
            setActiveOrders(prev => {
              const idx = prev.findIndex(o => o.id === order.id)
              if (idx === -1) return [order, ...prev]
              const next = [...prev]
              next[idx] = order
              return next
            })
          }
          break
        }
      }
    }

    socket.onclose = () => {
      // Guard: if ws.current moved to a newer socket, this stale onclose is
      // from a socket that was intentionally replaced — don't update state.
      if (ws.current !== socket) return
      setConnStatus('connecting')
      const delay = reconnectDelay.current
      reconnectDelay.current = Math.min(delay * 2, 30_000)
      setTimeout(connect, delay)
    }
  }, [])

  useEffect(() => {
    connect()
    return () => {
      // Nullify ws.current BEFORE closing so the onclose guard fires correctly.
      const socket = ws.current
      ws.current = null
      socket?.close()
    }
  }, [connect])

  const toggleStrategy = useCallback((id: string, active: boolean) => {
    ws.current?.send(JSON.stringify({ type: 'TOGGLE_STRATEGY', id, active }))
  }, [])

  const emergencyCancel = useCallback(() => {
    ws.current?.send(JSON.stringify({ type: 'EMERGENCY_CANCEL' }))
  }, [])

  return {
    status: connStatus,
    strategies,
    logs,
    activeOrders,
    filledOrders,
    markets,
    mode,
    toggleStrategy,
    emergencyCancel,
  }
}
