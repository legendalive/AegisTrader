import * as api from "./api.js";

export async function getMarketSnapshot(network, symbol, interval, limit = 100) {
  let serverTime;

  try {
    serverTime = await api.getTime(network);
  } catch {
    serverTime = Date.now();
  }

  const [klines, ticker] = await Promise.all([
    api.getKlines(network, symbol, interval, limit),
    api.getBookTicker(network, symbol)
  ]);

  const candles = klines.map((k) => {
    return {
      openTime: k[0],
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      closeTime: k[6],
      quoteVolume: Number(k[7]),
      trades: Number(k[8])
    };
  });

  if (!Array.isArray(candles) || candles.length < 2) {
    throw new Error("Not enough candle data received from Binance.");
  }

  const currentCandle = candles[candles.length - 1];
  const closedCandle = candles[candles.length - 2];

  const bid = Number(ticker.bidPrice);
  const ask = Number(ticker.askPrice);
  const mid = (bid + ask) / 2;

  const spreadPct = mid > 0 ? ((ask - bid) / mid) * 100 : 0;

  return {
    network,
    symbol,
    interval,
    serverTime,
    localTime: Date.now(),
    bid,
    ask,
    mid,
    spreadPct,
    currentCandle,
    closedCandle,
    candles
  };
}
