import { addItem, getAllItems, clearStore, STORES } from './state.js';

const MAX_LOGS = 5000;

export async function log(level, module, network, message, metadata = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    module,
    network,
    message,
    metadata
  };

  const consoleMethod = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
  console[consoleMethod](`[${level}] [${module}] ${message}`, metadata);

  try {
    await addItem(STORES.LOGS, entry);
    await trimLogs();
  } catch (err) {
    console.error('Failed to write log to DB', err);
  }
}

async function trimLogs() {
  try {
    const logs = await getAllItems(STORES.LOGS);
    if (logs.length > 6000) {
      await clearStore(STORES.LOGS);
    }
  } catch (err) {
    console.error('Failed to trim logs', err);
  }
}

export async function getLogs() {
  return await getAllItems(STORES.LOGS);
}

export async function clearLogs() {
  await clearStore(STORES.LOGS);
}
