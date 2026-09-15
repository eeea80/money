(() => {
  const TRADINGVIEW_HOST = "www.tradingview.com";
  const CHART_PATH_PATTERN = /^\/chart\/[A-Za-z0-9_-]+\/$/;
  const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._:/!-]{0,63}$/;
  const TIMEFRAME_PATTERN = /^([1-9]\d{0,3})(m|h|D|W|M)$/;

  function normalizeSymbol(value) {
    const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
  }

  function normalizeTimeframe(value) {
    if (typeof value !== "string") return null;
    const timeframe = value.trim();
    return TIMEFRAME_PATTERN.test(timeframe) ? timeframe : null;
  }

  function toTradingViewInterval(value) {
    const timeframe = normalizeTimeframe(value);
    if (!timeframe) return null;
    const match = timeframe.match(TIMEFRAME_PATTERN);
    const amount = Number(match[1]);
    const unit = match[2];
    if (unit === "m") return String(amount);
    if (unit === "h") return String(amount * 60);
    return `${amount}${unit}`;
  }

  function buildUrl(currentUrl, symbolValue, timeframeValue) {
    let url;
    try {
      url = new URL(currentUrl);
    } catch (_error) {
      throw new Error("The current TradingView chart URL is invalid.");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== TRADINGVIEW_HOST ||
      !CHART_PATH_PATTERN.test(url.pathname)
    ) {
      throw new Error("Open a standard TradingView chart before navigating.");
    }

    const symbol = normalizeSymbol(symbolValue);
    const interval = toTradingViewInterval(timeframeValue);
    if (!symbol || !interval) {
      throw new Error("The saved symbol or timeframe is invalid.");
    }

    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", interval);
    return url.toString();
  }

  function handleOpenRequest(payload, sendResult) {
    try {
      const nextUrl = buildUrl(
        window.location.href,
        payload?.symbol,
        payload?.timeframe,
      );
      sendResult({ type: "watchlistChartOpenResult", success: true });
      window.location.assign(nextUrl);
      return true;
    } catch (error) {
      sendResult({
        type: "watchlistChartOpenResult",
        success: false,
        error: error.message,
      });
      return false;
    }
  }

  window.ChartMentorTradingViewNavigation = Object.freeze({
    buildUrl,
    normalizeSymbol,
    normalizeTimeframe,
    toTradingViewInterval,
    handleOpenRequest,
  });
})();
