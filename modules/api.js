import { appConfig } from "../config/app.config.js";

let serverTimeOffset = 0;

export function getBaseUrl(network = appConfig.network.default) {
  return appConfig.network.endpoints[network];
}

async function request(path, params = {}, options = {}) {
  const network = options.network || appConfig.network.default;
  const baseUrl = getBaseUrl(network);

  const url = new URL(baseUrl + path);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    method: options.method || "GET",
    headers: options.headers || {}
  });

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message = data && data.msg ? data.msg : `HTTP ${response.status}`;
    const error = new Error(message);
    error.code = data && data.code;
    error.status = response.status;
    throw error;
  }

  return data;
}

export async function ping(network) {
  return request("/api/v3/ping", {}, { network });
}

export async function getTime(network) {
  const data = await request("/api/v3/time", {}, { network });

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
  return request(
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
  return request(
    "/api/v3/ticker/bookTicker",
    {
      symbol
    },
    { network }
  );
}

export async function getExchangeInfo(network, symbol) {
  return request(
    "/api/v3/exchangeInfo",
    {
      symbol
    },
    { network }
  );
}
