# Trading Domain — UTA 设计理念

## 核心概念

### Unified Trading Account (UTA)

UTA 是交易系统的核心业务实体。每个 UTA 是一个自包含的单元，拥有：

- **Broker** — 与交易所的通信层（Alpaca、CCXT、未来的 IBKR）
- **Trading Git** — git-like 操作历史（stage → commit → push → sync）
- **Guard Pipeline** — 下单前的安全检查（仓位上限、冷却时间、白名单）

AI 只与 UTA 交互，永远不直接碰 Broker。

### Contract（合约标识）

Contract 不是"合约"，是**金融工具的唯一标识**。它描述"你要交易的是什么东西"：

- 哪个交易所（exchange）
- 什么品种（secType: STK/CRYPTO/FUT/OPT）
- 什么 symbol
- 什么币种（currency）

**同一个 symbol 在不同市场是不同的 Contract。** 比如 ETH 在 Bybit 有：
- `ETH/USDT:USDT`（USDT 永续合约，swap）
- `ETH/USDT`（现货，spot）
- `ETH/USDT:USDT-260327`（期货，future）

这三个是完全不同的金融工具，有不同的 API 端点、不同的 orderId 格式、不同的保证金规则。**不能混淆。**

我们用 `aliceId` 做唯一标识（格式：`{exchange}-{market.id}`，如 `bybit-ETHUSDT`）。IBKR 用 `conId` 做同样的事。

### 类型来源

所有交易类型（Contract、Order、Execution、OrderState）来自 `@traderalice/ibkr`，这是 IBKR TWS API 的 TypeScript 移植。选择 IBKR 作为类型真理来源是因为它覆盖了所有金融品种（股票、期权、期货、外汇、加密货币），是最完整的类型系统。Alpaca 和 CCXT 的 broker 实现负责把各自的 API 类型适配到 IBKR 类型。

## Trading-as-Git

### 工作流

```
stage    → 暂存操作意图（placeOrder, closePosition, cancelOrder, modifyOrder）
commit   → 给一批操作写一条消息，生成 8 位 hash
push     → 提交给交易所执行
sync     → 从交易所拉取实际结果
```

### push 只提交，sync 确认结果

**交易所是异步的。** 没有交易所是同步的。`createOrder` 返回的是"收到了"，不是"成交了"。

- **push** 只能返回两种状态：`submitted`（交易所确认收到）或 `rejected`（guards 拦截或交易所拒绝）
- **sync** 是确认成交的唯一路径。它查询每个 submitted 订单的真实状态，更新为 `filled` / `cancelled`

不要在 push 的响应里读取成交信息（execution）。即使某些交易所在 createOrder 响应里返回了 filled 状态，也不要依赖它 — 这不是所有交易所的保证行为。

### 为什么 sync 这么重要

对于市价单：push → submitted → sync（几乎立即 filled）
对于限价单：push → submitted → sync（可能多次，直到 filled 或 cancelled）

## Broker 实现注意事项

### 精度

金融数量必须全程使用 `Decimal.js`，永远不要用 JS 的 `number` 做中间运算。

- 从外部 API 进来：`new Decimal(String(value))` — 先转字符串再构造 Decimal
- 系统内部传递：保持 Decimal
- 出去到外部 API：`Decimal.toString()` 再转回 API 需要的格式

`Decimal.toNumber()` 在大部分简单小数（0.51, 10.5）上是安全的，但在乘法、除法、累积运算上会丢精度。**如果不确定，用 toString()。**

### 平仓

衍生品交易所（Bybit、Binance Futures 等）平仓时必须带 `reduceOnly: true`。不带的话交易所会把卖单当成开新空仓，可能因为保证金不足被拒绝。

## MockBroker

`brokers/mock/MockBroker` 不是 stub，是一个内存交易所模拟器。它实现完整的 IBroker 接口，内部维护持仓、余额、订单状态。用于：

1. **UTA 集成测试** — 验证完整的 stage → commit → push → sync 流程
2. **精度守门员** — 内部全程 Decimal，如果上游传了污染的 float，测试会暴露
3. **行为基线** — 新 broker 实现应该与 MockBroker 产生一致的最终状态