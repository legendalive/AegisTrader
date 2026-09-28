import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

const network = process.env.TRADE_NETWORK || "testnet";
const symbol = process.env.TRADE_SYMBOL || "BTCUSDT";
const interval = process.env.TRADE_INTERVAL || "15m";

const apiKey = network === "live" ? process.env.BINANCE_LIVE_API_KEY : process.env.BINANCE_TESTNET_API_KEY;
const apiSecret = network === "live" ? process.env.BINANCE_LIVE_API_SECRET : process.env.BINANCE_TESTNET_API_SECRET;

const statePath = "state/engine-state.json";
const killSwitchPath = "state/kill-switch.json";
const journalPath = "state/trade-journal.json";

function readKillSwitch() {
  try {
    if (fs.existsSync(killSwitchPath)) return JSON.parse(fs.readFileSync(killSwitchPath, "utf8"));
  } catch (err) { console.error("Failed to read kill switch file.", err); }
  return { enabled: false, reason: "" };
}

function writeState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function writeJournal(journal) {
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
}

if (!apiKey || !apiSecret) {
  console.log("No API keys configured. Exiting.");
  process.exit(0);
}

const { getMarketSnapshot } = await import("../modules/market.js");
const { evaluateEntrySignal } = await import("../modules/strategy.js");
const { evaluateAiConfidence } = await import("../modules/ai.js");
const { evaluateRisk } = await import("../modules/risk.js");
const executor = await import("../modules/executor.js");
const api = await import("../modules/api.js");

const today = new Date().toISOString().slice(0, 10);

let state = {
  date: today, lastCandleOpenTime: 0, tradesCount: 0, dailyLossUsedPct: 0, cooldownUntilCandle: 0,
  lastRunAt: null, lastRunStatus: "NOT_RUN", lastDecision: null, lastReason: null,
  lastNetwork: network, lastSymbol: symbol, lastInterval: interval, lastTrade: null
};

try {
  if (fs.existsSync(statePath)) state = { ...state, ...JSON.parse(fs.readFileSync(statePath, "utf8")) };
} catch (err) { console.error("Failed to read state file.", err); }

if (state.date !== today) {
  state.date = today; state.tradesCount = 0; state.dailyLossUsedPct = 0;
}

const killSwitch = readKillSwitch();
const snapshot = await getMarketSnapshot(network, symbol, interval, 100);
const closedOpenTime = snapshot.closedCandle.openTime;

if (state.lastCandleOpenTime === closedOpenTime) {
  console.log("No new closed candle. Exiting.");
  process.exit(0);
}

state.lastRunAt = new Date().toISOString();
state.lastNetwork = network; state.lastSymbol = symbol; state.lastInterval = interval;

if (killSwitch.enabled === true) {
  state.lastRunStatus = "KILL_SWITCH"; state.lastDecision = "KILL_SWITCH";
  state.lastReason = killSwitch.reason || "Kill switch enabled."; state.lastCandleOpenTime = closedOpenTime;
  writeState(state); console.log("Kill switch enabled. No trades will be placed."); process.exit(0);
}

const accountState = await executor.fetchAccountState(network, symbol, apiKey, apiSecret);
const signal = evaluateEntrySignal(snapshot);
const aiResult = evaluateAiConfidence(signal, snapshot, []);
signal.aiConfidence = aiResult.confidence;

const riskAccountState = {
  openPositions: accountState.openPositions, tradesToday: state.tradesCount,
  dailyLossUsedPct: state.dailyLossUsedPct, inCooldown: state.cooldownUntilCandle > closedOpenTime, killSwitchActive: false
};

const riskResult = evaluateRisk(signal, snapshot, riskAccountState);
let decision = signal.decision; let reason = signal.reason;

if (decision === "SIGNAL") {
  if (aiResult.decision === "VETO") { decision = "VETOED_BY_AI"; reason = aiResult.reason; } 
  else if (!riskResult.passed) { decision = "VETOED_BY_RISK"; reason = riskResult.reason; } 
  else { decision = "APPROVED"; reason = "Approved by strategy, AI, and risk."; }
}

state.lastDecision = decision; state.lastReason = reason;

if (decision === "APPROVED" && !accountState.hasPosition) {
  const result = await executor.executeEntry(network, symbol, apiKey, apiSecret, snapshot, signal, accountState);
  state.tradesCount += 1; state.lastRunStatus = "TRADED";
  state.lastTrade = { time: state.lastRunAt, symbol, side: "LONG", entryPrice: result.entryPrice, quantity: result.quantity, stopPrice: result.stopPrice, takeProfitPrice: result.takeProfitPrice };
  console.log(`Trade executed. Qty: ${result.quantity}`);
} else if (decision === "APPROVED" && accountState.hasPosition) {
  state.lastRunStatus = "POSITION_ALREADY_OPEN";
} else {
  state.lastRunStatus = "NO_TRADE";
}

state.lastCandleOpenTime = closedOpenTime;
writeState(state);

// --- Trade Journal Reconciliation ---
try {
  const rawTrades = await api.getMyTrades(network, symbol, apiKey, apiSecret);
  const orderMap = new Map();
  
  for (const t of rawTrades) {
    if (!orderMap.has(t.orderId)) {
      orderMap.set(t.orderId, { orderId: t.orderId, side: t.isBuyer ? "BUY" : "SELL", time: t.time, priceSum: 0, qtySum: 0, fee: 0 });
    }
    const o = orderMap.get(t.orderId);
    o.priceSum += parseFloat(t.price) * parseFloat(t.qty);
    o.qtySum += parseFloat(t.qty);
    o.fee += parseFloat(t.commission);
  }

  const fills = Array.from(orderMap.values()).map(o => ({ ...o, price: o.priceSum / o.qtySum })).sort((a, b) => a.time - b.time);
  
  const journal = { active: null, completed: [] };

  for (let i = 0; i < fills.length; i++) {
    if (fills[i].side === "BUY") {
      if (i + 1 < fills.length && fills[i+1].side === "SELL") {
        const buy = fills[i]; const sell = fills[i+1];
        const pnl = (sell.price - buy.price) * buy.qtySum;
        journal.completed.push({
          entryTime: new Date(buy.time).toISOString(),
          exitTime: new Date(sell.time).toISOString(),
          entryPrice: buy.price, exitPrice: sell.price,
          quantity: buy.qtySum, pnl: pnl,
          exitReason: sell.price >= (state.lastTrade?.takeProfitPrice || Infinity) ? "TAKE_PROFIT" : "STOP_LOSS"
        });
        i++; 
      } else {
        journal.active = {
          entryTime: new Date(fills[i].time).toISOString(),
          entryPrice: fills[i].price, quantity: fills[i].qtySum,
          stopLoss: state.lastTrade?.stopPrice || 0,
          takeProfit: state.lastTrade?.takeProfitPrice || 0
        };
      }
    }
  }
  
  // Keep only last 50 completed trades
  journal.completed = journal.completed.slice(-50);
  writeJournal(journal);
  console.log("Trade journal updated.");
} catch (err) {
  console.error("Failed to update trade journal:", err.message);
}

console.log("Engine cycle complete.");
