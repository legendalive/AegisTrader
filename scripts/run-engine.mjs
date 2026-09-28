import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const network = process.env.TRADE_NETWORK || "testnet";
const symbol = process.env.TRADE_SYMBOL || "BTCUSDT";
const interval = process.env.TRADE_INTERVAL || "15m";

const apiKey =
  network === "live"
    ? process.env.BINANCE_LIVE_API_KEY
    : process.env.BINANCE_TESTNET_API_KEY;

const apiSecret =
  network === "live"
    ? process.env.BINANCE_LIVE_API_SECRET
    : process.env.BINANCE_TESTNET_API_SECRET;

if (!apiKey || !apiSecret) {
  console.log("No API keys configured. Exiting.");
  process.exit(0);
}

const { getMarketSnapshot } = await import("../modules/market.js");
const { evaluateEntrySignal } = await import("../modules/strategy.js");
const { evaluateAiConfidence } = await import("../modules/ai.js");
const { evaluateRisk } = await import("../modules/risk.js");
const executor = await import("../modules/executor.js");

const statePath = "state/engine-state.json";
const today = new Date().toISOString().slice(0, 10);

let state = {
  date: today,
  lastCandleOpenTime: 0,
  tradesCount: 0,
  dailyLossUsedPct: 0,
  cooldownUntilCandle: 0
};

try {
  if (fs.existsSync(statePath)) {
    const existing = JSON.parse(fs.readFileSync(statePath, "utf8"));
    state = {
      ...state,
      ...existing
    };
  }
} catch (err) {
  console.error("Failed to read state file.", err);
}

if (state.date !== today) {
  state.date = today;
  state.tradesCount = 0;
  state.dailyLossUsedPct = 0;
}

const snapshot = await getMarketSnapshot(network, symbol, interval, 100);
const closedOpenTime = snapshot.closedCandle.openTime;

if (state.lastCandleOpenTime === closedOpenTime) {
  console.log("No new closed candle. Exiting.");
  process.exit(0);
}

const accountState = await executor.fetchAccountState(
  network,
  symbol,
  apiKey,
  apiSecret
);

const signal = evaluateEntrySignal(snapshot);

const aiResult = evaluateAiConfidence(signal, snapshot, []);
signal.aiConfidence = aiResult.confidence;

const riskAccountState = {
  openPositions: accountState.openPositions,
  tradesToday: state.tradesCount,
  dailyLossUsedPct: state.dailyLossUsedPct,
  inCooldown: state.cooldownUntilCandle > closedOpenTime,
  killSwitchActive: false
};

const riskResult = evaluateRisk(signal, snapshot, riskAccountState);

let decision = signal.decision;
let reason = signal.reason;

if (decision === "SIGNAL") {
  if (aiResult.decision === "VETO") {
    decision = "VETOED_BY_AI";
    reason = aiResult.reason;
  } else if (!riskResult.passed) {
    decision = "VETOED_BY_RISK";
    reason = riskResult.reason;
  } else {
    decision = "APPROVED";
    reason = "Approved by strategy, AI, and risk.";
  }
}

console.log(
  JSON.stringify(
    {
      network,
      symbol,
      interval,
      closedCandleOpenTime: closedOpenTime,
      decision,
      reason,
      aiConfidence: aiResult.confidence,
      hasPosition: accountState.hasPosition,
      openPositions: accountState.openPositions,
      quoteBalance: accountState.quoteBalance
    },
    null,
    2
  )
);

if (decision === "APPROVED" && !accountState.hasPosition) {
  const result = await executor.executeEntry(
    network,
    symbol,
    apiKey,
    apiSecret,
    snapshot,
    signal,
    accountState
  );

  state.tradesCount += 1;

  console.log(
    JSON.stringify(
      {
        executed: true,
        entryPrice: result.entryPrice,
        quantity: result.quantity,
        stopPrice: result.stopPrice,
        takeProfitPrice: result.takeProfitPrice
      },
      null,
      2
    )
  );
}

state.lastCandleOpenTime = closedOpenTime;

fs.mkdirSync(path.dirname(statePath), { recursive: true });
fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

console.log("Engine state updated.");
