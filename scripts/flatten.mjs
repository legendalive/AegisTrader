import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const network = "testnet";
const symbol = process.env.TRADE_SYMBOL || "BTCUSDT";
const apiKey = process.env.BINANCE_TESTNET_API_KEY;
const apiSecret = process.env.BINANCE_TESTNET_API_SECRET;

if (!apiKey || !apiSecret) {
  console.log("No API keys configured. Exiting.");
  process.exit(0);
}

const executor = await import("../modules/executor.js");

try {
  console.log("Fetching account state...");
  const state = await executor.fetchAccountState(network, symbol, apiKey, apiSecret);
  console.log("Open positions:", state.openPositions);
  console.log("Open orders:", state.openOrdersCount);
  
  console.log("Executing Flatten All...");
  await executor.flattenAll(network, symbol, apiKey, apiSecret, state.baseBalance);
  console.log("Flatten All completed successfully.");
} catch (err) {
  console.error("Flatten failed:", err.message);
  process.exit(1);
}
