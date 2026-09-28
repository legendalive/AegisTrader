import * as api from "./api.js";
import { calculatePositionSize, calculateStopLoss, calculateTakeProfit } from "./risk.js";
import { appConfig } from "../config/app.config.js";

export async function fetchAccountState(network, symbol, apiKey, apiSecret) {
  const account = await api.getAccount(network, apiKey, apiSecret);
  const openOrders = await api.getOpenOrders(network, symbol, apiKey, apiSecret);

  const baseAsset = symbol.replace(/USDT$/, "");
  const quoteAsset = "USDT";

  let baseBalance = 0;
  let quoteBalance = 0;

  for (const bal of account.balances) {
    if (bal.asset === baseAsset) baseBalance = parseFloat(bal.free) + parseFloat(bal.locked);
    if (bal.asset === quoteAsset) quoteBalance = parseFloat(bal.free) + parseFloat(bal.locked);
  }

  // Consider having > 0.00001 of the base asset as an open position (ignoring dust)
  const hasPosition = baseBalance > 0.00001;

  return {
    baseBalance,
    quoteBalance,
    hasPosition,
    openOrdersCount: openOrders.length,
    openPositions: hasPosition ? 1 : 0
  };
}

function adjustToStepSize(value, stepSize) {
  const precision = stepSize.toString().split('.')[1]?.length || 0;
  const factor = Math.pow(10, precision);
  return Math.floor(value * factor) / factor;
}

export async function executeEntry(network, symbol, apiKey, apiSecret, marketSnapshot, signal, accountState) {
  if (network === "live") {
    throw new Error("Live execution is currently locked for safety.");
  }

  const exchangeInfo = await api.getExchangeInfo(network, symbol);
  const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
  
  const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
  const stepSize = parseFloat(lotSizeFilter.stepSize);
  const minQty = parseFloat(lotSizeFilter.minQty);

  const entryPrice = marketSnapshot.ask;
  const atr = signal.indicators.atr14;
  
  const stopPrice = calculateStopLoss(entryPrice, atr);
  const takeProfitPrice = calculateTakeProfit(entryPrice, atr);

  // Calculate size based on quote balance (since we don't have real equity yet, we use available USDT)
  const equity = accountState.quoteBalance; 
  let quantity = calculatePositionSize(equity, entryPrice, stopPrice);
  
  quantity = adjustToStepSize(quantity, stepSize);

  if (quantity < minQty) {
    throw new Error(`Calculated quantity ${quantity} is below minimum ${minQty}`);
  }

  // 1. Place Market Buy
  const buyParams = {
    symbol: symbol,
    side: "BUY",
    type: "MARKET",
    quantity: quantity.toFixed(stepSize.toString().split('.')[1]?.length || 0)
  };

  const buyOrder = await api.createOrder(network, buyParams, apiKey, apiSecret);

  // 2. Place OCO Protective Order
  // Note: Testnet OCO can sometimes be finicky. We will use standard Stop-Limit and Limit if OCO fails.
  try {
    const ocoParams = {
      symbol: symbol,
      side: "SELL",
      quantity: buyOrder.executedQty || buyOrder.origQty,
      price: takeProfitPrice.toFixed(2),
      stopPrice: stopPrice.toFixed(2),
      stopLimitPrice: (stopPrice * 0.999).toFixed(2),
      stopLimitTimeInForce: "GTC"
    };
    await api.createOrder(network, { ...ocoParams, type: "OCO" }, apiKey, apiSecret);
  } catch (err) {
    console.warn("OCO order failed, attempting separate limit and stop-limit orders.", err);
    // Fallback: Place Limit Sell (Take Profit)
    await api.createOrder(network, {
      symbol, side: "SELL", type: "LIMIT", timeInForce: "GTC",
      quantity: buyOrder.executedQty || buyOrder.origQty,
      price: takeProfitPrice.toFixed(2)
    }, apiKey, apiSecret);
    
    // Fallback: Place Stop-Limit Sell (Stop Loss)
    await api.createOrder(network, {
      symbol, side: "SELL", type: "STOP_LOSS_LIMIT", timeInForce: "GTC",
      quantity: buyOrder.executedQty || buyOrder.origQty,
      price: (stopPrice * 0.999).toFixed(2),
      stopPrice: stopPrice.toFixed(2)
    }, apiKey, apiSecret);
  }

  return {
    entryPrice,
    quantity,
    stopPrice,
    takeProfitPrice
  };
}

export async function flattenAll(network, symbol, apiKey, apiSecret, baseBalance) {
  if (network === "live") throw new Error("Live execution is currently locked for safety.");
  
  await api.cancelAllOrders(network, symbol, apiKey, apiSecret);
  
  if (baseBalance > 0.00001) {
    const exchangeInfo = await api.getExchangeInfo(network, symbol);
    const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === symbol);
    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === "LOT_SIZE");
    const stepSize = parseFloat(lotSizeFilter.stepSize);
    
    const adjustedQty = adjustToStepSize(baseBalance, stepSize);
    
    if (adjustedQty > 0) {
      await api.createOrder(network, {
        symbol,
        side: "SELL",
        type: "MARKET",
        quantity: adjustedQty.toFixed(stepSize.toString().split('.')[1]?.length || 0)
      }, apiKey, apiSecret);
    }
  }
}

export async function cancelAll(network, symbol, apiKey, apiSecret) {
  return api.cancelAllOrders(network, symbol, apiKey, apiSecret);
}
