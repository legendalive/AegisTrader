import { appConfig } from "./config/app.config.js";
import { initDB, STORES, addItem, getAllItems } from "./modules/state.js";
import { log, getLogs, clearLogs } from "./modules/logs.js";
import { $, $$, setText, setDotClass, showPage, toast, renderTable, showLoading, hideLoading, setActivity } from "./modules/ui.js";
import * as vault from "./modules/vault.js";
import * as api from "./modules/api.js";
import * as github from "./modules/github.js";
import { getMarketSnapshot } from "./modules/market.js";
import { evaluateEntrySignal } from "./modules/strategy.js";
import { evaluateAiConfidence } from "./modules/ai.js";
import { evaluateRisk } from "./modules/risk.js";

let engineNextRunAt = null;

const appState = {
  network: appConfig.network.default,
  connection: "Disconnected",
  market: null,
  lastSignal: null,
  trades: [],
  account: { openPositions: 0, tradesToday: 0, dailyLossUsedPct: 0, inCooldown: false, killSwitchActive: false, baseBalance: 0, quoteBalance: 0 },
  engineTimeout: null,
  isEngineRunning: false
};

function showModal(title, message, fields = []) {
  return new Promise((resolve) => {
    const modal = $("#modal");
    $("#modal-title").textContent = title;
    $("#modal-message").textContent = message;
    const inputsContainer = $("#modal-inputs");
    inputsContainer.innerHTML = "";
    const inputs = fields.map((field) => {
      const wrapper = document.createElement("div"); wrapper.className = "modal-field";
      const label = document.createElement("label"); label.textContent = field.label;
      const input = document.createElement("input"); input.type = field.type || "text";
      input.placeholder = field.placeholder || ""; input.className = "modal-input";
      wrapper.appendChild(label); wrapper.appendChild(input); inputsContainer.appendChild(wrapper);
      return input;
    });
    modal.showModal();
    const cleanup = () => { modal.close(); $("#modal-confirm").onclick = null; $("#modal-cancel").onclick = null; };
    $("#modal-confirm").onclick = () => { resolve(inputs.map((i) => i.value)); cleanup(); };
    $("#modal-cancel").onclick = () => { resolve(null); cleanup(); };
  });
}

async function renderLogs() {
  try {
    const logs = await getLogs();
    const latest = logs.slice(-100).reverse().map((entry) => ({ ...entry, timestamp: entry.timestamp.replace("T", " ").slice(0, 19) }));
    renderTable("logs-table-body", ["timestamp", "level", "module", "network", "message"], latest);
  } catch (err) { console.error("Failed to render logs", err); }
}

async function renderSignals() {
  try {
    const signals = await getAllItems(STORES.SIGNALS);
    const latest = signals.slice(-100).reverse().map((signal) => ({
      ...signal, timestamp: signal.timestamp.replace("T", " ").slice(0, 19),
      price: formatNumber(signal.price, 2),
      aiConfidence: signal.aiConfidence === null ? "-" : `${(signal.aiConfidence * 100).toFixed(1)}%`
    }));
    renderTable("signals-table-body", ["timestamp", "symbol", "side", "price", "aiConfidence", "decision", "reason"], latest);
    if (latest.length > 0) setText("dashboard-last-signal", latest[0].decision);
  } catch (err) { console.error("Failed to render signals", err); }
}

function renderAiFactors(factors) {
  const tbody = document.getElementById("ai-factor-table-body");
  if (!tbody) return;
  if (!factors || factors.length === 0) { tbody.innerHTML = `<tr><td colspan="4" class="empty">No AI evaluation yet.</td></tr>`; return; }
  tbody.innerHTML = factors.map(f => `<tr><td>${f.name}</td><td>${f.score > 0 ? "+" : ""}${(f.score * 100).toFixed(0)}%</td><td>${f.status}</td><td>${f.reason}</td></tr>`).join("");
}

async function saveSignalIfNew(signal) {
  const signals = await getAllItems(STORES.SIGNALS);
  const exists = signals.some((existing) => existing.network === signal.network && existing.symbol === signal.symbol && existing.candleOpenTime === signal.candleOpenTime);
  if (!exists) await addItem(STORES.SIGNALS, signal);
}

function download(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

function setConnection(status, dotClass) {
  appState.connection = status;
  setText("connection-status", status); setText("dashboard-connection", status);
  setDotClass("connection-dot", dotClass);
}

function formatNumber(value, digits = 8) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

async function handleConnectBinance() {
  showLoading("Connecting to Binance...");
  try {
    setText("connection-status", "Connecting..."); setDotClass("connection-dot", "warn");
    const activeEndpoint = await api.testPublicConnection(appState.network, appConfig.trading.symbol, appConfig.trading.interval);
    setConnection("Public connected", "good");
    toast(`Public connected via ${activeEndpoint}`, "success");
  } catch (err) {
    setConnection("Disconnected", "bad");
    toast(`Connection failed: ${err.message}`, "error");
  } finally {
    hideLoading(); await renderLogs();
  }
}

async function handleRefreshMarketData() {
  showLoading("Refreshing market data...");
  try {
    setText("market-data-freshness", "Fetching...");
    const snapshot = await getMarketSnapshot(appState.network, appConfig.trading.symbol, appConfig.trading.interval, 100);
    appState.market = snapshot;
    if (appState.connection !== "Public connected") setConnection("Public connected", "good");
    
    const signal = evaluateEntrySignal(snapshot);
    const aiResult = evaluateAiConfidence(signal, snapshot, appState.trades);
    signal.aiConfidence = aiResult.confidence;
    const riskResult = evaluateRisk(signal, snapshot, appState.account);
    
    if (signal.decision === "SIGNAL") {
      if (aiResult.decision === "VETO") { signal.decision = "VETOED_BY_AI"; signal.reason = aiResult.reason; } 
      else if (!riskResult.passed) { signal.decision = "VETOED_BY_RISK"; signal.reason = riskResult.reason; } 
      else { signal.decision = "APPROVED"; signal.reason = "Signal, AI, and Risk approved."; }
    } else { signal.reason = `Strategy failed: ${signal.reason}`; }

    appState.lastSignal = signal;
    setText("market-symbol", snapshot.symbol); setText("market-interval", snapshot.interval);
    setText("market-last-price", formatNumber(snapshot.currentCandle.close, 2));
    setText("market-bid", formatNumber(snapshot.bid, 2)); setText("market-ask", formatNumber(snapshot.ask, 2));
    setText("market-spread", `${snapshot.spreadPct.toFixed(4)}%`); setText("market-volume", formatNumber(snapshot.closedCandle.volume, 2));
    setText("market-data-freshness", `Server ${new Date(snapshot.serverTime).toISOString().slice(11, 19)} UTC`);
    setText("market-ema-20", formatNumber(signal.indicators.ema20, 2)); setText("market-ema-50", formatNumber(signal.indicators.ema50, 2));
    setText("market-rsi-14", formatNumber(signal.indicators.rsi14, 2)); setText("market-atr-14", formatNumber(signal.indicators.atr14, 2));
    setText("ai-last-confidence", `${(aiResult.confidence * 100).toFixed(1)}%`); setText("ai-last-decision", aiResult.decision);
    renderAiFactors(aiResult.factors);
    setText("dashboard-last-signal", signal.decision);
    await saveSignalIfNew(signal); await renderSignals();
    toast(`Market refreshed. Decision: ${signal.decision}`, "success");
  } catch (err) {
    setText("market-data-freshness", "Error");
    toast(`Market refresh failed: ${err.message}`, "error");
  } finally {
    hideLoading(); await renderLogs();
  }
}

async function handleExportLogs() { const logs = await getLogs(); download(`aegistrader-logs-${Date.now()}.json`, JSON.stringify(logs, null, 2)); toast("Logs exported.", "success"); await renderLogs(); }
async function handleClearLogs() {
  const confirm = await showModal("Clear Logs", "Type 'CLEAR' to confirm.", [{ label: "Confirmation", type: "text", placeholder: "Type CLEAR" }]);
  if (!confirm || confirm[0] !== "CLEAR") { toast("Cancelled.", "warning"); return; }
  await clearLogs(); await renderLogs(); toast("Logs cleared.", "success");
}

async function handleVaultAction(feature) {
  const network = appState.network;
  if (feature === "Create Passphrase") {
    const status = await vault.getVaultStatus(); if (status.exists) { toast("Vault already exists.", "warning"); return; }
    const inputs = await showModal("Create Vault", "Enter a strong passphrase.", [{ label: "Passphrase", type: "password" }, { label: "Confirm Passphrase", type: "password" }]);
    if (!inputs) return; if (inputs[0] !== inputs[1] || inputs[0].length < 8) { toast("Passphrases must match and be >= 8 chars.", "error"); return; }
    try { await vault.createVault(inputs[0]); toast("Vault created.", "success"); } catch { toast("Failed to create vault.", "error"); }
  }
  if (feature === "Unlock Vault") {
    const status = await vault.getVaultStatus(); if (!status.exists) { toast("No vault found.", "warning"); return; }
    if (status.unlocked) { toast("Already unlocked.", "info"); return; }
    const inputs = await showModal("Unlock Vault", "Enter passphrase.", [{ label: "Passphrase", type: "password" }]);
    if (!inputs) return;
    try { await vault.unlockVault(inputs[0]); toast("Vault unlocked.", "success"); } catch { toast("Invalid passphrase.", "error"); }
  }
  if (feature === "Lock Vault") { vault.lockVault(); toast("Vault locked.", "success"); }
  if (feature === "Delete Vault") {
    const confirm = await showModal("Delete Vault", "Type 'DELETE' to confirm.", [{ label: "Confirmation", type: "text", placeholder: "Type DELETE" }]);
    if (!confirm || confirm[0] !== "DELETE") return;
    await vault.deleteVault(); toast("Vault deleted.", "success");
  }
  if (feature === "Save Testnet Keys" || feature === "Save Live Keys") {
    if (!vault.isUnlocked()) { toast("Unlock vault first.", "warning"); return; }
    const targetNetwork = feature === "Save Testnet Keys" ? "testnet" : "live";
    const inputs = await showModal(`Save ${targetNetwork.toUpperCase()} Keys`, "Enter credentials and passphrase.", [{ label: "API Key", type: "text" }, { label: "API Secret", type: "password" }, { label: "Passphrase", type: "password" }]);
    if (!inputs) return;
    try { await vault.saveKeysWithPassphrase(inputs[2], targetNetwork, inputs[0], inputs[1]); toast(`${targetNetwork} keys saved.`, "success"); } 
    catch { toast("Failed to save keys.", "error"); }
  }
  if (feature === "Save GitHub Token") {
    if (!vault.isUnlocked()) { toast("Unlock vault first.", "warning"); return; }
    const inputs = await showModal("Save GitHub Token", "Enter your Fine-Grained PAT and passphrase.", [{ label: "GitHub Token", type: "password", placeholder: "github_pat_..." }, { label: "Passphrase", type: "password" }]);
    if (!inputs) return;
    try { await vault.saveGithubTokenWithPassphrase(inputs[1], inputs[0]); toast("GitHub token saved.", "success"); } 
    catch { toast("Failed to save token.", "error"); }
  }
  await renderLogs();
}

function bindNavigation() { $$(".nav-btn").forEach((btn) => { btn.addEventListener("click", () => { if (btn.dataset.page) showPage(btn.dataset.page); }); }); }

function bindFeatureButtons() {
  $$("[data-feature]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.feature;
      const vaultFeatures = ["Create Passphrase", "Unlock Vault", "Lock Vault", "Delete Vault", "Save Testnet Keys", "Save Live Keys", "Save GitHub Token"];
      if (vaultFeatures.includes(feature)) { await handleVaultAction(feature); return; }
      if (feature === "Connect Binance") { await handleConnectBinance(); return; }
      if (feature === "Refresh Market Data") { await handleRefreshMarketData(); return; }
      if (feature === "Export Logs") { await handleExportLogs(); return; }
      if (feature === "Clear Logs") { await handleClearLogs(); return; }

            // GitHub API Triggers
      const token = vault.getGithubToken();
      
      if (feature === "Flatten All" || feature === "Flatten Position") { 
        if (!token) { toast("Save GitHub Token in Vault first.", "warning"); return; }
        showLoading("Triggering Flatten All...");
        try { 
            await github.triggerWorkflow("flatten.yml", token); 
            toast("Flatten All workflow triggered.", "success"); 
            await log("INFO", "github", appState.network, "Flatten All workflow triggered.");
        } catch (err) { 
            toast("Trigger failed: " + err.message, "error"); 
            await log("ERROR", "github", appState.network, "Flatten trigger failed: " + err.message);
        }
        hideLoading(); return; 
      }

      if (feature === "Cancel Open Orders" || feature === "Cancel All Orders" || feature === "Cancel Protective Order") { 
        if (!token) { toast("Save GitHub Token in Vault first.", "warning"); return; }
        showLoading("Triggering Cancel Orders...");
        try { 
            await github.triggerWorkflow("cancel-orders.yml", token); 
            toast("Cancel Orders workflow triggered.", "success"); 
            await log("INFO", "github", appState.network, "Cancel Orders workflow triggered.");
        } catch (err) { 
            toast("Trigger failed: " + err.message, "error"); 
            await log("ERROR", "github", appState.network, "Cancel trigger failed: " + err.message);
        }
        hideLoading(); return; 
      }

      if (feature === "Enable Kill Switch") {
        if (!token) { toast("Save GitHub Token in Vault first.", "warning"); return; }
        showLoading("Enabling Kill Switch...");
        try { 
            await github.updateKillSwitch(true, token); 
            toast("Kill Switch enabled.", "success"); 
            await log("INFO", "github", appState.network, "Kill switch enabled.");
        } catch (err) { 
            toast("Failed: " + err.message, "error"); 
            await log("ERROR", "github", appState.network, "Kill switch enable failed: " + err.message);
        }
        hideLoading(); return;
      }

      if (feature === "Disable Kill Switch") {
        if (!token) { toast("Save GitHub Token in Vault first.", "warning"); return; }
        showLoading("Disabling Kill Switch...");
        try { 
            await github.updateKillSwitch(false, token); 
            toast("Kill Switch disabled.", "success"); 
            await log("INFO", "github", appState.network, "Kill switch disabled.");
        } catch (err) { 
            toast("Failed: " + err.message, "error"); 
            await log("ERROR", "github", appState.network, "Kill switch disable failed: " + err.message);
        }
        hideLoading(); return;
      }

      if (feature === "Disable Kill Switch") {
        if (!token) { toast("Save GitHub Token in Vault first.", "warning"); return; }
        showLoading("Disabling Kill Switch...");
        try { await github.updateKillSwitch(false, token); toast("Kill Switch disabled.", "success"); } 
        catch (err) { toast("Failed: " + err.message, "error"); }
        hideLoading(); return;
      }

      await log("INFO", "ui", appState.network, `Button clicked: ${feature}`); await renderLogs();
      toast(`${feature} will be connected in the next module.`);
    });
  });
}

function updateClock() { setText("utc-clock", `${new Date().toISOString().slice(11, 19)} UTC`); }
function renderNetworkBadge() { const badge = $("#network-badge"); if (!badge) return; badge.textContent = appConfig.network.default.toUpperCase(); badge.className = `badge badge-${appConfig.network.default}`; }

function renderSettingsSummary() {
  const target = $("#settings-summary"); if (!target) return;
  const rows = [ ["App Name", appConfig.app.name], ["Version", appConfig.app.version], ["Default Network", appConfig.network.default], ["Testnet Base URL", appConfig.network.endpoints.testnet], ["Live Base URL", appConfig.network.endpoints.live], ["Symbol", appConfig.trading.symbol], ["Candle Interval", appConfig.trading.interval], ["Side", appConfig.trading.side], ["Poll Interval", `${appConfig.trading.pollIntervalMs} ms`], ["AI Confidence Threshold", `${appConfig.ai.confidenceThreshold * 100}%`], ["Risk Per Trade", `${appConfig.risk.riskPerTradePct}%`], ["Max Daily Loss", `${appConfig.risk.maxDailyLossPct}%`], ["Max Open Positions", appConfig.risk.maxOpenPositions], ["Max Trades Per Day", appConfig.risk.maxTradesPerDay], ["Max Spread", `${appConfig.risk.maxSpreadPct}%`], ["Stop Loss ATR Multiplier", appConfig.risk.stopLossAtrMultiplier], ["Take Profit ATR Multiplier", appConfig.risk.takeProfitAtrMultiplier], ["Max Holding Candles", appConfig.risk.maxHoldingCandles], ["Cooldown After Loss", `${appConfig.risk.cooldownCandlesAfterLoss} candles`], ["Order Test Before Live", appConfig.execution.orderTestBeforeLive ? "Enabled" : "Disabled"], ["Entry Order Type", appConfig.execution.entryOrderType], ["Protective Order Type", appConfig.execution.protectiveOrderType], ["Vault Auto-lock", `${appConfig.vault.autoLockMinutes} minutes`], ["Live Typed Confirmation Required", appConfig.live.requireTypedConfirmation ? "Yes" : "No"], ["Live Manual Arming Required", appConfig.live.requireManualArm ? "Yes" : "No"] ];
  target.innerHTML = `<table><thead><tr><th>Setting</th><th>Value</th></tr></thead><tbody>${rows.map(([s, v]) => `<tr><td>${s}</td><td>${v}</td></tr>`).join("")}</tbody></table>`;
}

function renderStaticData() {
  setText("dashboard-network", appConfig.network.default.toUpperCase()); setText("dashboard-connection", appState.connection);
  setText("dashboard-engine", "Stopped"); setText("dashboard-account-balance", "0.00000000"); setText("dashboard-available-quote", "0.00000000");
  setText("dashboard-daily-pnl", "0.00%"); setText("dashboard-open-position", "None"); setText("dashboard-last-signal", "None");
  setText("dashboard-ai-confidence", `${appConfig.ai.confidenceThreshold * 100}% threshold`); setText("dashboard-trades-today", "0");
  setText("dashboard-daily-loss-used", "0.00%"); setText("dashboard-kill-switch", "Off");
  setText("market-symbol", appConfig.trading.symbol); setText("market-interval", appConfig.trading.interval);
  setText("market-last-price", "-"); setText("market-bid", "-"); setText("market-ask", "-"); setText("market-spread", "-");
  setText("market-ema-20", "-"); setText("market-ema-50", "-"); setText("market-rsi-14", "-"); setText("market-atr-14", "-");
  setText("market-volume", "-"); setText("market-data-freshness", "-");
  setText("signal-activity", "Idle"); setText("signal-last-cycle", "-"); setText("signal-next-cycle", "-");
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
  setText("connection-status", appState.connection); setText("engine-status", "Stopped"); setText("ai-status", "Active"); setText("kill-status", "Off");
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
