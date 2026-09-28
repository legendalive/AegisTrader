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

const api = await import("../modules/api.js");

try {
  console.log("Cancelling all open orders...");
  await api.cancelAllOrders(network, symbol, apiKey, apiSecret);
  console.log("All open orders cancelled successfully.");
} catch (err) {
  console.error("Cancel failed:", err.message);
  process.exit(1);
}
