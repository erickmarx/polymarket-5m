import { useWebSocket } from './hooks/useWebSocket'
import { Activity, ShieldAlert, Wifi, WifiOff } from 'lucide-react'

function App() {
  const { isConnected, strategies, logs, activeOrders, markets, toggleStrategy, emergencyCancel } = useWebSocket();

  return (
    <div className="min-h-screen p-4 flex flex-col gap-6">
      {/* Header */}
      <header className="flex justify-between items-center bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
        <div className="flex items-center gap-3">
          <Activity className="text-blue-400 w-8 h-8" />
          <h1 className="text-xl font-bold">Polymarket Monitor</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium ${isConnected ? 'bg-green-900/30 text-green-400 border border-green-800' : 'bg-red-900/30 text-red-400 border border-red-800'}`}>
            {isConnected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          
          <button 
            onClick={emergencyCancel}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg font-bold transition-colors shadow-lg"
          >
            <ShieldAlert className="w-5 h-5" />
            EMERGENCY CANCEL
          </button>
        </div>
      </header>

      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
        {/* Left Column: Strategies & Orders */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          {/* Strategies */}
          <section className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-md">
            <h2 className="text-lg font-bold mb-4 flex items-center gap-2 border-b border-gray-700 pb-2">
              Strategies
            </h2>
            <div className="space-y-3">
              {Object.entries(strategies).length === 0 && <p className="text-gray-500 italic">No strategies found...</p>}
              {Object.entries(strategies).map(([id, status]) => (
                <div key={id} className="flex justify-between items-center bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                  <span className="font-mono text-sm truncate max-w-[150px]" title={id}>{id}</span>
                  <button
                    onClick={() => toggleStrategy(id, !status.active)}
                    className={`px-4 py-1 rounded-md text-sm font-bold transition-colors ${status.active ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                  >
                    {status.active ? 'ON' : 'OFF'}
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Active Orders */}
          <section className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-md flex-1">
            <h2 className="text-lg font-bold mb-4 border-b border-gray-700 pb-2">Active Orders</h2>
            <div className="space-y-2 overflow-y-auto max-h-[300px]">
              {activeOrders.length === 0 && <p className="text-gray-500 italic">No active orders</p>}
              {activeOrders.map(order => (
                <div key={order.id} className="bg-gray-900/50 p-3 rounded-lg border-l-4 border-blue-500 text-sm">
                  <div className="flex justify-between font-bold">
                    <span className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{order.side}</span>
                    <span>{order.price}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1 truncate">ID: {order.id.slice(0, 8)}...</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right Column: Markets & Logs */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {/* Markets Feed */}
          <section className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-md">
            <h2 className="text-lg font-bold mb-4 border-b border-gray-700 pb-2">Market Feed</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
              {markets.map(market => (
                <div key={market.conditionId} className="bg-gray-900/50 p-3 rounded-lg border border-gray-700">
                  <div className="text-sm font-bold truncate mb-2" title={market.question}>{market.question}</div>
                  <div className="flex justify-between text-xs">
                    <div className="text-green-400">Bid: {market.bestBidUp}</div>
                    <div className="text-red-400">Ask: {market.bestAskUp}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Logs */}
          <section className="bg-gray-800 rounded-xl p-4 border border-gray-700 shadow-md flex-1 flex flex-col min-h-0">
            <h2 className="text-lg font-bold mb-4 border-b border-gray-700 pb-2">Logs</h2>
            <div className="bg-gray-950 p-3 rounded-lg font-mono text-xs overflow-y-auto flex-1 h-[200px]">
              {logs.map((log, i) => (
                <div key={i} className={`mb-1 ${log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-yellow-400' : 'text-gray-300'}`}>
                  <span className="text-gray-500">[{new Date(log.timestamp).toLocaleTimeString()}]</span> [{log.level}] {log.message}
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default App
