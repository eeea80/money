"""
Alpaca Trading Module

Supports US stocks, ETFs, and crypto trading via Alpaca Markets REST API.

Configuration:
- Paper: https://paper-api.alpaca.markets (API keys start with "PK")
- Live:  https://api.alpaca.markets        (API keys start with "AK")

Data API endpoint: https://data.alpaca.markets

Unlike IBKR, Alpaca uses stateless REST authentication via API key + secret —
no persistent connection required, no TWS/Gateway process.
"""

from app.services.alpaca_trading.client import AlpacaClient, AlpacaConfig
from app.services.alpaca_trading.symbols import normalize_symbol, parse_symbol

__all__ = ['AlpacaClient', 'AlpacaConfig', 'normalize_symbol', 'parse_symbol']
