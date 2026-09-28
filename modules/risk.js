import { appConfig } from "../config/app.config.js";

export function evaluateRisk(signal, marketSnapshot, accountState) {
  const rules = [];
  let passed = true;

  // 1. Max open positions
  const openPosPass = accountState.openPositions < appConfig.risk.maxOpenPositions;
  rules.push({
    rule: "Max Open Positions",
    limit: appConfig.risk.maxOpenPositions,
    current: accountState.openPositions,
    passed: openPosPass
  });
  if (!openPosPass) passed = false;

  // 2. Max trades per day
  const tradesPass = accountState.tradesToday < appConfig.risk.maxTradesPerDay;
  rules.push({
    rule: "Max Trades / Day",
    limit: appConfig.risk.maxTradesPerDay,
    current: accountState.tradesToday,
    passed: tradesPass
  });
  if (!tradesPass) passed = false;

  // 3. Max daily loss
  const lossPass = accountState.dailyLossUsedPct < appConfig.risk.maxDailyLossPct;
  rules.push({
    rule: "Max Daily Loss",
    limit: `${appConfig.risk.maxDailyLossPct}%`,
    current: `${accountState.dailyLossUsedPct.toFixed(2)}%`,
    passed: lossPass
  });
  if (!lossPass) passed = false;

  // 4. Max spread
  const spreadPass = marketSnapshot.spreadPct <= appConfig.risk.maxSpreadPct;
  rules.push({
    rule: "Max Spread",
    limit: `${appConfig.risk.maxSpreadPct}%`,
    current: `${marketSnapshot.spreadPct.toFixed(4)}%`,
    passed: spreadPass
  });
  if (!spreadPass) passed = false;

  // 5. Cooldown after loss
  const cooldownPass = !accountState.inCooldown;
  rules.push({
    rule: "Cooldown After Loss",
    limit: `${appConfig.risk.cooldownCandlesAfterLoss} candles`,
    current: accountState.inCooldown ? "Active" : "Inactive",
    passed: cooldownPass
  });
  if (!cooldownPass) passed = false;

  // 6. Kill switch
  const killPass = !accountState.killSwitchActive;
  rules.push({
    rule: "Kill Switch",
    limit: "Off",
    current: accountState.killSwitchActive ? "On" : "Off",
    passed: killPass
  });
  if (!killPass) passed = false;

  return {
    passed,
    rules,
    reason: passed ? "All risk checks passed." : `Failed: ${rules.filter(r => !r.passed).map(r => r.rule).join(", ")}`
  };
}

export function calculatePositionSize(accountEquity, entryPrice, stopPrice) {
  const riskAmount = accountEquity * (appConfig.risk.riskPerTradePct / 100);
  const stopDistance = Math.abs(entryPrice - stopPrice);
  
  if (stopDistance <= 0) return 0;
  
  return riskAmount / stopDistance;
}

export function calculateStopLoss(entryPrice, atr) {
  return entryPrice - (atr * appConfig.risk.stopLossAtrMultiplier);
}

export function calculateTakeProfit(entryPrice, atr) {
  const tp = entryPrice + (atr * appConfig.risk.takeProfitAtrMultiplier);
  return Math.max(tp, entryPrice * 1.004); // Minimum 0.4% buffer for fees
}
