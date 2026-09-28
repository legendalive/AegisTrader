import { appConfig } from "../config/app.config.js";

export function evaluateAiConfidence(signal, marketSnapshot, recentTrades = []) {
  let score = 0.40; // Base score
  const factors = [];
  const ind = signal.indicators;

  // 1. Trend strength
  const trendPass = ind.close > ind.ema20 && ind.ema20 > ind.ema50;
  if (trendPass) {
    score += 0.15;
    factors.push({ name: "Trend Strength", score: 0.15, status: "PASS", reason: "close > EMA20 > EMA50" });
  } else {
    factors.push({ name: "Trend Strength", score: 0, status: "FAIL", reason: "Trend not fully aligned" });
  }

  // 2. Momentum quality
  const momentumPass = ind.rsi14 >= 55 && ind.rsi14 <= 68;
  if (momentumPass) {
    score += 0.10;
    factors.push({ name: "Momentum Quality", score: 0.10, status: "PASS", reason: `RSI ${ind.rsi14.toFixed(1)} in optimal zone` });
  } else {
    factors.push({ name: "Momentum Quality", score: 0, status: "FAIL", reason: `RSI ${ind.rsi14.toFixed(1)} outside 55-68` });
  }

  // 3. Volume confirmation
  let volScore = 0;
  let volReason = "";
  if (ind.volumeRatio >= 1.5) {
    volScore = 0.10;
    volReason = `Volume ratio ${ind.volumeRatio.toFixed(2)} >= 1.5`;
  } else if (ind.volumeRatio >= 1.2) {
    volScore = 0.05;
    volReason = `Volume ratio ${ind.volumeRatio.toFixed(2)} >= 1.2`;
  } else {
    volReason = `Volume ratio ${ind.volumeRatio.toFixed(2)} < 1.2`;
  }
  score += volScore;
  factors.push({ name: "Volume Confirmation", score: volScore, status: volScore > 0 ? "PASS" : "FAIL", reason: volReason });

  // 4. Spread quality
  let spreadScore = 0;
  let spreadReason = "";
  if (marketSnapshot.spreadPct <= 0.05) {
    spreadScore = 0.10;
    spreadReason = `Spread ${marketSnapshot.spreadPct.toFixed(4)}% <= 0.05%`;
  } else if (marketSnapshot.spreadPct <= 0.10) {
    spreadScore = 0.05;
    spreadReason = `Spread ${marketSnapshot.spreadPct.toFixed(4)}% <= 0.10%`;
  } else {
    spreadReason = `Spread ${marketSnapshot.spreadPct.toFixed(4)}% > 0.10%`;
  }
  score += spreadScore;
  factors.push({ name: "Spread Quality", score: spreadScore, status: spreadScore > 0 ? "PASS" : "FAIL", reason: spreadReason });

  // 5. Volatility quality
  const volPass = ind.atrPct >= 0.20 && ind.atrPct <= 1.20;
  if (volPass) {
    score += 0.10;
    factors.push({ name: "Volatility Quality", score: 0.10, status: "PASS", reason: `ATR% ${ind.atrPct.toFixed(2)} in optimal zone` });
  } else {
    factors.push({ name: "Volatility Quality", score: 0, status: "FAIL", reason: `ATR% ${ind.atrPct.toFixed(2)} outside 0.20-1.20` });
  }

  // 6. Candle confirmation
  const candlePass = ind.rangePosition >= 0.60;
  if (candlePass) {
    score += 0.10;
    factors.push({ name: "Candle Confirmation", score: 0.10, status: "PASS", reason: `Closed in upper ${(ind.rangePosition * 100).toFixed(0)}% of range` });
  } else {
    factors.push({ name: "Candle Confirmation", score: 0, status: "FAIL", reason: `Closed in lower ${(ind.rangePosition * 100).toFixed(0)}% of range` });
  }

  // 7. Data freshness
  const offset = Math.abs(marketSnapshot.serverTime - marketSnapshot.localTime);
  let freshScore = 0;
  let freshReason = "";
  if (offset < 1000) {
    freshScore = 0.05;
    freshReason = `Time offset ${offset}ms < 1000ms`;
  } else if (offset > 3000) {
    freshScore = -0.10;
    freshReason = `Time offset ${offset}ms > 3000ms`;
  } else {
    freshReason = `Time offset ${offset}ms`;
  }
  score += freshScore;
  factors.push({ name: "Data Freshness", score: freshScore, status: freshScore > 0 ? "PASS" : (freshScore < 0 ? "WARN" : "NEUTRAL"), reason: freshReason });

  // 8. Recent loss penalty
  const recentLosses = recentTrades.filter(t => t.status === "COMPLETED" && t.pnl < 0).length;
  let lossScore = 0;
  let lossReason = "No recent losses";
  if (recentLosses >= 3) {
    lossScore = -0.20;
    lossReason = `${recentLosses} recent losses`;
  } else if (recentLosses === 2) {
    lossScore = -0.10;
    lossReason = `2 recent losses`;
  } else if (recentLosses === 1) {
    lossScore = -0.05;
    lossReason = `1 recent loss`;
  }
  score += lossScore;
  factors.push({ name: "Recent Loss Penalty", score: lossScore, status: lossScore < 0 ? "WARN" : "PASS", reason: lossReason });

  const finalConfidence = Math.max(0, Math.min(1, score));
  const threshold = appConfig.ai.confidenceThreshold;
  const decision = finalConfidence >= threshold ? "APPROVE" : "VETO";

  return {
    confidence: finalConfidence,
    threshold,
    decision,
    factors,
    reason: decision === "APPROVE" 
      ? `Confidence ${(finalConfidence * 100).toFixed(1)}% >= ${(threshold * 100).toFixed(0)}%` 
      : `Confidence ${(finalConfidence * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}%`
  };
}
