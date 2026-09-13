# Interactive Brokers（IBKR）交易指南

QuantDinger 可通过 Interactive Brokers TWS 或 IB Gateway 执行美股交易。上线前请先使用模拟账户完成连接、行情、下单和撤单验证。

## 前置条件

- 已开通 Interactive Brokers 账户；
- 已安装并登录 TWS 或 IB Gateway；
- 如需实时行情，账户已订阅对应市场数据；
- TWS/Gateway 已启用 Socket API。

## 端口与客户端设置

| 客户端 | 实盘默认端口 | 模拟盘默认端口 |
|---|---:|---:|
| TWS | `7496` | `7497` |
| IB Gateway | `4001` | `4002` |

在 TWS 或 IB Gateway 中进入 **Configure → API → Settings**，启用 Socket Client，并确认实际端口。端口可被用户修改，QuantDinger 配置必须与客户端显示值一致。

| QuantDinger 字段 | 说明 | 示例 |
|---|---|---|
| Broker | 选择 Interactive Brokers | — |
| Host | TWS/Gateway 地址 | `127.0.0.1` |
| Port | Socket API 端口 | `7497` |
| Client ID | 同一客户端实例内唯一 | `1` |
| Account | 多账户时指定账户号 | 留空自动选择 |

Docker Desktop 中连接宿主机 TWS/Gateway 时，Host 通常使用 `host.docker.internal`。不要把 Socket API 直接暴露到公网。

## 交易流程与标的

美股标的使用普通代码，例如 `AAPL`、`TSLA`、`MSFT`。当前信号流为：

```text
策略信号 → 待执行订单队列 → IBKR 执行 → 持仓与成交记录更新
```

支持 `open_long`、`add_long`、`reduce_long`、`close_long`。当前实现不支持做空。

## 主要接口

```text
GET    /api/ibkr/status
POST   /api/ibkr/connect
POST   /api/ibkr/disconnect
GET    /api/ibkr/account
GET    /api/ibkr/positions
GET    /api/ibkr/orders
POST   /api/ibkr/order
DELETE /api/ibkr/order/<id>
GET    /api/ibkr/quote?symbol=AAPL&marketType=USStock
```

连接模拟盘示例：

```bash
curl -X POST http://localhost:5000/api/ibkr/connect \
  -H "Content-Type: application/json" \
  -d '{"host":"127.0.0.1","port":7497,"clientId":1}'
```

## 上线检查

1. TWS/Gateway 已登录，API 端口和 Client ID 无冲突。
2. 模拟盘能查询账户、持仓和行情，并完成小额下单与撤单。
3. 策略设置了仓位与损失限制，服务端实盘开关按需启用。
4. 监控拒单、断连、保证金不足和非交易时段订单。
5. 多账户环境明确指定 Account，避免自动选择错误账户。

英文完整说明见 [IBKR Trading Guide](IBKR_TRADING_GUIDE_EN.md)，策略开发见 [Strategy API V2 指南](STRATEGY_DEV_GUIDE_CN.md)。
