# Spec: Web Dashboard for Polymarket Monitor

**Date**: 2026-04-16
**Status**: Draft
**Topic**: Transitioning from Terminal UI to a Web-based Dashboard with Strategy Management.

## 1. Overview
The goal is to replace the current terminal-based UI with a headless backend and a modern web dashboard. This will allow real-time monitoring of markets, orders, and logs, while providing the ability to toggle trading strategies on/off without restarting the process.

## 2. Architecture
The system follows a decoupled Client-Server architecture:
- **Backend (Headless)**: A Bun-based service that runs the discovery, monitoring, and execution logic. It hosts a WebSocket/HTTP server.
- **Frontend (Web Dashboard)**: A React application built with Vite, located in `src/web`.
- **Persistence Layer**: A local JSON file (`config/strategies.json`) to persist the active/inactive state of strategies.

## 3. Communication Protocol (WebSockets)
Bi-directional communication over WebSockets (`ws://localhost:8080`):
- **Server Binding**: The server will bind only to `127.0.0.1` by default for security.
- **Multiple Clients**: The server will support multiple concurrent connections using a broadcast pattern.

### Monitor -> Dashboard (Outbound)
- `SYNC_STATE`: Sent on connection. Contains full current state (active strategies, recent orders, current market states).
- `MARKET_UPDATE`: Real-time price and history updates for subscribed markets.
- `STRATEGY_UPDATE`: Change in a strategy's status (active/inactive) or configuration.
- `ORDER_EVENT`: Notification when an order is created, filled, or cancelled.
- `LOG_EVENT`: Streaming logs from the backend.
- `ERROR_EVENT`: `{ type: "ERROR_EVENT", message: string, code?: string }` - For reporting failures in processing commands.

### Dashboard -> Monitor (Inbound)
- `TOGGLE_STRATEGY`: `{ type: "TOGGLE_STRATEGY", id: string, active: boolean }`
- `EMERGENCY_CANCEL`: `{ type: "EMERGENCY_CANCEL" }` - Cancels all active orders and disables all strategies.

## 4. Components

### Backend Changes
- **`src/modules/api.ts`**:
    - Uses `Bun.serve` to handle HTTP and WebSocket.
    - Serves static files from `src/web/dist` in production mode.
    - Implements a simple event emitter or callback system to capture logs from `logger.ts`.
- **`src/modules/execution.ts`**:
    - Add `StrategyStatusManager` to check if a strategy is active before processing `evaluate`.
    - Persist changes to `config/strategies.json`.
    - Reconcile memory state with file state on startup.
- **`src/logger.ts`**:
    - Update to allow "subscriptions" or an event emitter so `api.ts` can broadcast logs.
- **`src/index.ts`**: Remove terminal UI (`startDashboard`) and initialize the API server instead.

### Frontend (web)
- **Framework**: React + Vite + Tailwind CSS.
- **State Management**: Simple React Context or a lightweight store like Zustand.
- **Connection Management**:
    - Visual indicators for connection status (Connected/Reconnecting/Disconnected).
    - Auto-reconnect logic with exponential backoff.
- **UI Sections**:
    - **Header**: Connection status, Mode (DryRun/Live), Total PnL.
    - **Strategy List**: Cards/Rows with toggle switches for each strategy.
    - **Active Orders**: Real-time table of pending and live orders.
    - **Market Feed**: Current prices for monitored condition IDs.
    - **Log Console**: A scrolling view of system logs.

## 5. Persistence Schema (`config/strategies.json`)
```json
{
  "strategy-id-1": { "active": true },
  "strategy-id-2": { "active": false }
}
```

## 6. Implementation Stages (Split into two separate phases)

### Phase A: Backend Headless & API
1. Implement persistence manager for strategy status (`config/strategies.json`).
2. Update `ExecutionModule` to respect active status.
3. Update `logger.ts` to support log broadcasting.
4. Implement `src/modules/api.ts` (Bun WebSocket/HTTP server).
5. Remove `src/ui/cli.tsx` and CLI-specific dependencies from `index.ts`.

### Phase B: Frontend Dashboard
1. Scaffold Vite + React in `src/web`.
2. Implement WebSocket client with reconnection logic.
3. Build the UI components (Strategy List, Orders, Logs, Market Feed).
4. Final integration and production build (Bun serving static files).
