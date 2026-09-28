import { appConfig } from "../config/app.config.js";

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

async function fetchJson(url) {
  const response = await fetch(url, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return "-";
  }

  return Number(value).toFixed(2);
}

function formatTime(isoString) {
  if (!isoString) {
    return "-";
  }

  return isoString.replace("T", " ").slice(0, 19);
}

async function updateEngineMonitor() {
  try {
    const base = appConfig.github && appConfig.github.rawBase
      ? appConfig.github.rawBase
      : ".";

    const cacheBust = Date.now();

    const [state, killSwitch] = await Promise.all([
      fetchJson(`${base}/state/engine-state.json?t=${cacheBust}`),
      fetchJson(`${base}/state/kill-switch.json?t=${cacheBust}`)
    ]);

    const killEnabled = killSwitch && killSwitch.enabled === true;

    if (killEnabled) {
      setText("dashboard-engine", "KILL SWITCH");
      setDotClass("engine-dot", "bad");
      setText("dashboard-kill-switch", "ON");
      setDotClass("kill-dot", "bad");
    } else {
      setText("dashboard-engine", "Actions Engine");
      setDotClass("engine-dot", "good");
      setText("dashboard-kill-switch", "Off");
      setDotClass("kill-dot", "good");
    }

    setText("signal-activity", state.lastRunStatus || "Idle");
    setText("signal-last-cycle", formatTime(state.lastRunAt));
    setText("signal-next-cycle", "Next closed 15m candle");
    setText("dashboard-last-signal", state.lastDecision || "-");

    setText("dashboard-trades-today", String(state.tradesCount || 0));
    setText("risk-trades-today", String(state.tradesCount || 0));

    if (state.lastTrade) {
      setText("trade-symbol", state.lastTrade.symbol || "-");
      setText("trade-side", state.lastTrade.side || "-");
      setText("trade-entry-time", formatTime(state.lastTrade.time));
      setText("trade-entry-price", formatPrice(state.lastTrade.entryPrice));
      setText("trade-quantity", String(state.lastTrade.quantity || "-"));
      setText("trade-stop-loss", formatPrice(state.lastTrade.stopPrice));
      setText("trade-take-profit", formatPrice(state.lastTrade.takeProfitPrice));
      setText("trade-protective-order", "OCO");
    }
  } catch (err) {
    console.error("Engine monitor failed", err);
    setText("signal-activity", "Monitor error");
  }
}

updateEngineMonitor();

setInterval(updateEngineMonitor, 60000);
