// signalEngine.js — Regime-Adaptive Hybrid Strategy v3
// Runs in the content-script isolated world BEFORE content.js.
// Exposes globalThis.AvalisaSignalEngine.evaluateSignal(indicators, intensity).
// No network calls. No LLM tokens. Deterministic.
//
// v3 (2.4.9, Board-approved 2026-08-17) — intensity now means ONE thing:
// how many of the four rules must agree before Avalisa trades.
//
//   Low  = 2 of 4   Mid = 3 of 4   High = 4 of 4
//
// Everything else (RSI bands, Bollinger width, pullback zone, regime and
// volatility thresholds) is now IDENTICAL at every intensity. Previously each
// level moved the bands as well, so "high" was stricter in several hidden ways
// at once and the per-rule verdicts were not comparable between levels — which
// made it impossible to show the user a straight "3 of 4 met" readout.
//
// High no longer skips OTC. It used to set skipOTC:true, and since most of
// Pocket Option's always-on catalogue is OTC, High sat there refusing to trade
// anything even when its signals were good.

(function () {
  // Shared band configuration — deliberately NOT per-intensity. See header.
  const BANDS = {
    regimeSlopeThreshold: 0.3,   // |slope/stdev| above this = trending
    volLowThreshold: 0.0005,     // stdev/price below this = quiet, use a longer expiry
    volHighThreshold: 0.0025,    // above this = chaos, skip entirely
    rsiLow: 30,
    rsiHigh: 70,
    bbK: 2.0,                    // Bollinger width for mean-revert breaks
    pullbackRsiLow: 40,
    pullbackRsiHigh: 60,
    pullbackBbK: 0.6,            // price within ±0.6σ of SMA20 = pullback zone
  };

  // The one dial that intensity actually turns.
  const RULES_REQUIRED = { low: 2, mid: 3, high: 4 };
  const TOTAL_RULES = 4;

  function rulesRequiredFor(intensity) {
    return RULES_REQUIRED[intensity] || RULES_REQUIRED.mid;
  }

  function round4(x) {
    if (x == null || !Number.isFinite(x)) return null;
    return Math.round(x * 10000) / 10000;
  }

  function isOtcPair(pair) {
    if (!pair) return false;
    return /_otc|\botc\b/i.test(String(pair));
  }

  // Returns 'S30' | 'M1' | 'M3' | 'M5' | null (null = SKIP for vol).
  // Intensity still maps to how much expiry breathing room Avalisa wants — this
  // is about trade duration, not about how strict the entry is.
  function pickTimeframe(volRatio, intensity) {
    if (!Number.isFinite(volRatio)) {
      if (intensity === 'high') return 'M3';
      if (intensity === 'mid') return 'M1';
      return 'S30';
    }
    if (volRatio > BANDS.volHighThreshold) return null; // chaos → SKIP
    if (intensity === 'high') return volRatio < BANDS.volLowThreshold ? 'M5' : 'M3';
    if (intensity === 'mid') return volRatio < BANDS.volLowThreshold ? 'M3' : 'M1';
    return volRatio < BANDS.volLowThreshold ? 'M1' : 'S30';
  }

  function classifyRegime(slopeScore) {
    if (!Number.isFinite(slopeScore)) return 'unknown';
    return Math.abs(slopeScore) >= BANDS.regimeSlopeThreshold ? 'trending' : 'ranging';
  }

  // Build the four rules for one direction. Each carries a stable id and a short
  // human label so the panel can render exactly what did and did not line up.
  function buildRules(regime, side, ctx) {
    const { rsi, sma20, price, momentum, slope10, lastCandle,
            upperBB, lowerBB, pullbackUpper, pullbackLower } = ctx;
    const up = side === 'call';

    if (regime === 'trending') {
      return [
        {
          id: 'trend',
          label: up ? 'Uptrend' : 'Downtrend',
          met: Number.isFinite(slope10) && (up ? slope10 > 0 : slope10 < 0),
        },
        {
          id: 'pullback',
          label: 'Pullback to mean',
          met: up
            ? (price >= pullbackLower && price <= sma20)
            : (price <= pullbackUpper && price >= sma20),
        },
        {
          id: 'rsi_zone',
          label: 'RSI in entry zone',
          met: rsi >= BANDS.pullbackRsiLow && rsi <= BANDS.pullbackRsiHigh,
        },
        {
          id: 'confirm',
          label: up ? 'Green candle' : 'Red candle',
          met: lastCandle === (up ? 'green' : 'red'),
        },
      ];
    }

    // Ranging → mean reversion
    return [
      {
        id: 'rsi_extreme',
        label: up ? `RSI oversold (<${BANDS.rsiLow})` : `RSI overbought (>${BANDS.rsiHigh})`,
        met: up ? rsi < BANDS.rsiLow : rsi > BANDS.rsiHigh,
      },
      {
        id: 'bb_break',
        label: up ? 'Below lower band' : 'Above upper band',
        met: up ? price < lowerBB : price > upperBB,
      },
      {
        id: 'momentum',
        label: up ? 'Momentum turning up' : 'Momentum turning down',
        met: Number.isFinite(momentum) && (up ? momentum > 0 : momentum < 0),
      },
      {
        id: 'confirm',
        label: up ? 'Green candle' : 'Red candle',
        met: lastCandle === (up ? 'green' : 'red'),
      },
    ];
  }

  const countMet = rules => rules.reduce((n, r) => n + (r.met ? 1 : 0), 0);

  function evaluateSignal(indicators, intensity) {
    const i = indicators || {};
    const intensityName = RULES_REQUIRED[intensity] ? intensity : 'mid';
    const required = rulesRequiredFor(intensityName);

    const rsi = i.rsi14;
    const sma20 = i.sma20;
    const stdev20 = i.volatility;
    const price = i.price;
    const momentum = i.momentum5;
    const slope10 = i.slope10;          // SMA20 slope over last 10 candles
    const lastCandle = i.lastCandle;    // 'green' | 'red' | null
    const pair = i.pair;

    const volRatio = (Number.isFinite(stdev20) && Number.isFinite(price) && price > 0)
      ? stdev20 / price : null;
    const slopeScore = (Number.isFinite(slope10) && Number.isFinite(stdev20) && stdev20 > 0)
      ? slope10 / stdev20 : null;

    const regime = classifyRegime(slopeScore);
    const tfPick = pickTimeframe(volRatio, intensityName);

    const baseSnapshot = {
      rsi: round4(rsi),
      sma20: round4(sma20),
      stdev20: round4(stdev20),
      price: round4(price),
      momentum: round4(momentum),
      slope10: round4(slope10),
      slopeScore: round4(slopeScore),
      volRatio: round4(volRatio),
      regime,
      lastCandle: lastCandle || null,
      bbPos: null,
      isOTC: isOtcPair(pair),
      intensity: intensityName,
      required,
      totalRules: TOTAL_RULES,
      rulesMatched: 0,
      rules: [],
      side: null,
      confidence: 0,
      action: 'SKIP',
      timeframe: tfPick || 'M1',
    };

    if (!Number.isFinite(rsi) || !Number.isFinite(sma20) ||
        !Number.isFinite(stdev20) || !Number.isFinite(price)) {
      return { action: 'SKIP', snapshot: baseSnapshot, reason: 'missing_indicators' };
    }

    // Volatility chaos filter — the one hard veto left.
    if (tfPick === null) {
      return { action: 'SKIP', snapshot: baseSnapshot, reason: 'vol_too_high' };
    }

    // regime 'unknown' (no slope yet) falls through as ranging — safer default.
    const effectiveRegime = regime === 'trending' ? 'trending' : 'ranging';

    const ctx = {
      rsi, sma20, price, momentum, slope10, lastCandle,
      upperBB: sma20 + BANDS.bbK * stdev20,
      lowerBB: sma20 - BANDS.bbK * stdev20,
      pullbackUpper: sma20 + BANDS.pullbackBbK * stdev20,
      pullbackLower: sma20 - BANDS.pullbackBbK * stdev20,
    };

    const callRules = buildRules(effectiveRegime, 'call', ctx);
    const putRules = buildRules(effectiveRegime, 'put', ctx);
    const callCount = countMet(callRules);
    const putCount = countMet(putRules);

    // Show the user the side that is actually closest to firing.
    const leadingSide = callCount >= putCount ? 'call' : 'put';
    const leadingRules = leadingSide === 'call' ? callRules : putRules;
    const leadingCount = Math.max(callCount, putCount);

    let action = 'SKIP';
    let reason;
    let side = leadingSide;
    let rulesMatched = leadingCount;
    let rules = leadingRules;

    if (callCount >= required && putCount >= required && callCount === putCount) {
      reason = 'conflicting_signals';
    } else if (callCount >= required && callCount > putCount) {
      action = 'CALL';
      side = 'call';
      rulesMatched = callCount;
      rules = callRules;
    } else if (putCount >= required && putCount > callCount) {
      action = 'PUT';
      side = 'put';
      rulesMatched = putCount;
      rules = putRules;
    } else {
      reason = 'not_enough_rules';
    }

    // Confidence is now a real measure: how much of the evidence lined up.
    // It used to be (matched/required) * minConfidence, which could never fall
    // below minConfidence at the point it was tested — so the 'low_confidence'
    // branch it guarded was unreachable dead code.
    const confidence = Math.round((rulesMatched / TOTAL_RULES) * 100);

    const snapshot = {
      ...baseSnapshot,
      bbPos: round4(stdev20 > 0 ? (price - sma20) / stdev20 : 0),
      strategy: effectiveRegime === 'trending' ? 'trend-follow' : 'mean-revert',
      rulesMatched,
      rules,
      side,
      callCount,
      putCount,
      confidence,
      action,
      timeframe: tfPick,
    };

    return reason ? { action, snapshot, reason, timeframe: tfPick }
                  : { action, snapshot, timeframe: tfPick };
  }

  globalThis.AvalisaSignalEngine = {
    evaluateSignal,
    RULES_REQUIRED,
    TOTAL_RULES,
    BANDS,
  };
})();
