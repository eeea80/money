# Omni-Trader — Phase 1 Core Engine | هسته فاز ۱ امن‌تریدر

Bilingual (EN/FA) crypto trading workstation — **paper trading only**. This repository
contains the Phase 1 core engine: market data, indicators, strategies, a paper-trading
simulator, a strict risk manager, a persistent SQLite journal, and a FastAPI shell with
a bilingual status page.

ایستگاه معاملات ارز دیجیتال (فارسی/انگلیسی) — **فقط معاملات کاغذی**. این مخزن شامل
هسته فاز ۱ است: داده بازار، اندیکاتورها، استراتژی‌ها، شبیه‌ساز معاملات کاغذی،
مدیر ریسک سخت‌گیرانه، ژورنال پایدار SQLite و پوسته FastAPI با صفحه وضعیت دوزبانه.

> ⚠️ **No real orders. No API keys. No credentials.**
> There is no code path in this repository that can place a real order anywhere.
> Real trading (a later phase) will be locked behind an explicit in-app owner confirmation.
>
> ⚠️ **هیچ سفارش واقعی، هیچ کلید API، هیچ اعتبارنامه‌ای.**
> در این مخزن هیچ مسیر کدی وجود ندارد که بتواند سفارش واقعی ثبت کند.
> معاملات واقعی (فاز بعدی) پشت تأیید صریح مالک در خود برنامه قفل خواهد شد.

---

## English

### Quickstart

Requires Python 3.11+ (developed and tested on 3.12).

```bash
cd omni-trader
pip install -r requirements.txt        # on Debian/Ubuntu add --break-system-packages

# 1) Run the test suite (47 tests)
python -m pytest tests/ -q

# 2) Smoke run: ~3 minutes of live paper trading on BTC/USDT 1m
python scripts/run_smoke.py --minutes 3
#    logs -> logs/smoke_run.log ; journal -> data/journal.sqlite3

# 3) Start the API + bilingual status page
uvicorn omni_trader.api:get_app --host 0.0.0.0 --port 8000
#    open http://localhost:8000/            (EN)
#    open http://localhost:8000/?lang=fa    (FA, RTL)
```

### Configuration

All configuration lives in `config.example.json` (copy to `config.json` to use).
**Never put API keys in it — the engine needs none.** Runtime-tunable settings
(risk mode, execution latency, timeframe) can also be changed live via
`POST /settings`.

| Key | Default | Meaning |
|---|---|---|
| `symbol` | `BTC/USDT` | ccxt market symbol |
| `timeframe` | `1m` | one of `1m 5m 15m 1h 4h 1d` |
| `strategy` | `ema_cross_rsi` | registered strategy name |
| `risk_mode` | `balanced` | `conservative` / `balanced` / `aggressive` |
| `starting_equity` | `10000` | paper USDT |
| `execution_latency_ms` | `140` | signal→order-submission latency |
| `stop_loss_pct` | `0.01` | per-position stop distance (1%) |
| `fee_rate` | `0.001` | taker fee per side (0.1%) |
| `slippage_pct` | `0.0005` | adverse fill slippage (0.05%) |
| `db_path` | `data/journal.sqlite3` | SQLite journal location |

### Architecture

```
Binance public OHLCV (ccxt, no keys)          bundled sample CSV (offline fallback)
            │                                          │
            └────────────► market_data.py ◄────────────┘
                              │  DataFrame (UTC DatetimeIndex,
                              │  source = binance | sample)
                              ▼
                        strategies.py   (pluggable; EMA 12/26 cross + RSI 14 filter
                              │          + candlestick pattern notes)
                              ▼
              risk.py  ◄──── paper_engine.py ────► journal.py (SQLite/WAL)
        Conservative 0.5%      fills at NEXT candle open,         trades / signals /
        Balanced   1%          140 ms latency, fees+slippage,     decisions / outcomes /
        Aggressive 2%          intrabar stop-loss                 strategy_memory
            │                       │
            └── daily loss cap, drawdown size throttle (never increases)
                                    │
                                    ▼
                              api.py (FastAPI)
              /status /candles /signals /trades /settings + bilingual /
```

**Execution model (no look-ahead):** strategies see closed candles only; orders
are submitted at candle-close + `execution_latency_ms` and fill at the **next
candle's open** (with slippage and fees). Stop-losses are checked intrabar.

**Risk manager (hard rules):** fixed-fraction sizing (0.5%/1%/2% of equity by
mode), daily loss cap halts trading for the UTC day, and drawdown-based size
throttle that only ever **decreases**. No martingale, no loss-chasing, no size
increase after losses.

**Journal:** `trades`, `signals`, `decisions`, `outcomes`, and `strategy_memory`
(per-strategy wins/losses/total PnL — the seed of the self-learning loop).

### Market data note

`market_data.py` uses **Binance public endpoints only** (no authentication).
Some hosting environments are geoblocked by Binance (HTTP 451). In that case
`get_candles()` automatically falls back to the bundled sample dataset
(`data/sample_btcusdt_1m.csv`) and every response is tagged with its source
(`binance` or `sample`) so the UI stays honest. On the owner's machine the live
path works unchanged. To rebuild the sample: `python scripts/build_sample_data.py`
(tries live, falls back to a seeded synthetic series).

### REST API

| Endpoint | Purpose |
|---|---|
| `GET /status` | engine, equity, position, risk state, data source |
| `GET /candles?timeframe=1m&limit=100` | OHLCV (source-tagged) |
| `GET /signals?limit=20` | recent journal signals |
| `GET /trades?limit=20` | recent trades + strategy memory |
| `GET /settings` / `POST /settings` | risk mode, latency, timeframe, poll interval |
| `GET /?lang=fa` | bilingual status page (FA is RTL) |

---

## فارسی

### شروع سریع

پایتون ۳.۱۱ یا بالاتر لازم است (روی ۳.۱۲ تست شده).

```bash
cd omni-trader
pip install -r requirements.txt

# ۱) اجرای تست‌ها (۴۷ تست)
python -m pytest tests/ -q

# ۲) اجرای دود: حدود ۳ دقیقه معامله کاغذی زنده روی BTC/USDT تایم ۱ دقیقه
python scripts/run_smoke.py --minutes 3
#    لاگ -> logs/smoke_run.log ؛ ژورنال -> data/journal.sqlite3

# ۳) اجرای API و صفحه وضعیت دوزبانه
uvicorn omni_trader.api:get_app --host 0.0.0.0 --port 8000
#    آدرس http://localhost:8000/            (انگلیسی)
#    آدرس http://localhost:8000/?lang=fa    (فارسی، راست‌به‌چپ)
```

### پیکربندی

همه تنظیمات در `config.example.json` است (برای استفاده به `config.json` کپی کنید).
**هیچ کلید API در آن قرار ندهید — موتور به کلید نیازی ندارد.** حالت ریسک، تأخیر اجرا
و تایم‌فریم را در زمان اجرا هم می‌توان با `POST /settings` عوض کرد.

| کلید | پیش‌فرض | توضیح |
|---|---|---|
| `symbol` | `BTC/USDT` | نماد بازار |
| `timeframe` | `1m` | یکی از `1m 5m 15m 1h 4h 1d` |
| `strategy` | `ema_cross_rsi` | نام استراتژی ثبت‌شده |
| `risk_mode` | `balanced` | `conservative` / `balanced` / `aggressive` |
| `starting_equity` | `10000` | تتر کاغذی |
| `execution_latency_ms` | `140` | تأخیر سیگنال تا ثبت سفارش |
| `stop_loss_pct` | `0.01` | فاصله حد ضرر هر پوزیشن (۱٪) |
| `fee_rate` | `0.001` | کارمزد هر سمت (۰.۱٪) |
| `slippage_pct` | `0.0005` | لغزش قیمت (۰.۰۵٪) |
| `db_path` | `data/journal.sqlite3` | محل ژورنال SQLite |

### معماری

```
داده عمومی OHLCV بایننس (ccxt، بدون کلید)     نمونه CSV آفلاین
            │                                        │
            └──────────► market_data.py ◄────────────┘
                              ▼
                        strategies.py   (EMA کراس ۱۲/۲۶ + فیلتر RSI ۱۴ + الگوهای کندلی)
                              ▼
              risk.py  ◄──── paper_engine.py ────► journal.py (SQLite/WAL)
        محافظه‌کار ۰.۵٪       پرشدن سفارش در اوپن کندل بعد،      معاملات / سیگنال‌ها /
        متعادل     ۱٪        تأخیر ۱۴۰ میلی‌ثانیه،              تصمیم‌ها / نتایج /
        پرخطر     ۲٪        کارمزد+لغزش، حد ضرر                حافظه استراتژی
            │                        │
            └── سقف ضرر روزانه، کاهش خودکار حجم با افت سرمایه (فقط کاهشی)
                                     │
                                     ▼
                              api.py (FastAPI) + صفحه وضعیت دوزبانه
```

**مدل اجرا (بدون نگاه به آینده):** استراتژی فقط کندل‌های بسته‌شده را می‌بیند؛ سفارش
در زمان بسته‌شدن کندل + ۱۴۰ میلی‌ثانیه ثبت و در **اوپن کندل بعدی** (با لغزش و کارمزد)
پر می‌شود. حد ضرر داخل کندل هم چک می‌شود.

**قوانین سخت ریسک:** حجم بر اساس درصد ثابتی از سرمایه (۰.۵٪/۱٪/۲٪)، سقف ضرر روزانه
که معاملات همان روز (UTC) را متوقف می‌کند، و ضریب کاهش حجم بر اساس افت سرمایه که
**فقط کاهش** می‌یابد. هیچ مارتینگل، هیچ تعقیبِ ضرر، هیچ افزایش حجم پس از باخت.

**ژورنال:** جدول‌های `trades`، `signals`، `decisions`، `outcomes` و
`strategy_memory` (برد/باخت و سود کل هر استراتژی — بذر حلقه یادگیری خودکار).

### نکته داده بازار

`market_data.py` فقط از **اندپوینت‌های عمومی بایننس** استفاده می‌کند (بدون احراز هویت).
برخی محیط‌های هاستینگ توسط بایننس مسدود می‌شوند (HTTP 451). در این حالت
`get_candles()` خودکار به مجموعه داده نمونه (`data/sample_btcusdt_1m.csv`) برمی‌گردد
و منبع هر پاسخ (`binance` یا `sample`) ثبت می‌شود. روی سیستم مالک مسیر زنده بدون
تغییر کار می‌کند. برای بازسازی داده نمونه: `python scripts/build_sample_data.py`.

---

## Project layout | ساختار پروژه

```
omni-trader/
├── omni_trader/
│   ├── market_data.py      # Binance public OHLCV + retry/backoff + sample fallback
│   ├── indicators.py       # EMA, RSI, MACD, ATR, Bollinger, 5 candlestick patterns
│   ├── strategies.py       # pluggable interface + EmaCrossRsiStrategy
│   ├── paper_engine.py     # next-open fills, 140ms latency, fees, slippage, stops
│   ├── risk.py             # 3 modes, daily cap, drawdown throttle (no martingale)
│   ├── journal.py          # SQLite: trades/signals/decisions/outcomes/memory
│   ├── api.py              # FastAPI + bilingual status page
│   └── i18n.py             # FA/EN strings
├── scripts/
│   ├── build_sample_data.py
│   └── run_smoke.py
├── tests/                  # 47 pytest tests (indicators, risk, engine, API)
├── data/sample_btcusdt_1m.csv
├── config.example.json
├── requirements.txt
└── README.md
```

## Roadmap | نقشه راه

- **Phase 2:** full bilingual dashboard, charts, AI advisor hub (signal annotation only).
- **Phase 3:** news sentiment → market regime tag; paper-vs-real comparison needs
  (only after explicit owner confirmation gate).
- **فاز ۲:** داشبورد کامل دوزبانه، نمودارها، هاب مشاور هوش مصنوعی (فقط توضیح سیگنال).
- **فاز ۳:** احساسات اخبار → برچسب رژیم بازار؛ مقایسه کاغذی/واقعی فقط پس از تأیید صریح مالک.

## License

MIT — see [LICENSE](LICENSE). Developed honestly: paper trading only, public data only.
لایسنس MIT. فقط معاملات کاغذی، فقط داده عمومی.
