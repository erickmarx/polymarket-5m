// Bun carrega .env automaticamente — nenhum import necessário

export const CONFIG = {
  debug: process.env.DEBUG === 'true',
  api: {
    gammaBaseUrl: process.env.GAMMA_BASE_URL || 'https://gamma-api.polymarket.com',
    clobBaseUrl: process.env.CLOB_BASE_URL || 'https://clob.polymarket.com',
    wsUrl: process.env.WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
  },
  trading: {
    mode: (process.env.TRADING_MODE || 'dryrun') as 'live' | 'dryrun',
    privateKey: process.env.PRIVATE_KEY || '',
    apiKey: process.env.CLOB_API_KEY || '',
    apiSecret: process.env.CLOB_API_SECRET || '',
    apiPassphrase: process.env.CLOB_API_PASSPHRASE || '',
    proxyWallet: process.env.PROXY_WALLET || '',
  },
  monitoring: {
    heartbeatIntervalMs: 30_000,
    // Até 8 seriesIds de cripto para monitorar em paralelo (imutáveis entre mercados)
    seriesIds: (process.env.SERIES_IDS ?? '10684,10685,10686')
      .split(',')
      .map(s => parseInt(s.trim(), 10))
      .filter(n => !isNaN(n))
      .slice(0, 8),
  },
};
