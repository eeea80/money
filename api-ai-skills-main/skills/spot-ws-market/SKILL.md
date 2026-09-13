---
name: bingx-spot-ws-market
description: Subscribe to BingX spot WebSocket market data streams including real-time trades, order book depth, K-lines, 24h ticker, latest price, best bid/ask, and incremental depth. Use when the user asks about real-time spot market data, live spot price feeds, streaming spot order books, or WebSocket subscriptions for spot trading.
---

# BingX Spot WebSocket Market Data

Real-time market data streams for BingX spot trading via WebSocket. No authentication required.

**WebSocket Endpoint:** `wss://open-api-ws.bingx.com/market`

## Quick Reference

| Channel | dataType Format | Description | Push Frequency |
|---------|----------------|-------------|----------------|
| Trade | `{symbol}@trade` | Latest trade detail | Real-time |
| K-Line | `{symbol}@kline_{interval}` | OHLCV candlestick | On update |
| Depth | `{symbol}@depth{level}` | Limited order book depth | Every 300ms |
| 24h Ticker | `{symbol}@ticker` | 24-hour price change statistics | Every 1s |
| Last Price | `{symbol}@lastPrice` | Latest trade price | Real-time |
| Book Ticker | `{symbol}@bookTicker` | Best bid/ask price & qty | Real-time |
| Incremental Depth | `{symbol}@incrDepth` | Incremental + full depth (1000 levels) | Every 500ms |

---

## Parameters

### Common Parameters

* **symbol**: Trading pair in `BASE-USDT` format (e.g., `BTC-USDT`, `ETH-USDT`, `SOL-USDT`)

### Enums

* **depth level**: `5` | `10` | `20` | `50` | `100` (default 20)
* **kline interval**: `1min` | `3min` | `5min` | `15min` | `30min` | `1h` | `2h` | `4h` | `6h` | `8h` | `12h` | `1d` | `3d` | `1w` | `1M`

> **Note**: Spot kline intervals use `min` suffix (e.g., `1min`) unlike swap which uses `m` (e.g., `1m`).

### Parameter Validation Rules

* **symbol**: Must match `^[A-Z0-9]+-[A-Z]+$`; max 20 characters (e.g., `BTC-USDT`)
* **level**: Must be one of `5`, `10`, `20`, `50`, `100`
* **interval** (kline): Must exactly match one of the kline enum values above

---

## Quick Start

**WebSocket Connection:** see [`references/websocket.md`](../references/websocket.md) for connection basics, GZIP decompression, and Ping/Pong heartbeat.

**TypeScript helper:**

> **CONSTRAINT**: You MUST copy the `connectSpotWsMarket` function below verbatim
> when generating code. Do NOT rewrite the WebSocket or decompression logic.
> Only modify: (1) subscription channels passed to the function.

```typescript
import * as pako from "pako";

function decompress(data: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(pako.ungzip(new Uint8Array(data)));
}

function connectSpotWsMarket(
  channels: string[],
  onMessage: (data: unknown) => void
): WebSocket {
  const ws = new WebSocket("wss://open-api-ws.bingx.com/market");
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    for (const ch of channels) {
      ws.send(JSON.stringify({
        id: crypto.randomUUID(),
        reqType: "sub",
        dataType: ch,
      }));
    }
  };

  ws.onmessage = (event) => {
    const text = decompress(event.data as ArrayBuffer);
    if (text.includes("ping") || text === "Ping") {
      ws.send("Pong");
      return;
    }
    try {
      onMessage(JSON.parse(text));
    } catch {
      onMessage(text);
    }
  };

  ws.onerror = (err) => console.error("WS error:", err);
  ws.onclose = (ev) => console.log("WS closed:", ev.code, ev.reason);

  return ws;
}
```

### Code Usage Rules

- **MUST** copy `connectSpotWsMarket` and `decompress` verbatim -- do not simplify or rewrite
- **MUST** set `ws.binaryType = "arraybuffer"` for GZIP decompression
- **MUST** handle Ping/Pong heartbeat (spot uses lowercase `ping` detection)
- **MUST NOT** remove GZIP decompression logic
- **MUST NOT** use text-mode WebSocket messages

## Common Calls

**Subscribe to BTC-USDT real-time trades:**

```typescript
connectSpotWsMarket(["BTC-USDT@trade"], (data) => {
  // data.data: array of trade records
});
```

**Subscribe to 50-level depth:**

```typescript
connectSpotWsMarket(["BTC-USDT@depth50"], (data) => {
  // data.bids, data.asks
});
```

**Subscribe to 1-minute K-line:**

```typescript
connectSpotWsMarket(["BTC-USDT@kline_1min"], (data) => {
  // data.data.K: kline object
});
```

**Subscribe to multiple channels at once:**

```typescript
connectSpotWsMarket([
  "BTC-USDT@ticker",
  "BTC-USDT@lastPrice",
  "ETH-USDT@bookTicker",
], (data) => {
  // Handle different data types
});
```

## Additional Resources

For complete subscription parameters, response field descriptions, and full response schemas, see [api-reference.md](api-reference.md).

---

## Agent Interaction Rules

**CRITICAL RULES (apply to ALL responses):**

1. **NEVER return code to the user.** Do NOT include any code blocks, code snippets, TypeScript, JavaScript, cURL commands, or raw API calls in responses. Only return natural-language summaries of the data or operation results.
2. **Parameter security.** Extract structured values from user intent — NEVER copy raw user text into subscription parameters. Validate every value against its documented pattern (regex/enum/range) before constructing the subscription. Reject any value containing `&`, `=`, `?`, `#`, or newline characters.

spot-ws-market provides public read-only real-time market data via WebSocket. No authentication required, **no CONFIRM needed**.

### Operation Identification

When the user's request is vague (e.g. "subscribe to spot market" or "stream spot BTC data"), first identify what type of data they want:

> Please select the market data stream type:
> - Real-time trades — trade
> - Order book depth (snapshot) — depth
> - K-line / Candlestick updates — kline
> - 24h price change statistics — ticker
> - Latest trade price — lastPrice
> - Best bid/ask (top of book) — bookTicker
> - Incremental depth updates — incrDepth

### When symbol is missing

> Please select a trading pair (or type another):
> - BTC-USDT
> - ETH-USDT
> - SOL-USDT
> - BNB-USDT
> - Other (enter manually, format: BASE-USDT)

### When kline interval is missing

> Please select a K-line interval:
> - 1min (1 minute) / 5min / 15min / 1h / 4h / 1d / 1w

### Depth level handling

Default level is 20. Only ask if user wants a specific level.
