import { appConfig } from "./config/app.config.js";
import { initDB } from "./modules/state.js";
import { log } from "./modules/logs.js";
import { $, $$, setText, setDotClass, showPage, toast, renderTable } from "./modules/ui.js";
import * as vault from "./modules/vault.js";

function showModal(title, message, fields = []) {
  return new Promise((resolve) => {
    const modal = $('#modal');
    $('#modal-title').textContent = title;
    $('#modal-message').textContent = message;
    const inputsContainer = $('#modal-inputs');
    inputsContainer.innerHTML = '';

    const inputs = fields.map(field => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal-field';
      const label = document.createElement('label');
      label.textContent = field.label;
      const input = document.createElement('input');
      input.type = field.type || 'text';
      input.placeholder = field.placeholder || '';
      input.className = 'modal-input';
      wrapper.appendChild(label);
      wrapper.appendChild(input);
      inputsContainer.appendChild(wrapper);
      return input;
    });

    modal.showModal();

    const cleanup = () => {
      modal.close();
      $('#modal-confirm').onclick = null;
      $('#modal-cancel').onclick = null;
    };

    $('#modal-confirm').onclick = () => {
      const values = inputs.map(i => i.value);
      cleanup();
      resolve(values);
    };

    $('#modal-cancel').onclick = () => {
      cleanup();
      resolve(null);
    };
  });
}

async function handleVaultAction(feature) {
  const network = appConfig.network.default;

  if (feature === "Create Passphrase") {
    const status = await vault.getVaultStatus();
    if (status.exists) {
      toast("Vault already exists. Unlock or Delete it first.", "warning");
      return;
    }
    const inputs = await showModal("Create Vault", "Enter a strong passphrase. This is not recoverable.", [
      { label: "Passphrase", type: "password", placeholder: "Enter passphrase" },
      { label: "Confirm Passphrase", type: "password", placeholder: "Confirm passphrase" }
    ]);
    if (!inputs) return;
    if (inputs[0] !== inputs[1] || inputs[0].length < 8) {
      toast("Passphrases must match and be at least 8 characters.", "error");
      return;
    }
    try {
      await vault.createVault(inputs[0]);
      toast("Vault created and unlocked.", "success");
      await log('INFO', 'vault', network, 'Vault created successfully');
    } catch (err) {
      toast("Failed to create vault.", "error");
    }
  } 
  
  else if (feature === "Unlock Vault") {
    const status = await vault.getVaultStatus();
    if (!status.exists) {
      toast("No vault found. Create one first.", "warning");
      return;
    }
    if (status.unlocked) {
      toast("Vault is already unlocked.", "info");
      return;
    }
    const inputs = await showModal("Unlock Vault", "Enter your passphrase to decrypt secrets.", [
      { label: "Passphrase", type: "password", placeholder: "Enter passphrase" }
    ]);
    if (!inputs) return;
    try {
      await vault.unlockVault(inputs[0]);
      toast("Vault unlocked.", "success");
      await log('INFO', 'vault', network, 'Vault unlocked successfully');
    } catch (err) {
      toast("Invalid passphrase.", "error");
    }
  } 
  
  else if (feature === "Lock Vault") {
    vault.lockVault();
    toast("Vault locked.", "success");
    await log('INFO', 'vault', network, 'Vault locked manually');
  } 
  
  else if (feature === "Delete Vault") {
    const confirm = await showModal("Delete Vault", "This will permanently erase all saved API keys. Type 'DELETE' to confirm.", [
      { label: "Confirmation", type: "text", placeholder: "Type DELETE" }
    ]);
    if (!confirm || confirm[0] !== 'DELETE') {
      toast("Deletion cancelled.", "warning");
      return;
    }
    await vault.deleteVault();
    toast("Vault deleted.", "success");
    await log('WARN', 'vault', network, 'Vault deleted by user');
  } 
  
  else if (feature === "Save Testnet Keys" || feature === "Save Live Keys") {
    if (!vault.isUnlocked()) {
      toast("Unlock the vault first.", "warning");
      return;
    }
    const targetNet = feature === "Save Testnet Keys" ? "testnet" : "live";
    const inputs = await showModal(`Save ${targetNet.toUpperCase()} Keys`, "Enter your API credentials and passphrase to encrypt.", [
      { label: "API Key", type: "text", placeholder: "Binance API Key" },
      { label: "API Secret", type: "password", placeholder: "Binance API Secret" },
      { label: "Passphrase", type: "password", placeholder: "Vault Passphrase" }
    ]);
    if (!inputs) return;
    
    try {
      await vault.saveKeysWithPassphrase(inputs[2], targetNet, inputs[0], inputs[1]);
      toast(`${targetNet.toUpperCase()} keys saved securely.`, "success");
      await log('INFO', 'vault', network, `${targetNet} keys saved`);
    } catch (err) {
      toast("Failed to save keys. Check passphrase.", "error");
    }
  }
}

function bindNavigation() {
  $$(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      if (page) showPage(page);
    });
  });
}

function bindFeatureButtons() {
  $$("[data-feature]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.feature;
      
      // Route Vault features to the vault handler
      const vaultFeatures = ["Create Passphrase", "Unlock Vault", "Lock Vault", "Delete Vault", "Save Testnet Keys", "Save Live Keys"];
      if (vaultFeatures.includes(feature)) {
        await handleVaultAction(feature);
        return;
      }

      // Placeholder for other modules
      await log('INFO', 'ui', appConfig.network.default, `Button clicked: ${feature}`);
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
    ["App Name", appConfig.app.name], ["Version", appConfig.app.version],
    ["Default Network", appConfig.network.default], ["Testnet Base URL", appConfig.network.endpoints.testnet],
    ["Live Base URL", appConfig.network.endpoints.live], ["Symbol", appConfig.trading.symbol],
    ["Candle Interval", appConfig.trading.interval], ["Side", appConfig.trading.side],
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
  setText("dashboard-connection", "Disconnected"); setText("dashboard-engine", "Stopped");
  setText("dashboard-account-balance", "0.00000000"); setText("dashboard-available-quote", "0.00000000");
  setText("dashboard-daily-pnl", "0.00%"); setText("dashboard-open-position", "None");
  setText("dashboard-last-signal", "None"); setText("dashboard-ai-confidence", `${appConfig.ai.confidenceThreshold * 100}% threshold`);
  setText("dashboard-trades-today", "0"); setText("dashboard-daily-loss-used", "0.00%"); setText("dashboard-kill-switch", "Off");
  setText("market-symbol", appConfig.trading.symbol); setText("market-interval", appConfig.trading.interval);
  setText("market-last-price", "-"); setText("market-bid", "-"); setText("market-ask", "-"); setText("market-spread", "-");
  setText("market-ema-20", "-"); setText("market-ema-50", "-"); setText("market-rsi-14", "-");
  setText("market-atr-14", "-"); setText("market-volume", "-"); setText("market-data-freshness", "-");
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
  setText("connection-status", "Disconnected"); setText("engine-status", "Stopped");
  setText("ai-status", "Active"); setText("kill-status", "Off");
  setDotClass("connection-dot", "idle"); setDotClass("engine-dot", "idle");
  setDotClass("ai-dot", "good"); setDotClass("kill-dot", "good");
}

async function init() {
  try {
    await initDB();
    await log('INFO', 'app', appConfig.network.default, 'AegisTrader initialized successfully');
  } catch (err) {
    console.error('Failed to initialize DB', err);
  }
  bindNavigation();
  bindFeatureButtons();
  renderStaticData();
  updateClock();
  setInterval(updateClock, 1000);
}

init();
