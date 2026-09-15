const MENTOR_CARD_TYPES = new Set(["fundamental", "price", "event", "plan"]);

function boundedCardText(value, maxLength = 180) {
  return normalizePanelText(value).slice(0, maxLength);
}

function normalizeMentorCards(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 5)
    .map((card) => {
      const type = boundedCardText(card?.type, 24).toLowerCase();
      if (!MENTOR_CARD_TYPES.has(type) || !card?.data || typeof card.data !== "object") {
        return null;
      }
      const data = card.data;
      if (type === "fundamental") {
        const sources = Array.isArray(data.sources)
          ? data.sources
              .slice(0, 6)
              .map((source) => ({
                title: boundedCardText(source?.title, 100),
                url: boundedCardText(source?.url, 500),
              }))
              .filter((source) => source.title && isSafeMentorSourceUrl(source.url))
          : [];
        return {
          type,
          data: {
            bias: ["bullish", "bearish", "mixed", "neutral"].includes(data.bias)
              ? data.bias
              : "neutral",
            confidence: Math.max(0, Math.min(100, Number(data.confidence) || 0)),
            drivers: Array.isArray(data.drivers)
              ? data.drivers.map((item) => boundedCardText(item, 180)).filter(Boolean).slice(0, 4)
              : [],
            counterRisk: boundedCardText(data.counterRisk, 220),
            nextCatalyst: data.nextCatalyst && typeof data.nextCatalyst === "object"
              ? {
                  title: boundedCardText(data.nextCatalyst.title, 140),
                  scheduledAt: boundedCardText(data.nextCatalyst.scheduledAt, 60),
                }
              : null,
            asOf: boundedCardText(data.asOf, 60),
            sources,
          },
        };
      }
      if (type === "price") {
        const points = Array.isArray(data.points)
          ? data.points
              .slice(-60)
              .map((point) => ({ time: boundedCardText(point?.time, 40), value: Number(point?.value) }))
              .filter((point) => point.time && Number.isFinite(point.value))
          : [];
        return {
          type,
          data: {
            symbol: boundedCardText(data.symbol, 40),
            timeframe: boundedCardText(data.timeframe, 20),
            price: boundedCardText(data.price, 40),
            changePercent: boundedCardText(data.changePercent, 40),
            asOf: boundedCardText(data.asOf, 60),
            provider: boundedCardText(data.provider, 60),
            points,
          },
        };
      }
      if (type === "event") {
        return {
          type,
          data: {
            currency: boundedCardText(data.currency, 12),
            name: boundedCardText(data.name, 140),
            impact: boundedCardText(data.impact, 20).toLowerCase(),
            announcement_datetime: Number(data.announcement_datetime) || 0,
            actual: boundedCardText(data.actual, 40),
            forecast: boundedCardText(data.forecast, 40),
            previous: boundedCardText(data.previous, 40),
          },
        };
      }
      return {
        type,
        data: {
          direction: boundedCardText(data.direction, 12).toUpperCase(),
          entry: boundedCardText(data.entry, 40),
          stop: boundedCardText(data.stop, 40),
          target: boundedCardText(data.target, 40),
          source: boundedCardText(data.source, 40),
        },
      };
    })
    .filter(Boolean);
}

function isSafeMentorSourceUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
