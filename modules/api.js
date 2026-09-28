import { appConfig } from "../config/app.config.js";

const REQUEST_TIMEOUT_MS = 10000;
const PUBLIC_MARKET_DATA_ENDPOINT = "https://data-api.binance.vision";

let serverTimeOffset = 0;
let activePublicBaseUrl = null;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function useProxy() {
  return appConfig.proxy && appConfig.proxy.enabled && appConfig.proxy.url;
}

export function getPrivateBaseUrl(network = appConfig.network.default) {
  return appConfig.network.endpoints[network];
}

export function getActivePublicBaseUrl() {
  return activePublicBaseUrl;
}

function getPublicCandidates(network) {
  if (network === "testnet") {
    return [
      appConfig.network.endpoints.testnet,
      PUBLIC_MARKET_DATA_ENDPOINT,
      appConfig.network.endpoints.live
    ];
  }
  return [
    appConfig.network.endpoints.live,
    PUBLIC_MARKET_DATA_ENDPOINT
  ];
}

async function rawRequest(baseUrl, path, params = {}, options = {}) {
  const proxy = useProxy();
  const requestUrl = proxy ? appConfig.proxy.url : baseUrl;
  const url = new URL(requestUrl + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  const headers = options.headers || {};
  if (proxy) headers["X-Target-Base"] = baseUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Public request timed out");
    throw new Error("Public request failed: " + err.message);
  }

  try {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (typeof data === "string" && data.trim().startsWith("<")) {
      throw new Error("Endpoint returned HTML instead of JSON");
    }

    if (!response.ok) {
      const message = data && data.msg ? data.msg : "HTTP " + response.status;
      const error = new Error(message);
      error.code = data && data.code;
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function publicRequest(path, params = {}, options = {}) {
  const network = options.network || appConfig.network.default;
  const candidates = unique([activePublicBaseUrl, ...getPublicCandidates(network)]);
  let lastError = null;

  for (const baseUrl of candidates) {
    try {
      const data = await rawRequest(baseUrl, path, params, options);
      activePublicBaseUrl = baseUrl;
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(lastError ? lastError.message : "Failed to fetch");
}

async function signRequest(secret, queryString) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(queryString));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function privateRequest(path, params = {}, method = "GET", network, apiKey, apiSecret) {
  if (!apiKey || !apiSecret) throw new Error("API keys are missing.");

  const baseUrl = getPrivateBaseUrl(network);
  const proxy = useProxy();
  const requestUrl = proxy ? appConfig.proxy.url : baseUrl;

  const timestamp = Date.now() + serverTimeOffset;
  params.timestamp = timestamp;
  params.recvWindow = 5000;

  const queryString = Object.keys(params)
    .map((key) => key + "=" + encodeURIComponent(params[key]))
    .join("&");

  const signature = await signRequest(apiSecret, queryString);
  const finalUrl = requestUrl + path + "?" + queryString + "&signature=" + signature;

  const headers = { "X-MBX-APIKEY": apiKey };
  if (proxy) headers["X-Target-Base"] = baseUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(finalUrl, {
      method,
      headers,
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError") throw new Error("Signed request timed out");
    throw new Error("Signed request failed: " + err.message);
  }

  try {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (typeof data === "string" && data.trim().startsWith("<")) {
      throw new Error("Signed endpoint returned HTML instead of JSON");
    }

    if (!response.ok) {
      const message = data && data.msg ? data.msg : "HTTP " + response.status;
      const error = new Error(message);
      error.code = data && data.code;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function ping(network) { return publicRequest("/api/v3/ping", {}, { network }); }

export async function getTime(network) {
  const data = await publicRequest("/api/v3/time", {}, { network });
  serverTimeOffset = data.serverTime - Date.now();
  return data.serverTime;
}

export function getServerTimeOffset() { return serverTimeOffset; }
export function getTimestamp() { return Date.now() + serverTimeOffset; }

export async function getKlines(network, symbol, interval, limit = 100) {
  return publicRequest("/api/v3/klines", { symbol, interval, limit }, { network });
}

export async function getBookTicker(network, symbol) {
  return publicRequest("/api/v3/ticker/bookTicker", { symbol }, { network });
}

export async function getExchangeInfo(network, symbol) {
  return publicRequest("/api/v3/exchangeInfo", { symbol }, { network });
}

export async function testPublicConnection(network, symbol, interval) {
  await getTime(network);
  await getKlines(network, symbol, interval, 2);
  await getBookTicker(network, symbol);
  return getActivePublicBaseUrl();
}

export async function getAccount(network, apiKey, apiSecret) {
  return privateRequest("/api/v3/account", {}, "GET", network, apiKey, apiSecret);
}

export async function getOpenOrders(network, symbol, apiKey, apiSecret) {
  return privateRequest("/api/v3/openOrders", { symbol }, "GET", network, apiKey, apiSecret);
}

export async function createOrder(network, params, apiKey, apiSecret) {
  return privateRequest("/api/v3/order", params, "POST", network, apiKey, apiSecret);
}

export async function cancelAllOrders(network, symbol, apiKey, apiSecret) {
  try {
    return await privateRequest("/api/v3/openOrders", { symbol }, "DELETE", network, apiKey, apiSecret);
  } catch (err) {
    if (err.code === -2011) return [];
    throw err;
  }
}

export async function getMyTrades(network, symbol, apiKey, apiSecret) {
  return privateRequest("/api/v3/myTrades", { symbol, limit: 50 }, "GET", network, apiKey, apiSecret);
}
