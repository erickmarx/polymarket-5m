import { useRef, useEffect } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import {
  Activity, ShieldAlert, Settings2, Target, Terminal,
  ArrowUpRight, ArrowDownRight, TrendingUp,
} from 'lucide-react'
import { useWebSocket, type LogEntry, type Order, type MarketData, type StrategyStatus } from './hooks/useWebSocket'

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  return `${Math.floor(s / 3600)}h`
}

function timeUntilClose(endDate: number): { label: string; urgent: boolean } {
  const ms = endDate - Date.now()
  if (ms <= 0) return { label: 'Closed', urgent: true }
  const s = Math.floor(ms / 1000)
  if (s < 60) return { label: `${s}s`, urgent: true }
  const m = Math.floor(s / 60)
  if (m < 60) return { label: `${m}m ${s % 60}s`, urgent: m < 5 }
  const h = Math.floor(m / 60)
  if (h < 24) return { label: `${h}h ${m % 60}m`, urgent: false }
  return { label: `${Math.floor(h / 24)}d ${h % 24}h`, urgent: false }
}

function formatPct(p: number): string {
  if (!p || isNaN(p)) return '—'
  return (p * 100).toFixed(1) + '%'
}

export default function App() {
  const { status, strategies, logs, activeOrders, filledOrders, markets, mode, toggleStrategy, emergencyCancel } = useWebSocket()
  const logRef = useRef<HTMLDivElement>(null)
  const isConnected = status === 'connected'

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs])

  return (
    <div className="min-h-screen bg-void flex flex-col">

      {/* ── Navbar ── */}
      <nav
        className="h-14 shrink-0 sticky top-0 z-50 flex items-center justify-between px-6"
        style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{ background: '#0099ff' }}
          >
            <Activity className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="font-display text-[14px] font-bold tracking-tight text-white">
            Polymarket Monitor
          </span>
          {mode !== 'unknown' && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
              style={
                mode === 'dryrun'
                  ? { color: '#fbbf24', borderColor: 'rgba(251,191,36,0.2)', background: 'rgba(251,191,36,0.06)' }
                  : { color: '#f87171', borderColor: 'rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.06)' }
              }
            >
              {mode.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              {isConnected && (
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ background: '#0099ff' }}
                />
              )}
              <span
                className="relative inline-flex rounded-full h-2 w-2"
                style={{
                  background: isConnected ? '#0099ff' : status === 'connecting' ? '#f59e0b' : '#ef4444',
                }}
              />
            </span>
            <span
              className="text-[12px] font-medium"
              style={{
                color: isConnected ? '#0099ff' : status === 'connecting' ? '#f59e0b' : '#ef4444',
              }}
            >
              {isConnected ? 'Connected' : status === 'connecting' ? 'Reconnecting…' : 'Disconnected'}
            </span>
          </div>

          <button
            onClick={emergencyCancel}
            className="flex items-center gap-1.5 bg-white text-black text-[12px] font-bold px-4 py-[7px] rounded-full transition-transform active:scale-95 hover:bg-gray-100"
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            Panic
          </button>
        </div>
      </nav>

      {/* ── Main grid ── */}
      <main className="flex-1 p-6 grid grid-cols-12 gap-5 max-w-[1440px] mx-auto w-full">

        {/* Left: 4 cols */}
        <div className="col-span-12 lg:col-span-4 flex flex-col gap-5">

          {/* Strategies panel */}
          <Panel icon={<Settings2 />} title="Strategies">
            {Object.keys(strategies).length === 0 ? (
              <Empty>No strategies registered</Empty>
            ) : (
              <div className="space-y-3">
                {Object.entries(strategies).map(([id, s]) => (
                  <StrategyRow key={id} id={id} status={s} onToggle={(v) => toggleStrategy(id, v)} />
                ))}
              </div>
            )}
          </Panel>

          {/* Active orders panel */}
          <Panel icon={<Target />} title="Active Orders" badge={activeOrders.length || undefined} flex>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
              {activeOrders.length === 0 ? (
                <Empty>Awaiting signals…</Empty>
              ) : (
                activeOrders.map(o => <OrderRow key={o.id} order={o} />)
              )}
            </div>
          </Panel>

          {/* Filled orders panel */}
          <Panel icon={<TrendingUp />} title="Filled Today" badge={filledOrders.length || undefined} flex>
            <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
              {filledOrders.length === 0 ? (
                <Empty>No fills yet…</Empty>
              ) : (
                filledOrders.slice(0, 5).map(o => <OrderRow key={o.id} order={o} />)
              )}
            </div>
          </Panel>
        </div>

        {/* Right: 8 cols */}
        <div className="col-span-12 lg:col-span-8 flex flex-col gap-5">

          {/* Markets */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-[17px] font-bold tracking-tight">Active Markets</h2>
              <span className="text-[12px] text-muted">{markets.length} tracked</span>
            </div>
            {markets.length === 0 ? (
              <div
                className="rounded-xl p-10 text-center text-[13px] text-muted"
                style={{ background: '#090909', boxShadow: '0 0 0 1px rgba(0,153,255,0.12)' }}
              >
                Waiting for market data…
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {markets.map(m => <MarketCard key={m.conditionId} market={m} />)}
              </div>
            )}
          </div>

          {/* Log console */}
          <Panel icon={<Terminal />} title="System Log" flex>
            <div
              ref={logRef}
              className="flex-1 overflow-y-auto font-mono text-[11.5px] leading-[1.75] min-h-[320px] max-h-[440px] space-y-0"
            >
              {logs.length === 0 ? (
                <span className="text-ghost italic">Logs will appear here…</span>
              ) : (
                logs.slice().reverse().map((log, i) => <LogLine key={i} log={log} />)
              )}
            </div>
          </Panel>
        </div>
      </main>
    </div>
  )
}

// ── Panel wrapper ──────────────────────────────────────────────────────────────

function Panel({
  icon, title, badge, flex, children,
}: {
  icon: React.ReactNode
  title: string
  badge?: number
  flex?: boolean
  children: React.ReactNode
}) {
  return (
    <section
      className={cn('rounded-xl overflow-hidden', flex && 'flex flex-col')}
      style={{ background: '#090909', boxShadow: '0 0 0 1px rgba(0,153,255,0.12)' }}
    >
      <div
        className="px-4 py-3 flex items-center gap-2 shrink-0"
        style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
      >
        <span className="text-muted [&>svg]:w-3.5 [&>svg]:h-3.5">{icon}</span>
        <span className="text-[11px] font-semibold text-muted uppercase tracking-[0.1em]">{title}</span>
        {badge !== undefined && (
          <span
            className="ml-auto text-[11px] font-mono px-1.5 py-0.5 rounded-full"
            style={{ color: '#0099ff', background: 'rgba(0,153,255,0.1)' }}
          >
            {badge}
          </span>
        )}
      </div>
      <div className={cn('p-4', flex && 'flex flex-col flex-1')}>
        {children}
      </div>
    </section>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-6 text-center text-[13px] text-ghost">{children}</div>
  )
}

// ── Strategy row ───────────────────────────────────────────────────────────────

function StrategyRow({ id, status, onToggle }: { id: string; status: StrategyStatus; onToggle: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] font-medium text-white truncate">{id}</span>
      <button
        onClick={() => onToggle(!status.active)}
        className="relative shrink-0 inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none"
        style={{ background: status.active ? '#0099ff' : 'rgba(255,255,255,0.1)' }}
      >
        <span
          className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200"
          style={{ transform: status.active ? 'translateX(18px)' : 'translateX(3px)' }}
        />
      </button>
    </div>
  )
}

// ── Order row ──────────────────────────────────────────────────────────────────

function OrderRow({ order }: { order: Order }) {
  const isBuy = order.side === 'BUY'
  return (
    <div
      className="flex items-center justify-between px-3 py-2.5 rounded-lg"
      style={{ background: '#000', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center gap-2.5">
        <span
          className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded"
          style={
            isBuy
              ? { color: '#0099ff', background: 'rgba(0,153,255,0.12)' }
              : { color: '#f87171', background: 'rgba(248,113,113,0.12)' }
          }
        >
          {order.side}
        </span>
        <span className="text-[13px] font-medium text-white">
          {order.size} × {formatPct(order.price)}
        </span>
      </div>
      <span className="text-[10px] text-ghost font-mono">{order.id.slice(0, 8)}</span>
    </div>
  )
}

// ── Market card ────────────────────────────────────────────────────────────────

function MarketCard({ market }: { market: MarketData }) {
  return (
    <div
      className="rounded-xl p-4 transition-all cursor-default"
      style={{
        background: '#090909',
        boxShadow: '0 0 0 1px rgba(0,153,255,0.12)',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 0 0 1px rgba(0,153,255,0.4)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = '0 0 0 1px rgba(0,153,255,0.12)')}
    >
      <p className="text-[13px] font-medium text-white line-clamp-2 leading-snug mb-4" title={market.question}>
        {market.question}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <SideTile label="YES" bid={market.bestBidUp} ask={market.bestAskUp} up />
        <SideTile label="NO" bid={market.bestBidDown} ask={market.bestAskDown} up={false} />
      </div>
      <div className="mt-2.5 flex flex-col gap-0.5">
        <span className="text-[10px] text-ghost">
          {market.updatedAt ? `Updated ${timeAgo(market.updatedAt)} ago` : 'Waiting…'}
        </span>
        {market.marketEndDate > 0 && (() => {
          const { label, urgent } = timeUntilClose(market.marketEndDate)
          return (
            <span
              className="text-[10px] font-mono font-medium"
              style={{ color: urgent ? '#f59e0b' : '#a6a6a6' }}
            >
              Closes in {label}
            </span>
          )
        })()}
      </div>
    </div>
  )
}

function SideTile({ label, bid, ask, up }: { label: string; bid: number; ask: number; up: boolean }) {
  return (
    <div
      className="rounded-lg p-2.5"
      style={{ background: '#000', border: '1px solid rgba(255,255,255,0.05)' }}
    >
      <div className="flex items-center gap-1 mb-1.5">
        {up
          ? <ArrowUpRight className="w-3 h-3 shrink-0" style={{ color: '#0099ff' }} />
          : <ArrowDownRight className="w-3 h-3 shrink-0 text-muted" />
        }
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: up ? '#0099ff' : '#a6a6a6' }}>
          {label}
        </span>
      </div>
      <div className="text-[13px] font-bold text-white font-mono">
        {formatPct(bid)}<span className="text-ghost font-normal">/</span>{formatPct(ask)}
      </div>
    </div>
  )
}

// ── Log line ───────────────────────────────────────────────────────────────────

const LOG_COLORS: Record<string, string> = {
  INFO: '#a6a6a6',
  WARN: '#f59e0b',
  ERROR: '#ef4444',
  DEBUG: 'rgba(255,255,255,0.3)',
}

function LogLine({ log }: { log: LogEntry }) {
  const color = LOG_COLORS[log.level] ?? '#a6a6a6'
  const time = new Date(log.timestamp).toLocaleTimeString([], {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="flex gap-3 py-px" style={{ color }}>
      <span className="shrink-0 select-none" style={{ color: 'rgba(255,255,255,0.25)', width: '7ch' }}>{time}</span>
      <span className="shrink-0 font-bold" style={{ width: '6ch' }}>[{log.level}]</span>
      <span className="break-all">{log.message}</span>
    </div>
  )
}
