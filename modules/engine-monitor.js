import { appConfig } from "../config/app.config.js";

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setDotClass(id, className) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("good", "warn", "bad", "idle");
  el.classList.add(className);
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function formatPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return Number(value).toFixed(2);
}

function formatTime(isoString) {
  if (!isoString) return "-";
  return isoString.replace("T", " ").slice(0, 19);
}

function renderTable(tbodyId, columns, data) {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="empty">No data yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = data.map(row => `<tr>${columns.map(col => `<td>${row[col] !== undefined && row[col] !== null ? row[col] : "-"}</td>`).join("")}</tr>`).join("");
}

async function updateEngineMonitor() {
  try {
    const base = appConfig.github && appConfig.github.rawBase ? appConfig.github.rawBase : ".";
    const cacheBust = Date.now();

    const [state, killSwitch, journal] = await Promise.all([
      fetchJson(`${base}/state/engine-state.json?t=${cacheBust}`),
      fetchJson(`${base}/state/kill-switch.json?t=${cacheBust}`),
      fetchJson(`${base}/state/trade-journal.json?t=${cacheBust}`)
    ]);

    const killEnabled = killSwitch && killSwitch.enabled === true;

    if (killEnabled) {
      setText("dashboard-engine", "KILL SWITCH"); setDotClass("engine-dot", "bad");
      setText("dashboard-kill-switch", "ON"); setDotClass("kill-dot", "bad");
    } else {
      setText("dashboard-engine", "Actions Engine"); setDotClass("engine-dot", "good");
      setText("dashboard-kill-switch", "Off"); setDotClass("kill-dot", "good");
    }

    setText("signal-activity", state.lastRunStatus || "Idle");
    setText("signal-last-cycle", formatTime(state.lastRunAt));
    setText("signal-next-cycle", "Next closed 15m candle");
    setText("dashboard-last-signal", state.lastDecision || "-");
    setText("dashboard-trades-today", String(state.tradesCount || 0));
    setText("risk-trades-today", String(state.tradesCount || 0));

    // Render Active Trade
    if (journal.active) {
      setText("trade-symbol", state.lastSymbol || "-");
      setText("trade-side", "LONG");
      setText("trade-entry-time", formatTime(journal.active.entryTime));
      setText("trade-entry-price", formatPrice(journal.active.entryPrice));
      setText("trade-quantity", String(journal.active.quantity || "-"));
      setText("trade-stop-loss", formatPrice(journal.active.stopLoss));
      setText("trade-take-profit", formatPrice(journal.active.takeProfit));
      setText("trade-protective-order", "OCO Active");
      setText("dashboard-open-position", "Active");
    } else {
      setText("trade-symbol", "-"); setText("trade-side", "-"); setText("trade-entry-time", "-");
      setText("trade-entry-price", "-"); setText("trade-quantity", "-"); setText("trade-stop-loss", "-");
      setText("trade-take-profit", "-"); setText("trade-protective-order", "-");
      setText("dashboard-open-position", "None");
    }

    // Render Completed Trades
    const completedData = journal.completed.slice().reverse().map((t, index) => ({
      id: journal.completed.length - index,
      entryTime: formatTime(t.entryTime),
      exitTime: formatTime(t.exitTime),
      entryPrice: formatPrice(t.entryPrice),
      exitPrice: formatPrice(t.exitPrice),
      pnl: `${t.pnl >= 0 ? "+" : ""}${formatPrice(t.pnl)} USDT`,
      exitReason: t.exitReason || "OCO"
    }));

    renderTable("completed-trades-table-body", ["id", "entryTime", "exitTime", "entryPrice", "exitPrice", "pnl", "exitReason"], completedData);

    // Calculate Daily PnL
    const todayStr = new Date().toISOString().slice(0, 10);
    let dailyPnl = 0;
    for (const t of journal.completed) {
      if (t.exitTime && t.exitTime.startsWith(todayStr)) {
        dailyPnl += t.pnl;
      }
    }
    setText("dashboard-daily-pnl", `${dailyPnl >= 0 ? "+" : ""}${formatPrice(dailyPnl)} USDT`);

  } catch (err) {
    console.error("Engine monitor failed", err);
    setText("signal-activity", "Monitor error");
  }
}

updateEngineMonitor();
setInterval(updateEngineMonitor, 60000);
