"""Stock index data fetcher."""
from __future__ import annotations

import math
from typing import Any, Dict, List

from app.utils.logger import get_logger

logger = get_logger(__name__)

INDICES = [
    {"symbol": "^GSPC", "name_cn": "标普500", "name_en": "S&P 500", "region": "US", "flag": "\U0001f1fa\U0001f1f8", "lat": 40.7, "lng": -74.0},
    {"symbol": "^DJI", "name_cn": "道琼斯", "name_en": "Dow Jones", "region": "US", "flag": "\U0001f1fa\U0001f1f8", "lat": 38.5, "lng": -77.0},
    {"symbol": "^IXIC", "name_cn": "纳斯达克", "name_en": "NASDAQ", "region": "US", "flag": "\U0001f1fa\U0001f1f8", "lat": 37.5, "lng": -122.4},
    {"symbol": "^GDAXI", "name_cn": "德国DAX", "name_en": "DAX", "region": "EU", "flag": "\U0001f1e9\U0001f1ea", "lat": 50.1109, "lng": 8.6821},
    {"symbol": "^FTSE", "name_cn": "英国富时100", "name_en": "FTSE 100", "region": "EU", "flag": "\U0001f1ec\U0001f1e7", "lat": 51.5074, "lng": -0.1278},
    {"symbol": "^FCHI", "name_cn": "法国CAC40", "name_en": "CAC 40", "region": "EU", "flag": "\U0001f1eb\U0001f1f7", "lat": 48.8566, "lng": 2.3522},
    {"symbol": "^N225", "name_cn": "日经225", "name_en": "Nikkei 225", "region": "JP", "flag": "\U0001f1ef\U0001f1f5", "lat": 35.6762, "lng": 139.6503},
    {"symbol": "^KS11", "name_cn": "韩国KOSPI", "name_en": "KOSPI", "region": "KR", "flag": "\U0001f1f0\U0001f1f7", "lat": 37.5665, "lng": 126.9780},
    {"symbol": "^AXJO", "name_cn": "澳洲ASX200", "name_en": "ASX 200", "region": "AU", "flag": "\U0001f1e6\U0001f1fa", "lat": -33.8688, "lng": 151.2093},
    {"symbol": "^BSESN", "name_cn": "印度SENSEX", "name_en": "SENSEX", "region": "IN", "flag": "\U0001f1ee\U0001f1f3", "lat": 19.0760, "lng": 72.8777},
]


def _safe_round(v, n=2):
    f = float(v)
    return 0 if math.isnan(f) or math.isinf(f) else round(f, n)


def fetch_stock_indices() -> List[Dict[str, Any]]:
    """Fetch major stock indices using yfinance."""
    try:
        import yfinance as yf

        symbols = [idx["symbol"] for idx in INDICES]
        tickers = yf.Tickers(" ".join(symbols))

        result = []
        for idx in INDICES:
            try:
                ticker = tickers.tickers.get(idx["symbol"])
                if ticker:
                    hist = ticker.history(period="5d")
                    closes = hist["Close"].dropna() if len(hist) > 0 else []

                    if len(closes) >= 2:
                        current = float(closes.iloc[-1])
                        prev_close = float(closes.iloc[-2])
                        change = ((current - prev_close) / prev_close) * 100 if prev_close else 0
                    elif len(closes) == 1:
                        current = float(closes.iloc[-1])
                        change = 0
                    else:
                        current = 0
                        change = 0

                    result.append({
                        "symbol": idx["symbol"],
                        "name_cn": idx["name_cn"],
                        "name_en": idx["name_en"],
                        "price": _safe_round(current),
                        "change": _safe_round(change),
                        "region": idx["region"],
                        "flag": idx["flag"],
                        "lat": idx["lat"],
                        "lng": idx["lng"],
                        "category": "index",
                    })
            except Exception as e:
                logger.debug("Failed to fetch %s: %s", idx["symbol"], e)
                result.append({
                    "symbol": idx["symbol"],
                    "name_cn": idx["name_cn"],
                    "name_en": idx["name_en"],
                    "price": 0,
                    "change": 0,
                    "region": idx["region"],
                    "flag": idx["flag"],
                    "lat": idx["lat"],
                    "lng": idx["lng"],
                    "category": "index",
                })

        return result
    except Exception as e:
        logger.error("Failed to fetch stock indices: %s", e)
        return []
