import { appConfig } from "./config/app.config.js";

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = value;
  }
}

function setDotClass(id, className) {
  const el = document.getElementById(id);
  if (!el) return;

  el.classList.remove("good", "warn", "bad", "idle");
  el.classList.add(className);
}

function showPage(pageName) {
  $$(".page").forEach((page) => {
    page.classList.remove("active");
  });

  $$(".nav-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  const page = $(`#page-${pageName}`);
  const navButton = $(`.nav-btn[data-page="${pageName}"]`);

  if (page) page.classList.add("active");
  if (navButton) navButton.classList.add("active");
}

function toast(message) {
  const toastEl = $("#toast");
  if (!toastEl) return;

  toastEl.textContent = message;
  toastEl.classList.add("show");

  clearTimeout(toastEl._timer);
  toastEl._timer = setTimeout(() => {
    toastEl.classList.remove("show");
  }, 3000);
}

function bindNavigation() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) {
        showPage(page);
      }
    });
  });
}

function bindFeatureButtons() {
  $$("[data-feature]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const feature = btn.dataset.feature;
      toast(`${feature} will be connected in the next module.`);
    });
  });
}

function updateClock() {
  const now = new Date();
  const utcTime = `${now.toISOString().slice(11, 19)} UTC`;
  setText("utc-clock", utcTime);
}

function renderNetworkBadge() {
  const badge = $("#network-badge");
  if (!badge) return;

  const network = appConfig.network.default;
  badge.textContent = network.toUpperCase();
  badge.className = `badge badge-${network}`;
}

function renderSettingsSummary() {
  const target = $("#settings-summary");
  if (!target) return;

  const rows = [
    ["App Name", appConfig.app.name],
    ["Version", appConfig.app.version],
    ["Default Network", appConfig.network.default],
    ["Testnet Base URL", appConfig.network.endpoints.testnet],
    ["Live Base URL", appConfig.network.endpoints.live],
    ["Symbol", appConfig.trading.symbol],
    ["Candle Interval", appConfig.trading.interval],
    ["Side", appConfig.trading.side],
    ["Poll Interval", `${appConfig.trading.pollIntervalMs} ms`],
    ["AI Confidence Threshold", `${appConfig.ai.confidenceThreshold * 100}%`],
    ["Risk Per Trade", `${appConfig.risk.riskPerTradePct}%`],
    ["Max Daily Loss", `${appConfig.risk.maxDailyLossPct}%`],
    ["Max Open Positions", appConfig.risk.maxOpenPositions],
    ["Max Trades Per Day", appConfig.risk.maxTradesPerDay],
    ["Max Spread", `${appConfig.risk.maxSpreadPct}%`],
    ["Stop Loss ATR Multiplier", appConfig.risk.stopLossAtrMultiplier],
    ["Take Profit ATR Multiplier", appConfig.risk.takeProfitAtrMultiplier],
    ["Max Holding Candles", appConfig.risk.maxHoldingCandles],
    ["Cooldown After Loss", `${appConfig.risk.cooldownCandlesAfterLoss} candles`],
    ["Order Test Before Live", appConfig.execution.orderTestBeforeLive ? "Enabled" : "Disabled"],
    ["Entry Order Type", appConfig.execution.entryOrderType],
    ["Protective Order Type", appConfig.execution.protectiveOrderType],
    ["Vault Auto-lock", `${appConfig.vault.autoLockMinutes} minutes`],
    ["Live Typed Confirmation Required", appConfig.live.requireTypedConfirmation ? "Yes" : "No"],
    ["Live Manual Arming Required", appConfig.live.requireManualArm ? "Yes" : "No"]
  ];

  target.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Setting</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(([setting, value]) => {
            return `
              <tr>
                <td>${setting}</td>
                <td>${value}</td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderStaticData() {
  setText("dashboard-network", appConfig.network.default.toUpperCase());
  setText("dashboard-connection", "Disconnected");
  setText("dashboard-engine", "Stopped");
  setText("dashboard-account-balance", "0.00000000");
  setText("dashboard-available-quote", "0.00000000");
  setText("dashboard-daily-pnl", "0.00%");
  setText("dashboard-open-position", "None");
  setText("dashboard-last-signal", "None");
  setText("dashboard-ai-confidence", `${appConfig.ai.confidenceThreshold * 100}% threshold`);
  setText("dashboard-trades-today", "0");
  setText("dashboard-daily-loss-used", "0.00%");
  setText("dashboard-kill-switch", "Off");

  setText("market-symbol", appConfig.trading.symbol);
  setText("market-interval", appConfig.trading.interval);
  setText("market-last-price", "-");
  setText("market-bid", "-");
  setText("market-ask", "-");
  setText("market-spread", "-");
  setText("market-ema-20", "-");
  setText("market-ema-50", "-");
  setText("market-rsi-14", "-");
  setText("market-atr-14", "-");
  setText("market-volume", "-");
  setText("market-data-freshness", "-");

  setText("ai-status-panel", "Active");
  setText("ai-threshold", `${appConfig.ai.confidenceThreshold * 100}%`);
  setText("ai-last-confidence", "-");
  setText("ai-last-decision", "-");
  setText("ai-approvals-today", "0");
  setText("ai-vetoes-today", "0");

  setText("risk-max-open-positions", appConfig.risk.maxOpenPositions);
  setText("risk-open-positions", "0");
  setText("risk-max-trades-day", appConfig.risk.maxTradesPerDay);
  setText("risk-trades-today", "0");
  setText("risk-per-trade", `${appConfig.risk.riskPerTradePct}%`);
  setText("risk-max-daily-loss", `${appConfig.risk.maxDailyLossPct}%`);
  setText("risk-daily-loss-used", "0.00%");
  setText("risk-max-spread", `${appConfig.risk.maxSpreadPct}%`);
  setText("risk-current-spread", "-");
  setText("risk-kill-switch", "Off");

  setText("trade-symbol", appConfig.trading.symbol);
  setText("trade-side", "-");
  setText("trade-entry-time", "-");
  setText("trade-entry-price", "-");
  setText("trade-quantity", "-");
  setText("trade-stop-loss", "-");
  setText("trade-take-profit", "-");
  setText("trade-unrealized-pnl", "-");
  setText("trade-protective-order", "-");

  renderNetworkBadge();
  renderSettingsSummary();

  setText("connection-status", "Disconnected");
  setText("engine-status", "Stopped");
  setText("ai-status", "Active");
  setText("kill-status", "Off");

  setDotClass("connection-dot", "idle");
  setDotClass("engine-dot", "idle");
  setDotClass("ai-dot", "good");
  setDotClass("kill-dot", "good");
}

function init() {
  bindNavigation();
  bindFeatureButtons();
  renderStaticData();
  updateClock();

  setInterval(updateClock, 1000);
}

init();
