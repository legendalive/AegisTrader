export function sma(values, period) {
  const output = new Array(values.length).fill(null);

  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];

    if (i >= period) {
      sum -= values[i - period];
    }

    if (i >= period - 1) {
      output[i] = sum / period;
    }
  }

  return output;
}

export function ema(values, period) {
  const output = new Array(values.length).fill(null);

  if (values.length < period) {
    return output;
  }

  let seed = 0;

  for (let i = 0; i < period; i++) {
    seed += values[i];
  }

  const multiplier = 2 / (period + 1);

  output[period - 1] = seed / period;

  for (let i = period; i < values.length; i++) {
    output[i] = (values[i] - output[i - 1]) * multiplier + output[i - 1];
  }

  return output;
}

export function rsi(values, period = 14) {
  const output = new Array(values.length).fill(null);

  if (values.length <= period) {
    return output;
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];

    if (change > 0) {
      gains += change;
    } else {
      losses -= change;
    }
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  output[period] = calculateRsi(avgGain, avgLoss);

  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    output[i] = calculateRsi(avgGain, avgLoss);
  }

  return output;
}

function calculateRsi(avgGain, avgLoss) {
  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

export function atr(candles, period = 14) {
  const output = new Array(candles.length).fill(null);

  if (candles.length <= period) {
    return output;
  }

  const trueRanges = new Array(candles.length).fill(null);

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const previousCandle = candles[i - 1];

    const rangeA = candle.high - candle.low;
    const rangeB = Math.abs(candle.high - previousCandle.close);
    const rangeC = Math.abs(candle.low - previousCandle.close);

    trueRanges[i] = Math.max(rangeA, rangeB, rangeC);
  }

  let sum = 0;

  for (let i = 1; i <= period; i++) {
    sum += trueRanges[i];
  }

  output[period] = sum / period;

  for (let i = period + 1; i < candles.length; i++) {
    output[i] = (output[i - 1] * (period - 1) + trueRanges[i]) / period;
  }

  return output;
}

export function calculateIndicatorSnapshot(candles) {
  if (!Array.isArray(candles) || candles.length < 52) {
    throw new Error("Not enough candles for indicator calculation. Minimum 52 required.");
  }

  const closedCandles = candles.slice(0, -1);

  const closes = closedCandles.map((candle) => candle.close);
  const volumes = closedCandles.map((candle) => candle.volume);

  const ema20Array = ema(closes, 20);
  const ema50Array = ema(closes, 50);
  const rsi14Array = rsi(closes, 14);
  const atr14Array = atr(closedCandles, 14);
  const volumeSma20Array = sma(volumes, 20);

  const lastIndex = closedCandles.length - 1;
  const closedCandle = closedCandles[lastIndex];

  const ema20 = ema20Array[lastIndex];
  const ema50 = ema50Array[lastIndex];
  const rsi14 = rsi14Array[lastIndex];
  const atr14 = atr14Array[lastIndex];
  const volume = closedCandle.volume;
  const volumeSMA20 = volumeSma20Array[lastIndex];

  const range = closedCandle.high - closedCandle.low;
  const rangePosition = range > 0
    ? (closedCandle.close - closedCandle.low) / range
    : 0.5;

  const volumeRatio = volumeSMA20 && volumeSMA20 > 0
    ? volume / volumeSMA20
    : 0;

  const atrPct = closedCandle.close > 0 && atr14 !== null
    ? (atr14 / closedCandle.close) * 100
    : 0;

  return {
    candleOpenTime: closedCandle.openTime,
    candleCloseTime: closedCandle.closeTime,
    close: closedCandle.close,
    ema20,
    ema50,
    rsi14,
    atr14,
    volume,
    volumeSMA20,
    volumeRatio,
    rangePosition,
    atrPct
  };
}
