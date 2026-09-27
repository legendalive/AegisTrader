import { appConfig } from "../config/app.config.js";

const REQUEST_TIMEOUT_MS = 10000;
const PUBLIC_MARKET_DATA_ENDPOINT = "https://data-api.binance.vision";

let serverTimeOffset = 0;
let activePublicBaseUrl = null;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
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
  const url = new URL(baseUrl + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: options.method || "GET",
      headers: options.headers || {},
      signal: controller.signal
    });

    const text = await response.text();

    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (typeof data === "string" && data.trim().startsWith("<")) {
      throw new Error(`Endpoint returned HTML instead of JSON: ${url.host}${path}`);
    }

    if (!response.ok) {
      const message = data && data.msg ? data.msg : `HTTP ${response.status}`;
      const error = new Error(message);
      error.code = data && data.code;
      error.status = response.status;
      throw error;
    }

    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Request timed out: ${url.host}${path}`);
    }

    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function publicRequest(path, params = {}, options = {}) {
  const network = options.network || appConfig.network.default;

  const candidates = unique([
    activePublicBaseUrl,
    ...getPublicCandidates(network)
  ]);

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

export async function ping(network) {
  return publicRequest("/api/v3/ping", {}, { network });
}

export async function getTime(network) {
  const data = await publicRequest("/api/v3/time", {}, { network });

  serverTimeOffset = data.serverTime - Date.now();

  return data.serverTime;
}

export function getServerTimeOffset() {
  return serverTimeOffset;
}

export function getTimestamp() {
  return Date.now() + serverTimeOffset;
}

export async function getKlines(network, symbol, interval, limit = 100) {
  return publicRequest(
    "/api/v3/klines",
    {
      symbol,
      interval,
      limit
    },
    { network }
  );
}

export async function getBookTicker(network, symbol) {
  return publicRequest(
    "/api/v3/ticker/bookTicker",
    {
      symbol
    },
    { network }
  );
}

export async function getExchangeInfo(network, symbol) {
  return publicRequest(
    "/api/v3/exchangeInfo",
    {
      symbol
    },
    { network }
  );
}

export async function testPublicConnection(network, symbol, interval) {
  await getTime(network);
  await getKlines(network, symbol, interval, 2);
  await getBookTicker(network, symbol);

  return getActivePublicBaseUrl();
}
