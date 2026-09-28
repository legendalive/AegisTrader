import { appConfig } from "./config/app.config.js";
import { initDB, STORES, addItem, getAllItems } from "./modules/state.js";
import { log, getLogs, clearLogs } from "./modules/logs.js";
import {
  $,
  $$,
  setText,
  setDotClass,
  showPage,
  toast,
  renderTable,
  showLoading,
  hideLoading,
  setActivity
} from "./modules/ui.js";
import * as vault from "./modules/vault.js";
import * as api from "./modules/api.js";
import { getMarketSnapshot } from "./modules/market.js";
import { evaluateEntrySignal } from "./modules/strategy.js";
import { evaluateAiConfidence } from "./modules/ai.js";
import { evaluateRisk } from "./modules/risk.js";
import * as executor from "./modules/executor.js";

let engineNextRunAt = null;

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
    baseBalance: 0,
    quoteBalance: 0
  },
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

    const latest = logs
      .slice(-100)
      .reverse()
      .map((entry) => {
        return {
          ...entry,
          timestamp: entry.timestamp.replace("T", " ").slice(0, 19)
        };
      });

    renderTable(
      "logs-table-body",
      ["timestamp", "level", "module", "network", "message"],
      latest
    );
  } catch (err) {
    console.error("Failed to render logs", err);
  }
}

async function renderSignals() {
  try {
    const signals = await getAllItems(STORES.SIGNALS);

    const latest = signals
      .slice(-100)
      .reverse()
      .map((signal) => {
        return {
          ...signal,
          timestamp: signal.timestamp.replace("T", " ").slice(0, 19),
          price: formatNumber(signal.price, 2),
          aiConfidence: signal.aiConfidence === null
            ? "-"
            : `${(signal.aiConfidence * 100).toFixed(1)}%`
        };
      });

    renderTable(
      "signals-table-body",
      ["timestamp", "symbol", "side", "price", "aiConfidence", "decision", "reason"],
      latest
    );

    if (latest.length > 0) {
      setText("dashboard-last-signal", latest[0].decision);
    }
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

  tbody.innerHTML = factors
    .map((f) => {
      return `
        <tr>
          <td>${f.name}</td>
          <td>${f.score > 0 ? "+" : ""}${(f.score * 100).toFixed(0)}%</td>
          <td>${f.status}</td>
          <td>${f.reason}</td>
        </tr>
      `;
    })
    .join("");
}

function renderDiagnostics(results) {
  renderTable(
    "diagnostics-table-body",
    ["test", "endpoint", "status", "time", "message"],
    results
  );
}

async function saveSignalIfNew(signal) {
  const signals = await getAllItems(STORES.SIGNALS);

  const exists = signals.some((existing) => {
    return existing.network === signal.network &&
      existing.symbol === signal.symbol &&
      existing.candleOpenTime === signal.candleOpenTime;
  });

  if (!exists) {
    await addItem(STORES.SIGNALS, signal);
  }
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

function setEngineStatus(status, dotClass) {
  appState.isEngineRunning = status === "Running";

  setText("engine-status", status);
  setText("dashboard-engine", status);
  setDotClass("engine-dot", dotClass);

  const engineDot = $("#engine-dot");

  if (engineDot) {
    engineDot.classList.remove("blink");

    if (status === "Running") {
      engineDot.classList.add("blink");
    }
  }
}

function formatNumber(value, digits = 8) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toFixed(digits);
}

function updateEngineCountdown() {
  if (!appState.isEngineRunning) {
    setText("signal-next-cycle", "-");
    return;
  }

  if (!engineNextRunAt) {
    setText("signal-next-cycle", "Running...");
    return;
  }

  const remaining = Math.max(0, Math.ceil((engineNextRunAt - Date.now()) / 1000));
  setText("signal-next-cycle", `${remaining}s`);
}

function scheduleNextRun(ms = 15000) {
  engineNextRunAt = Date.now() + ms;
  updateEngineCountdown();
}

async function fetchAndRenderAccount() {
  const keys = vault.getKeys(appState.network);

  if (!keys) {
    setText("dashboard-account-balance", "Locked");
    setText("dashboard-available-quote", "Locked");
    setText("dashboard-open-position", "Locked");
    return false;
  }

  try {
    const state = await executor.fetchAccountState(
      appState.network,
      appConfig.trading.symbol,
      keys.apiKey,
      keys.apiSecret
    );

    appState.account = {
      ...appState.account,
      ...state
    };

    setText("dashboard-account-balance", `${formatNumber(state.baseBalance, 8)} BTC`);
    setText("dashboard-available-quote", `${formatNumber(state.quoteBalance, 2)} USDT`);
    setText("dashboard-open-position", state.hasPosition ? "Active" : "None");
    setText("risk-open-positions", String(state.openPositions));

    return true;
  } catch (err) {
    setText("dashboard-account-balance", "Error");
    setText("dashboard-available-quote", "Error");
    setText("dashboard-open-position", "Unknown");

    await log("ERROR", "executor", appState.network, `Account fetch failed: ${err.message}`);

    return false;
  }
}

async function handleConnectBinance() {
  showLoading("Connecting to Binance...");

  try {
    setText("connection-status", "Connecting...");
    setDotClass("connection-dot", "warn");

    const activeEndpoint = await api.testPublicConnection(
      appState.network,
      appConfig.trading.symbol,
      appConfig.trading.interval
    );

    setConnection("Public connected", "good");

    toast(`Public connected via ${activeEndpoint}`, "success");
    await log("INFO", "api", appState.network, `Public Binance connection successful via ${activeEndpoint}.`);

    const keys = vault.getKeys(appState.network);

    if (keys) {
      const privateOk = await fetchAndRenderAccount();

      if (privateOk) {
        setConnection("Signed connected", "good");
        toast("Private account connected.", "success");
        await log("INFO", "api", appState.network, "Private account connection successful.");
      } else {
        setConnection("Public only", "warn");
        toast("Public connected, but private account failed.", "warning");
      }
    }
  } catch (err) {
    setConnection("Disconnected", "bad");

    toast(`Connection failed: ${err.message}`, "error");
    await log("ERROR", "api", appState.network, `Connection failed: ${err.message}`);
  } finally {
    hideLoading();
    await renderLogs();
  }
}

async function runEngineCycle() {
  setActivity("signal-activity", true, "Fetching and evaluating...");
  setText("signal-last-cycle", `${new Date().toISOString().slice(11, 19)} UTC`);
  setText("signal-next-cycle", "Running...");

  try {
    const keys = vault.getKeys(appState.network);

    if (!keys) {
      handleStopEngine();
      toast("Vault locked. Engine stopped.", "warning");
      return;
    }

    const accountOk = await fetchAndRenderAccount();

    const snapshot = await getMarketSnapshot(
      appState.network,
      appConfig.trading.symbol,
      appConfig.trading.interval,
      100
    );

    appState.market = snapshot;

    const signal = evaluateEntrySignal(snapshot);

    const aiResult = evaluateAiConfidence(signal, snapshot, appState.trades);
    signal.aiConfidence = aiResult.confidence;

    const riskResult = evaluateRisk(signal, snapshot, appState.account);

    if (signal.decision === "SIGNAL") {
      if (aiResult.decision === "VETO") {
        signal.decision = "VETOED_BY_AI";
        signal.reason = aiResult.reason;
      } else if (!riskResult.passed) {
        signal.decision = "VETOED_BY_RISK";
        signal.reason = riskResult.reason;
      } else {
        signal.decision = "APPROVED";
        signal.reason = "Signal, AI, and Risk approved.";
      }
    } else {
      signal.reason = `Strategy failed: ${signal.reason}`;
    }

    appState.lastSignal = signal;

    if (signal.decision === "APPROVED") {
      if (!accountOk) {
        await log("ERROR", "engine", appState.network, "Skipping execution because private account fetch failed.");
      } else {
        await log("TRADE", "executor", appState.network, "Executing approved entry signal...");

        const result = await executor.executeEntry(
          appState.network,
          appConfig.trading.symbol,
          keys.apiKey,
          keys.apiSecret,
          snapshot,
          signal,
          appState.account
        );

        toast(`Trade executed. Qty: ${result.quantity}`, "success");

        await log(
          "TRADE",
          "executor",
          appState.network,
          `Entry filled near ${formatNumber(result.entryPrice, 2)}. Stop: ${formatNumber(result.stopPrice, 2)}. TP: ${formatNumber(result.takeProfitPrice, 2)}.`
        );

        await fetchAndRenderAccount();
      }
    }

    setText("market-symbol", snapshot.symbol);
    setText("market-interval", snapshot.interval);
    setText("market-last-price", formatNumber(snapshot.currentCandle.close, 2));
    setText("market-bid", formatNumber(snapshot.bid, 2));
    setText("market-ask", formatNumber(snapshot.ask, 2));
    setText("market-spread", `${snapshot.spreadPct.toFixed(4)}%`);
    setText("market-volume", formatNumber(snapshot.closedCandle.volume, 2));
    setText("market-data-freshness", `Server ${new Date(snapshot.serverTime).toISOString().slice(11, 19)} UTC`);
    setText("market-ema-20", formatNumber(signal.indicators.ema20, 2));
    setText("market-ema-50", formatNumber(signal.indicators.ema50, 2));
    setText("market-rsi-14", formatNumber(signal.indicators.rsi14, 2));
    setText("market-atr-14", formatNumber(signal.indicators.atr14, 2));

    setText("ai-last-confidence", `${(aiResult.confidence * 100).toFixed(1)}%`);
    setText("ai-last-decision", aiResult.decision);
    renderAiFactors(aiResult.factors);

    setText("risk-open-positions", String(appState.account.openPositions));
    setText("risk-trades-today", String(appState.account.tradesToday));
    setText("risk-daily-loss-used", `${appState.account.dailyLossUsedPct.toFixed(2)}%`);
    setText("risk-current-spread", `${snapshot.spreadPct.toFixed(4)}%`);
    setText("risk-kill-switch", appState.account.killSwitchActive ? "On" : "Off");

    setText("dashboard-last-signal", signal.decision);

    await saveSignalIfNew(signal);
    await renderSignals();
  } catch (err) {
    await log("ERROR", "engine", appState.network, `Engine cycle error: ${err.message}`);

    if (err.message.includes("API") || err.message.includes("keys")) {
      handleStopEngine();
      toast("Engine stopped due to API error.", "error");
    }
  } finally {
    setActivity("signal-activity", false, "Idle");

    if (appState.isEngineRunning) {
      scheduleNextRun(15000);

      appState.engineTimeout = setTimeout(runEngineCycle, 15000);
    }

    await renderLogs();
  }
}

async function handleStartEngine() {
  if (appState.isEngineRunning) {
    toast("Engine is already running.", "warning");
    return;
  }

  const keys = vault.getKeys(appState.network);

  if (!keys) {
    toast("Unlock vault and save Testnet keys first.", "error");
    return;
  }

  if (appState.network === "live") {
    toast("Live execution is locked.", "error");
    return;
  }

  showLoading("Starting engine...");

  const accountOk = await fetchAndRenderAccount();

  hideLoading();

  if (!accountOk) {
    toast("Private account connection failed. Run Diagnostics.", "error");
    return;
  }

  setEngineStatus("Running", "good");

  toast("Engine started. Cycle every 15 seconds.", "success");
  await log("INFO", "engine", appState.network, "Automated engine started.");

  await renderLogs();

  await runEngineCycle();
}

function handleStopEngine() {
  if (appState.engineTimeout) {
    clearTimeout(appState.engineTimeout);
    appState.engineTimeout = null;
  }

  engineNextRunAt = null;

  setEngineStatus("Stopped", "idle");
  setText("signal-next-cycle", "-");
  setActivity("signal-activity", false, "Idle");

  toast("Engine stopped.", "info");
  log("INFO", "engine", appState.network, "Automated engine stopped.");
}

async function handleFlattenAll() {
  const keys = vault.getKeys(appState.network);

  if (!keys) {
    toast("Unlock vault first.", "warning");
    return;
  }

  showLoading("Flattening position...");

  try {
    await executor.flattenAll(
      appState.network,
      appConfig.trading.symbol,
      keys.apiKey,
      keys.apiSecret,
      appState.account.baseBalance
    );

    toast("Position flattened.", "success");
    await log("TRADE", "executor", appState.network, "Manual Flatten All executed.");

    await fetchAndRenderAccount();
  } catch (err) {
    toast(`Flatten failed: ${err.message}`, "error");
    await log("ERROR", "executor", appState.network, `Flatten failed: ${err.message}`);
  } finally {
    hideLoading();
    await renderLogs();
  }
}

async function handleCancelOpenOrders() {
  const keys = vault.getKeys(appState.network);

  if (!keys) {
    toast("Unlock vault first.", "warning");
    return;
  }

  showLoading("Cancelling open orders...");

  try {
    await executor.cancelAll(
      appState.network,
      appConfig.trading.symbol,
      keys.apiKey,
      keys.apiSecret
    );

    toast("All open orders cancelled.", "success");
    await log("TRADE", "executor", appState.network, "Manual Cancel All Orders executed.");

    await fetchAndRenderAccount();
  } catch (err) {
    toast(`Cancel failed: ${err.message}`, "error");
    await log("ERROR", "executor", appState.network, `Cancel orders failed: ${err.message}`);
  } finally {
    hideLoading();
    await renderLogs();
  }
}

async function runDiagnostics({ publicTests, privateTests }) {
  showLoading("Running diagnostics...");

  const results = [];
  const network = appState.network;
  const symbol = appConfig.trading.symbol;
  const interval = appConfig.trading.interval;

  async function timed(test, endpoint, fn) {
    const start = performance.now();

    try {
      const result = await fn();
      const elapsed = Math.round(performance.now() - start);

      results.push({
        test,
        endpoint: result && result.endpoint ? result.endpoint : endpoint,
        status: "PASS",
        time: `${elapsed} ms`,
        message: result && result.message ? result.message : "OK"
      });
    } catch (err) {
      const elapsed = Math.round(performance.now() - start);

      results.push({
        test,
        endpoint,
        status: "FAIL",
        time: `${elapsed} ms`,
        message: err.message
      });
    }
  }

  try {
    if (publicTests) {
      await timed(
        "Public Ping",
        api.getActivePublicBaseUrl() || "auto",
        async () => {
          await api.ping(network);
          return { endpoint: api.getActivePublicBaseUrl() };
        }
      );

      await timed(
        "Public Time",
        api.getActivePublicBaseUrl() || "auto",
        async () => {
          await api.getTime(network);
          return { endpoint: api.getActivePublicBaseUrl() };
        }
      );

      await timed(
        "Public Klines",
        api.getActivePublicBaseUrl() || "auto",
        async () => {
          await api.getKlines(network, symbol, interval, 2);
          return { endpoint: api.getActivePublicBaseUrl() };
        }
      );

      await timed(
        "Public Book Ticker",
        api.getActivePublicBaseUrl() || "auto",
        async () => {
          await api.getBookTicker(network, symbol);
          return { endpoint: api.getActivePublicBaseUrl() };
        }
      );
    }

    if (privateTests) {
      const keys = vault.getKeys(network);
      const privateEndpoint = api.getPrivateBaseUrl(network);

      if (!keys) {
        results.push({
          test: "Private Account",
          endpoint: privateEndpoint,
          status: "FAIL",
          time: "-",
          message: "Vault locked or keys not saved."
        });

        results.push({
          test: "Private Open Orders",
          endpoint: privateEndpoint,
          status: "FAIL",
          time: "-",
          message: "Vault locked or keys not saved."
        });
      } else {
        await timed(
          "Private Account",
          privateEndpoint,
          async () => {
            await api.getAccount(network, keys.apiKey, keys.apiSecret);
            return { endpoint: privateEndpoint };
          }
        );

        await timed(
          "Private Open Orders",
          privateEndpoint,
          async () => {
            await api.getOpenOrders(network, symbol, keys.apiKey, keys.apiSecret);
            return { endpoint: privateEndpoint };
          }
        );
      }
    }

    renderDiagnostics(results);

    const failed = results.filter((r) => r.status === "FAIL").length;

    if (failed === 0) {
      toast("All diagnostics passed.", "success");
    } else {
      toast(`${failed} diagnostic(s) failed.`, "error");
    }

    await log(
      failed ? "ERROR" : "INFO",
      "diagnostics",
      network,
      `Diagnostics completed. Failed: ${failed}.`
    );
  } finally {
    hideLoading();
    await renderLogs();
  }
}

async function handleRefreshMarketData() {
  showLoading("Refreshing market data...");

  try {
    setText("market-data-freshness", "Fetching...");

    const snapshot = await getMarketSnapshot(
      appState.network,
      appConfig.trading.symbol,
      appConfig.trading.interval,
      100
    );

    appState.market = snapshot;

    if (appState.connection !== "Public connected") {
      setConnection("Public connected", "good");
    }

    const signal = evaluateEntrySignal(snapshot);

    const aiResult = evaluateAiConfidence(signal, snapshot, appState.trades);
    signal.aiConfidence = aiResult.confidence;

    const riskResult = evaluateRisk(signal, snapshot, appState.account);

    if (signal.decision === "SIGNAL") {
      if (aiResult.decision === "VETO") {
        signal.decision = "VETOED_BY_AI";
        signal.reason = aiResult.reason;
      } else if (!riskResult.passed) {
        signal.decision = "VETOED_BY_RISK";
        signal.reason = riskResult.reason;
      } else {
        signal.decision = "APPROVED";
        signal.reason = "Signal, AI, and Risk approved.";
      }
    } else {
      signal.reason = `Strategy failed: ${signal.reason}`;
    }

    appState.lastSignal = signal;

    setText("market-symbol", snapshot.symbol);
    setText("market-interval", snapshot.interval);
    setText("market-last-price", formatNumber(snapshot.currentCandle.close, 2));
    setText("market-bid", formatNumber(snapshot.bid, 2));
    setText("market-ask", formatNumber(snapshot.ask, 2));
    setText("market-spread", `${snapshot.spreadPct.toFixed(4)}%`);
    setText("market-volume", formatNumber(snapshot.closedCandle.volume, 2));
    setText("market-data-freshness", `Server ${new Date(snapshot.serverTime).toISOString().slice(11, 19)} UTC`);

    setText("market-ema-20", formatNumber(signal.indicators.ema20, 2));
    setText("market-ema-50", formatNumber(signal.indicators.ema50, 2));
    setText("market-rsi-14", formatNumber(signal.indicators.rsi14, 2));
    setText("market-atr-14", formatNumber(signal.indicators.atr14, 2));

    setText("ai-last-confidence", `${(aiResult.confidence * 100).toFixed(1)}%`);
    setText("ai-last-decision", aiResult.decision);
    renderAiFactors(aiResult.factors);

    setText("dashboard-last-signal", signal.decision);

    await saveSignalIfNew(signal);
    await renderSignals();

    toast(`Market refreshed. Decision: ${signal.decision}`, "success");
  } catch (err) {
    setText("market-data-freshness", "Error");

    toast(`Market refresh failed: ${err.message}`, "error");
    await log("ERROR", "market", appState.network, `Market refresh failed: ${err.message}`);
  } finally {
    hideLoading();
    await renderLogs();
  }
}

async function handleExportLogs() {
  const logs = await getLogs();

  download(
    `aegistrader-logs-${Date.now()}.json`,
    JSON.stringify(logs, null, 2)
  );

  toast("Logs exported.", "success");
  await log("INFO", "logs", appState.network, "Logs exported.");
  await renderLogs();
}

async function handleClearLogs() {
  const confirm = await showModal(
    "Clear Logs",
    "This deletes all local logs. Type 'CLEAR' to confirm.",
    [
      {
        label: "Confirmation",
        type: "text",
        placeholder: "Type CLEAR"
      }
    ]
  );

  if (!confirm || confirm[0] !== "CLEAR") {
    toast("Log clearing cancelled.", "warning");
    return;
  }

  await clearLogs();
  await renderLogs();

  toast("Logs cleared.", "success");
}

async function handleVaultAction(feature) {
  const network = appState.network;

  if (feature === "Create Passphrase") {
    const status = await vault.getVaultStatus();

    if (status.exists) {
      toast("Vault already exists. Unlock or delete it first.", "warning");
      return;
    }

    const inputs = await showModal(
      "Create Vault",
      "Enter a strong passphrase. This is not recoverable.",
      [
        {
          label: "Passphrase",
          type: "password",
          placeholder: "Enter passphrase"
        },
        {
          label: "Confirm Passphrase",
          type: "password",
          placeholder: "Confirm passphrase"
        }
      ]
    );

    if (!inputs) return;

    if (inputs[0] !== inputs[1] || inputs[0].length < 8) {
      toast("Passphrases must match and be at least 8 characters.", "error");
      return;
    }

    try {
      await vault.createVault(inputs[0]);

      toast("Vault created and unlocked.", "success");
      await log("INFO", "vault", network, "Vault created successfully.");
    } catch {
      toast("Failed to create vault.", "error");
      await log("ERROR", "vault", network, "Vault creation failed.");
    }
  }

  if (feature === "Unlock Vault") {
    const status = await vault.getVaultStatus();

    if (!status.exists) {
      toast("No vault found. Create one first.", "warning");
      return;
    }

    if (status.unlocked) {
      toast("Vault is already unlocked.", "info");
      return;
    }

    const inputs = await showModal(
      "Unlock Vault",
      "Enter your passphrase to decrypt secrets.",
      [
        {
          label: "Passphrase",
          type: "password",
          placeholder: "Enter passphrase"
        }
      ]
    );

    if (!inputs) return;

    try {
      await vault.unlockVault(inputs[0]);

      toast("Vault unlocked.", "success");
      await log("INFO", "vault", network, "Vault unlocked successfully.");
    } catch {
      toast("Invalid passphrase.", "error");
      await log("ERROR", "vault", network, "Vault unlock failed. Invalid passphrase.");
    }
  }

  if (feature === "Lock Vault") {
    vault.lockVault();
    handleStopEngine();

    toast("Vault locked.", "success");
    await log("INFO", "vault", network, "Vault locked manually.");
  }

  if (feature === "Delete Vault") {
    const confirm = await showModal(
      "Delete Vault",
      "This permanently erases all saved API keys. Type 'DELETE' to confirm.",
      [
        {
          label: "Confirmation",
          type: "text",
          placeholder: "Type DELETE"
        }
      ]
    );

    if (!confirm || confirm[0] !== "DELETE") {
      toast("Vault deletion cancelled.", "warning");
      return;
    }

    await vault.deleteVault();
    handleStopEngine();

    toast("Vault deleted.", "success");
    await log("WARN", "vault", network, "Vault deleted by user.");
  }

  if (feature === "Save Testnet Keys" || feature === "Save Live Keys") {
    if (!vault.isUnlocked()) {
      toast("Unlock the vault first.", "warning");
      return;
    }

    const targetNetwork = feature === "Save Testnet Keys" ? "testnet" : "live";

    const inputs = await showModal(
      `Save ${targetNetwork.toUpperCase()} Keys`,
      "Enter your API credentials and passphrase to encrypt them.",
      [
        {
          label: "API Key",
          type: "text",
          placeholder: "Binance API Key"
        },
        {
          label: "API Secret",
          type: "password",
          placeholder: "Binance API Secret"
        },
        {
          label: "Passphrase",
          type: "password",
          placeholder: "Vault Passphrase"
        }
      ]
    );

    if (!inputs) return;

    try {
      await vault.saveKeysWithPassphrase(
        inputs[2],
        targetNetwork,
        inputs[0],
        inputs[1]
      );

      toast(`${targetNetwork.toUpperCase()} keys saved securely.`, "success");
      await log("INFO", "vault", network, `${targetNetwork} API keys saved.`);
    } catch {
      toast("Failed to save keys. Check passphrase.", "error");
      await log("ERROR", "vault", network, `Failed to save ${targetNetwork} API keys.`);
    }
  }

  await renderLogs();
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
    btn.addEventListener("click", async () => {
      const feature = btn.dataset.feature;

      const vaultFeatures = [
        "Create Passphrase",
        "Unlock Vault",
        "Lock Vault",
        "Delete Vault",
        "Save Testnet Keys",
        "Save Live Keys"
      ];

      if (vaultFeatures.includes(feature)) {
        await handleVaultAction(feature);
        return;
      }

      if (feature === "Connect Binance") {
        await handleConnectBinance();
        return;
      }

      if (feature === "Refresh Market Data") {
        await handleRefreshMarketData();
        return;
      }

      if (feature === "Export Logs") {
        await handleExportLogs();
        return;
      }

      if (feature === "Clear Logs") {
        await handleClearLogs();
        return;
      }

      if (feature === "Start Engine") {
        await handleStartEngine();
        return;
      }

      if (feature === "Stop Engine") {
        handleStopEngine();
        return;
      }

      if (feature === "Flatten All" || feature === "Flatten Position") {
        await handleFlattenAll();
        return;
      }

      if (
        feature === "Cancel Open Orders" ||
        feature === "Cancel All Orders" ||
        feature === "Cancel Protective Order"
      ) {
        await handleCancelOpenOrders();
        return;
      }

      if (feature === "Run Public Diagnostics") {
        await runDiagnostics({ publicTests: true, privateTests: false });
        return;
      }

      if (feature === "Run Private Diagnostics") {
        await runDiagnostics({ publicTests: false, privateTests: true });
        return;
      }

      if (feature === "Run Full Diagnostics") {
        await runDiagnostics({ publicTests: true, privateTests: true });
        return;
      }

      await log("INFO", "ui", appState.network, `Button clicked: ${feature}`);
      await renderLogs();

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
  setText("dashboard-connection", appState.connection);
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

  setText("signal-activity", "Idle");
  setText("signal-last-cycle", "-");
  setText("signal-next-cycle", "-");

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

  setText("connection-status", appState.connection);
  setText("engine-status", "Stopped");
  setText("ai-status", "Active");
  setText("kill-status", "Off");

  setDotClass("connection-dot", "idle");
  setDotClass("engine-dot", "idle");
  setDotClass("ai-dot", "good");
  setDotClass("kill-dot", "good");
}

async function init() {
  try {
    await initDB();
    await log("INFO", "app", appConfig.network.default, "AegisTrader initialized successfully.");
  } catch (err) {
    console.error("Failed to initialize DB", err);
  }

  bindNavigation();
  bindFeatureButtons();
  renderStaticData();
  updateClock();

  await renderLogs();
  await renderSignals();

  setInterval(updateClock, 1000);
  setInterval(updateEngineCountdown, 1000);
}

init();
