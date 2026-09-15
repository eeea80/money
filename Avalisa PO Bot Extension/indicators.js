/**
 * Avalisa PO Bot v2 - Indicator helpers
 * Pure calculation helpers used by Avalisa Bot.
 */

function calcSMA(vals, period) {
  if (vals.length < period) return null;
  const slice = vals.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return +(100 - 100 / (1 + rs)).toFixed(1);
}

function calcStdev(vals) {
  if (vals.length < 2) return null;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return Math.sqrt(variance);
}

function buildIndicators(candlesOverride = null, pairOverride = null, tfOverride = null) {
  const candles = candlesOverride || getBufferedCandles();
  if (candles.length < getRequiredCandles()) return null;
  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const price = closes[closes.length - 1];
  const sma10 = calcSMA(closes, 10);
  const indicatorWindow = Math.min(20, closes.length);
  const sma20 = calcSMA(closes, indicatorWindow);
  const rsiPeriod = Math.min(14, closes.length - 1);
  const rsi14 = calcRSI(closes, rsiPeriod);
  const recentHigh = Math.max(...highs.slice(-indicatorWindow));
  const recentLow = Math.min(...lows.slice(-indicatorWindow));
  const vol = calcStdev(closes.slice(-indicatorWindow));
  const momentum5 = closes.length >= 6
    ? +(((price - closes[closes.length - 6]) / closes[closes.length - 6]) * 100).toFixed(3)
    : null;
  const last3 = candles.slice(-3).map(c => c.close > c.open ? 'bull' : 'bear');

  let slope10 = null;
  if (candles.length >= 30) {
    const smaNow = sma20;
    const past = candles.slice(candles.length - 30, candles.length - 10);
    if (past.length === 20) {
      const smaPast = past.reduce((s, c) => s + c.close, 0) / 20;
      slope10 = (smaNow - smaPast) / 10;
    }
  }

  let lastCandle = null;
  if (candles.length >= 1) {
    const last = candles[candles.length - 1];
    if (last && Number.isFinite(last.open) && Number.isFinite(last.close)) {
      lastCandle = last.close > last.open ? 'green' : last.close < last.open ? 'red' : 'doji';
    }
  }

  return {
    pair: pairOverride || state.activePair || getCurrentPair(),
    tf: tfOverride || (state.activePeriod ? `${state.activePeriod}s` : (state.settings?.timeframe || 'M1')),
    price: +price.toFixed(5),
    rsi14,
    sma10: sma10 ? +sma10.toFixed(5) : null,
    sma20: sma20 ? +sma20.toFixed(5) : null,
    priceVsSma20Pct: sma20 ? +(((price - sma20) / sma20) * 100).toFixed(3) : null,
    recentHigh: +recentHigh.toFixed(5),
    recentLow: +recentLow.toFixed(5),
    rangeFromLowPct: +(((price - recentLow) / (recentHigh - recentLow || 1)) * 100).toFixed(1),
    volatility: Number.isFinite(vol) ? +vol.toFixed(6) : null,
    momentum5,
    last3Candles: last3,
    candleCount: candles.length,
    indicatorWindow,
    rsiPeriod,
    slope10,
    lastCandle,
  };
}
