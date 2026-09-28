export const appConfig = Object.freeze({
  app: Object.freeze({
    name: "AegisTrader",
    version: "0.2.1"
  }),

  github: Object.freeze({
    rawBase: "https://raw.githubusercontent.com/legendalive/AegisTrader/main"
  }),

  proxy: Object.freeze({
    enabled: true,
    url: "https://binance-proxy.mbenson-mb62.workers.dev" // <-- PASTE YOUR WORKER URL HERE
  }),

  network: Object.freeze({
    default: "testnet",
    endpoints: Object.freeze({
      testnet: "https://testnet.binance.vision",
      live: "https://api.binance.com"
    })
  }),

  trading: Object.freeze({
    symbol: "BTCUSDT",
    interval: "15m",
    side: "LONG_ONLY",
    pollIntervalMs: 60000
  }),

  ai: Object.freeze({
    confidenceThreshold: 0.85
  }),

  risk: Object.freeze({
    riskPerTradePct: 0.5,
    maxDailyLossPct: 2.0,
    maxOpenPositions: 1,
    maxTradesPerDay: 3,
    maxSpreadPct: 0.10,
    stopLossAtrMultiplier: 1.5,
    takeProfitAtrMultiplier: 2.25,
    maxHoldingCandles: 48,
    cooldownCandlesAfterLoss: 2,
    maxApiErrorsBeforeKill: 3,
    maxTimestampDriftMs: 3000,
    maxStaleDataCandles: 2
  }),

  execution: Object.freeze({
    entryOrderType: "MARKET",
    protectiveOrderType: "OCO",
    orderTestBeforeLive: true
  }),

  vault: Object.freeze({
    autoLockMinutes: 5
  }),

  live: Object.freeze({
    requireTypedConfirmation: true,
    requireManualArm: true
  })
});
