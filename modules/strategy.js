import { appConfig } from "../config/app.config.js";
import { calculateIndicatorSnapshot } from "./indicators.js";

export function evaluateMarketConditions(snapshot) {
  const indicators = calculateIndicatorSnapshot(snapshot.candles);

  const conditions = {
    closedCandle: Boolean(snapshot.closedCandle),

    closeAboveEma50:
      indicators.close > indicators.ema50,

    ema20AboveEma50:
      indicators.ema20 > indicators.ema50,

    closeAboveEma20:
      indicators.close > indicators.ema20,

    rsiInRange:
      indicators.rsi14 >= 50 && indicators.rsi14 <= 70,

    volumeConfirmation:
      indicators.volumeRatio >= 1.2,

    spreadAcceptable:
      snapshot.spreadPct <= appConfig.risk.maxSpreadPct,

    volatilityAcceptable:
      indicators.atrPct >= 0.15 && indicators.atrPct <= 2.0
  };

  const failedConditions = Object.entries(conditions)
    .filter(([_, passed]) => !passed)
    .map(([name]) => name);

  return {
    indicators,
    conditions,
    passed: failedConditions.length === 0,
    failedConditions
  };
}

export function evaluateEntrySignal(snapshot) {
  const result = evaluateMarketConditions(snapshot);

  return {
    timestamp: new Date().toISOString(),
    network: snapshot.network,
    symbol: snapshot.symbol,
    interval: snapshot.interval,
    side: "LONG",
    candleOpenTime: result.indicators.candleOpenTime,
    candleCloseTime: result.indicators.candleCloseTime,
    price: result.indicators.close,
    aiConfidence: null,
    decision: result.passed ? "SIGNAL" : "NO_SIGNAL",
    reason: result.passed
      ? "All market conditions passed."
      : `Failed: ${result.failedConditions.join(", ")}`,
    conditions: result.conditions,
    indicators: result.indicators
  };
}
