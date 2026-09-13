# CANSLIM 股票分析接口

## 接口

`POST /api/ai/stocks/canslim`

该接口受现有 Bearer Token 登录鉴权保护。请求体：

```json
{
  "stockName": "贵州茅台"
}
```

也支持传入纯股票代码或完整 `thscode`。服务先调用同花顺标的检索接口消歧；若存在多个合理候选，会返回 HTTP 409 和候选列表，不会猜测交易所后缀。

调用示例：

```bash
curl -X POST 'http://localhost:8080/api/ai/stocks/canslim' \
  -H 'Authorization: Bearer <login-token>' \
  -H 'Content-Type: application/json' \
  -d '{"stockName":"贵州茅台"}'
```

## 数据流程

1. `/api/meta/tickers/search`：股票名称/代码解析为唯一 A 股 `thscode`。
2. `/api/a-share/prices/snapshot`：最新价格、涨跌幅、成交量和成交额。
3. `/api/a-share/prices/historical`：近约 400 个自然日的前复权日 K。
4. `/api/a-share/financials/income-statements`：最近 8 期季度和最近 5 期年度利润表。
5. `/api/a-share/financials/indicators`：最新报告期的净利润和营业收入同比增长。
6. `/api/a-share/financials/cash-flow-statements`：最近 5 期年度经营现金流。
7. `/api/a-share-index/prices/historical`：沪深 300 市场方向和相对强弱基准。
8. `/api/a-share/special-data/dragon-tiger-list?board_type=org`：最新机构龙虎榜代理数据。

所有远端请求都检查 HTTP 状态和业务响应 `code == 0`。API Key 只读取 `fuyao.api-key`，只通过 `X-api-key` 请求头发送，不进入接口响应。
互不依赖的数据请求使用 Java 21 虚拟线程并行执行；网络错误、限流和 `5xxx` 上游错误最多尝试 3 次。

## CANSLIM 规则

| 维度 | 分值 | 当前实现依据 |
|---|---:|---|
| C | 20 | 最新净利润同比和营业收入同比增长 |
| A | 20 | 3–5 年年度 EPS 复合增长和连续性 |
| N | 10 | 接近 52 周新高的量化代理 |
| S | 15 | 近 20 日与此前 20 日的量能变化，并结合价格方向 |
| L | 15 | 个股近 120 日收益相对沪深 300 的超额收益 |
| I | 5 | 最新机构龙虎榜净额代理 |
| M | 15 | 沪深 300 最新收盘、MA50 和 MA200 趋势 |

`N` 无法仅靠当前结构化行情验证新产品/新管理层，`I` 也不等同于长期基金持仓；响应中的 `warnings` 会明确说明这两个代理边界。

## 响应说明

- `score`：已取得维度的实际得分，满分设计为 100。
- `coveredMaxScore`：本次真实数据实际覆盖的最高可得分；数据不足的维度不计入。
- `normalizedScore`：`score / coveredMaxScore * 100`，用于部分上游暂时失败时保持可解释性。
- `verdict`：只有覆盖分达到 80 且市场方向有效时才可能给出“较强候选”；覆盖低于 60 时固定提示数据覆盖不足。
- `dimensions`：七个维度的评分、状态、摘要、计算证据和来源端点。
- `fundamentals` / `technicals`：供前端展示的关键基本面与技术指标。
- `dataSources`：每个真实数据请求的成功/失败状态、`request_id` 和数据时间。
- `warnings`：上游部分失败或方法论代理边界。缺失值不会用模拟数据或 0 补齐。
- `aiAdvice`：DeepSeek 仅依据本次真实数据、评分证据和缺失项生成的中文研究建议。AI 不可用时返回明确的降级说明，原始分析不会失败。

配置支持：

```yaml
fuyao:
  base-url: ${FUYAO_BASE_URL:https://fuyao.aicubes.cn}
  api-key: ${FUYAO_API_KEY:your-api-key}
  timeout: ${FUYAO_TIMEOUT:15s}
```
