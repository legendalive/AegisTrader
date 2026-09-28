import { appConfig } from "./config/app.config.js";
import { initDB, STORES, addItem, getAllItems } from "./modules/state.js";
import { log, getLogs, clearLogs } from "./modules/logs.js";
import { $, $$, setText, setDotClass, showPage, toast, renderTable } from "./modules/ui.js";
import * as vault from "./modules/vault.js";
import * as api from "./modules/api.js";
import { getMarketSnapshot } from "./modules/market.js";
import { evaluateEntrySignal } from "./modules/strategy.js";
import { evaluateAiConfidence } from "./modules/ai.js";
import { evaluateRisk } from "./modules/risk.js";

const appState = {
  network: appConfig.network.default,
  connection: "Disconnected",
  market: null,
  lastSignal: null,
  trades: [],
  account: {
    openPositions: 0,
    tradesToday: 0,
    dailyLossUsedPct: 0,
    inCooldown: false,
    killSwitchActive: false,
    equity: 10000 // Simulated equity for position sizing until live connection
  }
};

function showModal(title, message, fields = []) {
  return new Promise((resolve) => {
    const modal = $("#modal");
    $("#modal-title").textContent = title;
    $("#modal-message").textContent = message;
    const inputsContainer = $("#modal-inputs");
    inputsContainer.innerHTML = "";

    const inputs = fields.map((field) => {
      const wrapper = document.createElement("div");
      wrapper.className = "modal-field";
      const label = document.createElement("label");
      label.textContent = field.label;
      const input = document.createElement("input");
      input.type = field.type || "text";
      input.placeholder = field.placeholder || "";
      input.className = "modal-input";
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      inputsContainer.appendChild(wrapper);
      return input;
    });

    modal.showModal();

    const cleanup = () => {
      modal.close();
      $("#modal-confirm").onclick = null;
      $("#modal-cancel").onclick = null;
    };

    $("#modal-confirm").onclick = () => {
      const values = inputs.map((input) => input.value);
      cleanup();
      resolve(values);
    };

    $("#modal-cancel").onclick = () => {
      cleanup();
      resolve(null);
    };
  });
}

async function renderLogs() {
  try {
    const logs = await getLogs();
    const latest = logs.slice(-100).reverse().map((entry) => ({
      ...entry,
      timestamp: entry.timestamp.replace("T", " ").slice(0, 19)
    }));
    renderTable("logs-table-body", ["timestamp", "level", "module", "network", "message"], latest);
  } catch (err) {
    console.error("Failed to render logs", err);
  }
}

async function renderSignals() {
  try {
    const signals = await getAllItems(STORES.SIGNALS);
    const latest = signals.slice(-100).reverse().map((signal) => ({
      ...signal,
      timestamp: signal.timestamp.replace("T", " ").slice(0, 19),
      price: formatNumber(signal.price, 2),
      aiConfidence: signal.aiConfidence === null ? "-" : `${(signal.aiConfidence * 100).toFixed(1)}%`
    }));
    renderTable("signals-table-body", ["timestamp", "symbol", "side", "price", "aiConfidence", "decision", "reason"], latest);
    if (latest.length > 0) setText("dashboard-last-signal", latest[0].decision);
  } catch (err) {
    console.error("Failed to render signals", err);
  }
}

function renderAiFactors(factors) {
  const tbody = document.getElementById("ai-factor-table-body");
  if (!tbody) return;
  if (!factors || factors.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty">No AI evaluation yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = factors.map(f => `
    <tr>
      <td>${f.name}</td>
      <td>${f.score > 0 ? "+" : ""}${(f.score * 100).toFixed(0)}%</td>
      <td>${f.status}</td>
      <td>${f.reason}</td>
    </tr>
  `).join("");
}

async function saveSignalIfNew(signal) {
  const signals = await getAllItems(STORES.SIGNALS);
  const exists = signals.some((existing) => 
    existing.network === signal.network &&
    existing.symbol === signal.symbol &&
    existing.candleOpenTime === signal.candleOpenTime
  );
  if (!exists) await addItem(STORES.SIGNALS, signal);
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function setConnection(status, dotClass) {
  appState.connection = status;
  setText("connection-status", status);
  setText("dashboard-connection", status);
  setDotClass("connection-dot", dotClass);
}

function formatNumber(value, digits = 8) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

async function handleConnectBinance() {
  try {
    setText("connection-status", "Connecting...");
    setDotClass("connection-dot", "warn");
    const activeEndpoint = await api.testPublicConnection(appState.network, appConfig.trading.symbol, appConfig.trading.interval);
    setConnection("Public connected", "good");
    toast(`Connected via ${activeEndpoint}`, "success");
    await log("INFO", "api", appState.network, `Public Binance connection successful via ${activeEndpoint}.`);
  } catch (err) {
    setConnection("Disconnected", "bad");
    toast(`Connection failed: ${err.message}`, "error");
    await log("ERROR", "api", appState.network, `Public Binance connection failed: ${err.message}`);
  }
  await renderLogs();
}

async function handleRefreshMarketData() {
  try {
    setText("market-data-freshness", "Fetching...");
    const snapshot = await getMarketSnapshot(appState.network, appConfig.trading.symbol, appConfig.trading.interval, 100);
    appState.market = snapshot;

    if (appState.connection !== "Public connected") setConnection("Public connected", "good");

    // 1. Strategy Evaluation
    const signal = evaluateEntrySignal(snapshot);
    
    // 2. AI Evaluation
    const aiResult = evaluateAiConfidence(signal, snapshot, appState.trades);
    signal.aiConfidence = aiResult.confidence;
    
    // 3. Risk Evaluation
    const riskResult = evaluateRisk(signal, snapshot, appState.account);

    // 4. Final Decision Logic
    if (signal.decision === "SIGNAL") {
      if (aiResult.decision === "VETO") {
        signal.decision = "VETOED_BY_AI";
        signal.reason = aiResult.reason;
      } else if (!riskResult.passed) {
        signal.decision = "VETOED_BY_RISK";
        signal.reason = riskResult.reason;
      } else {
        signal.decision = "APPROVED";
        signal.reason = "Signal, AI, and Risk all approved.";
      }
    } else {
      signal.reason = `Strategy failed: ${signal.reason}`;
    }

    appState.lastSignal = signal;

    // Update Market UI
    setText("market-symbol", snapshot.symbol);
    setText("market-interval", snapshot.interval);
    setText("market-last-price", formatNumber(snapshot.currentCandle.close, 2));
    setText("market-bid", formatNumber(snapshot.bid, 2));
    setText("market-ask", formatNumber(snapshot.ask, 2));
    setText("market-spread", `${snapshot.spreadPct.toFixed(4)}%`);
    setText("market-volume", formatNumber(snapshot.closedCandle.volume, 2));
    setText("market-data-freshness", `Server ${new Date(snapshot.serverTime).toISOString().slice(11, 19)} UTC`);
    
    // Indicators (Added console log for debugging blank values)
    console.log("Indicator Debug:", signal.indicators);
    setText("market-ema-20", formatNumber(signal.indicators.ema20, 2));
    setText("market-ema-50", formatNumber(signal.indicators.ema50, 2));
    setText("market-rsi-14", formatNumber(signal.indicators.rsi14, 2));
    setText("market-atr-14", formatNumber(signal.indicators.atr14, 2));

    // Update AI UI
    setText("ai-last-confidence", `${(aiResult.confidence * 100).toFixed(1)}%`);
    setText("ai-last-decision", aiResult.decision);
    renderAiFactors(aiResult.factors);

    // Update Risk UI
    setText("risk-open-positions", appState.account.openPositions);
    setText("risk-trades-today", appState.account.tradesToday);
    setText("risk-daily-loss-used", `${appState.account.dailyLossUsedPct.toFixed(2)}%`);
    setText("risk-current-spread", `${snapshot.spreadPct.toFixed(4)}%`);
    setText("risk-kill-switch", appState.account.killSwitchActive ? "On" : "Off");

    setText("dashboard-last-signal", signal.decision);

    await saveSignalIfNew(signal);
    await renderSignals();

    toast(`Market refreshed. Decision: ${signal.decision}`, "success");
    await log("INFO", "strategy", appState.network, `Signal evaluation completed: ${signal.decision}. Reason: ${signal.reason}`);
  } catch (err) {
    setText("market-data-freshness", "Error");
    toast(`Market refresh failed: ${err.message}`, "error");
    await log("ERROR", "market", appState.network, `Market refresh failed: ${err.message}`);
  }
  await renderLogs();
}

async function handleExportLogs() {
  const logs = await getLogs();
  download(`aegistrader-logs-${Date.now()}.json`, JSON.stringify(logs, null, 2));
  toast("Logs exported.", "success");
  await log("INFO", "logs", appState.network, "Logs exported.");
  await renderLogs();
}

async function handleClearLogs() {
  const confirm = await showModal("Clear Logs", "This deletes all local logs. Type 'CLEAR' to confirm.", [{ label: "Confirmation", type: "text", placeholder: "Type CLEAR" }]);
  if (!confirm || confirm[0] !== "CLEAR") { toast("Log clearing cancelled.", "warning"); return; }
  await clearLogs();
  await renderLogs();
  toast("Logs cleared.", "success");
}

async function handleVaultAction(feature) {
  const network = appState.network;
  if (feature === "Create Passphrase") {
    const status = await vault.getVaultStatus();
    if (status.exists) { toast("Vault already exists. Unlock or delete it first.", "warning"); return; }
    const inputs = await showModal("Create Vault", "Enter a strong passphrase. This is not recoverable.", [{ label: "Passphrase", type: "password", placeholder: "Enter passphrase" }, { label: "Confirm Passphrase", type: "password", placeholder: "Confirm passphrase" }]);
    if (!inputs) return;
    if (inputs[0] !== inputs[1] || inputs[0].length < 8) { toast("Passphrases must match and be at least 8 characters.", "error"); return; }
    try { await vault.createVault(inputs[0]); toast("Vault created and unlocked.", "success"); await log("INFO", "vault", network, "Vault created successfully."); } 
    catch { toast("Failed to create vault.", "error"); await log("ERROR", "vault", network, "Vault creation failed."); }
  }
  if (feature === "Unlock Vault") {
    const status = await vault.getVaultStatus();
    if (!status.exists) { toast("No vault found. Create one first.", "warning"); return; }
    if (status.unlocked) { toast("Vault is already unlocked.", "info"); return; }
    const inputs = await showModal("Unlock Vault", "Enter your passphrase to decrypt secrets.", [{ label: "Passphrase", type: "password", placeholder: "Enter passphrase" }]);
    if (!inputs) return;
    try { await vault.unlockVault(inputs[0]); toast("Vault unlocked.", "success"); await log("INFO", "vault", network, "Vault unlocked successfully."); } 
    catch { toast("Invalid passphrase.", "error"); await log("ERROR", "vault", network, "Vault unlock failed. Invalid passphrase."); }
  }
  if (feature === "Lock Vault") { vault.lockVault(); toast("Vault locked.", "success"); await log("INFO", "vault", network, "Vault locked manually."); }
  if (feature === "Delete Vault") {
    const confirm = await showModal("Delete Vault", "This permanently erases all saved API keys. Type 'DELETE' to confirm.", [{ label: "Confirmation", type: "text", placeholder: "Type DELETE" }]);
    if (!confirm || confirm[0] !== "DELETE") { toast("Vault deletion cancelled.", "warning"); return; }
    await vault.deleteVault(); toast("Vault deleted.", "success"); await log("WARN", "vault", network, "Vault deleted by user.");
  }
  if (feature === "Save Testnet Keys" || feature === "Save Live Keys") {
    if (!vault.isUnlocked()) { toast("Unlock the vault first.", "warning"); return; }
    const targetNetwork = feature === "Save Testnet Keys" ? "testnet" : "live";
    const inputs = await showModal(`Save ${targetNetwork.toUpperCase()} Keys`, "Enter your API credentials and passphrase to encrypt them.", [{ label: "API Key", type: "text", placeholder: "Binance API Key" }, { label: "API Secret", type: "password", placeholder: "Binance API Secret" }, { label: "Passphrase", type: "password", placeholder: "Vault Passphrase" }]);
    if (!inputs) return;
    try { await vault.saveKeysWithPassphrase(inputs[2], targetNetwork, inputs[0], inputs[1]); toast(`${targetNetwork.toUpperCase()} keys saved securely.`, "success"); await log("INFO", "vault", network, `${targetNetwork} API keys saved.`); } 
    catch { toast("Failed to save keys. Check passphrase.", "error"); await log("ERROR", "vault", network, `Failed to save ${targetNetwork} API keys.`); }
  }
  await renderLogs();
}

function bindNavigation() {
  $$(".nav-btn").forEach((btn) => { btn.addEventListener("click", () => { if (btn.dataset.page) showPage(btn.dataset.page); }); });
}

function bindFeatureButtons() {
  $$("[data-feature]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.feature;
      const vaultFeatures = ["Create Passphrase", "Unlock Vault", "Lock Vault", "Delete Vault", "Save Testnet Keys", "Save Live Keys"];
      if (vaultFeatures.includes(feature)) { await handleVaultAction(feature); return; }
      if (feature === "Connect Binance") { await handleConnectBinance(); return; }
      if (feature === "Refresh Market Data") { await handleRefreshMarketData(); return; }
      if (feature === "Export Logs") { await handleExportLogs(); return; }
      if (feature === "Clear Logs") { await handleClearLogs(); return; }
      await log("INFO", "ui", appState.network, `Button clicked: ${feature}`);
      await renderLogs();
      toast(`${feature} will be connected in the next module.`);
    });
  });
}

function updateClock() { setText("utc-clock", `${new Date().toISOString().slice(11, 19)} UTC`); }

function renderNetworkBadge() {
  const badge = $("#network-badge");
  if (!badge) return;
  badge.textContent = appConfig.network.default.toUpperCase();
  badge.className = `badge badge-${appConfig.network.default}`;
}

function renderSettingsSummary() {
  const target = $("#settings-summary");
  if (!target) return;
  const rows = [
    ["App Name", appConfig.app.name], ["Version", appConfig.app.version], ["Default Network", appConfig.network.default],
    ["Testnet Base URL", appConfig.network.endpoints.testnet], ["Live Base URL", appConfig.network.endpoints.live],
    ["Symbol", appConfig.trading.symbol], ["Candle Interval", appConfig.trading.interval], ["Side", appConfig.trading.side],
    ["Poll Interval", `${appConfig.trading.pollIntervalMs} ms`], ["AI Confidence Threshold", `${appConfig.ai.confidenceThreshold * 100}%`],
    ["Risk Per Trade", `${appConfig.risk.riskPerTradePct}%`], ["Max Daily Loss", `${appConfig.risk.maxDailyLossPct}%`],
    ["Max Open Positions", appConfig.risk.maxOpenPositions], ["Max Trades Per Day", appConfig.risk.maxTradesPerDay],
    ["Max Spread", `${appConfig.risk.maxSpreadPct}%`], ["Stop Loss ATR Multiplier", appConfig.risk.stopLossAtrMultiplier],
    ["Take Profit ATR Multiplier", appConfig.risk.takeProfitAtrMultiplier], ["Max Holding Candles", appConfig.risk.maxHoldingCandles],
    ["Cooldown After Loss", `${appConfig.risk.cooldownCandlesAfterLoss} candles`], ["Order Test Before Live", appConfig.execution.orderTestBeforeLive ? "Enabled" : "Disabled"],
    ["Entry Order Type", appConfig.execution.entryOrderType], ["Protective Order Type", appConfig.execution.protectiveOrderType],
    ["Vault Auto-lock", `${appConfig.vault.autoLockMinutes} minutes`], ["Live Typed Confirmation Required", appConfig.live.requireTypedConfirmation ? "Yes" : "No"],
    ["Live Manual Arming Required", appConfig.live.requireManualArm ? "Yes" : "No"]
  ];
  target.innerHTML = `<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>${rows.map(([s, v]) => `<tr><td>${s}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
}

function renderStaticData() {
  setText("dashboard-network", appConfig.network.default.toUpperCase());
  setText("dashboard-connection", appState.connection); setText("dashboard-engine", "Stopped");
  setText("dashboard-account-balance", "0.00000000"); setText("dashboard-available-quote", "0.00000000");
  setText("dashboard-daily-pnl", "0.00%"); setText("dashboard-open-position", "None");
  setText("dashboard-last-signal", "None"); setText("dashboard-ai-confidence", `${appConfig.ai.confidenceThreshold * 100}% threshold`);
  setText("dashboard-trades-today", "0"); setText("dashboard-daily-loss-used", "0.00%"); setText("dashboard-kill-switch", "Off");
  setText("market-symbol", appConfig.trading.symbol); setText("market-interval", appConfig.trading.interval);
  setText("market-last-price", "-"); setText("market-bid", "-"); setText("market-ask", "-"); setText("market-spread", "-");
  setText("market-ema-20", "-"); setText("market-ema-50", "-"); setText("market-rsi-14", "-"); setText("market-atr-14", "-");
  setText("market-volume", "-"); setText("market-data-freshness", "-");
  setText("ai-status-panel", "Active"); setText("ai-threshold", `${appConfig.ai.confidenceThreshold * 100}%`);
  setText("ai-last-confidence", "-"); setText("ai-last-decision", "-"); setText("ai-approvals-today", "0"); setText("ai-vetoes-today", "0");
  setText("risk-max-open-positions", appConfig.risk.maxOpenPositions); setText("risk-open-positions", "0");
  setText("risk-max-trades-day", appConfig.risk.maxTradesPerDay); setText("risk-trades-today", "0");
  setText("risk-per-trade", `${appConfig.risk.riskPerTradePct}%`); setText("risk-max-daily-loss", `${appConfig.risk.maxDailyLossPct}%`);
  setText("risk-daily-loss-used", "0.00%"); setText("risk-max-spread", `${appConfig.risk.maxSpreadPct}%`);
  setText("risk-current-spread", "-"); setText("risk-kill-switch", "Off");
  setText("trade-symbol", appConfig.trading.symbol); setText("trade-side", "-"); setText("trade-entry-time", "-");
  setText("trade-entry-price", "-"); setText("trade-quantity", "-"); setText("trade-stop-loss", "-");
  setText("trade-take-profit", "-"); setText("trade-unrealized-pnl", "-"); setText("trade-protective-order", "-");
  renderNetworkBadge(); renderSettingsSummary();
  setText("connection-status", appState.connection); setText("engine-status", "Stopped");
  setText("ai-status", "Active"); setText("kill-status", "Off");
  setDotClass("connection-dot", "idle"); setDotClass("engine-dot", "idle"); setDotClass("ai-dot", "good"); setDotClass("kill-dot", "good");
}

async function init() {
  try { await initDB(); await log("INFO", "app", appConfig.network.default, "AegisTrader initialized successfully."); } 
  catch (err) { console.error("Failed to initialize DB", err); }
  bindNavigation(); bindFeatureButtons(); renderStaticData(); updateClock();
  await renderLogs(); await renderSignals();
  setInterval(updateClock, 1000);
}

init();
