# USDT 支付配置指南

本文档描述 QuantDinger v5 当前的 USDT 收款流程，面向需要完成生产配置与验收的运营人员。

> **核心机制**：所有用户付到**同一个主钱包地址**，订单通过「**金额尾数**」识别（base 价格 + 一个不超过 0.01 USDT 的小尾数）。**不再有派生地址，不再需要归集**。

---

## 1. 选哪几条链？

| 链 | 典型手续费 | 推荐场景 | 备注 |
|---|---|---|---|
| **BSC (BEP20)** | ≈ $0.30 | 🟢 推荐主选 | 速度快、费用低、用户基数大 |
| **Solana (SPL)** | ≈ $0.0005 | 🟢 推荐 | 极便宜，Phantom / Solflare 一扫即填 |
| **TRON (TRC20)** | ≈ $1.50 | 🟡 国内/币安习惯用户 | 老用户最熟悉的链 |
| **Ethereum (ERC20)** | ≈ $5.00 | 🔴 不推荐做主链 | 仅作大额企业用户兜底 |

建议至少同时开 BSC + TRC20 两条，对应「省钱用户」+「币安习惯用户」两群人。

---

## 2. 准备主钱包地址

每条要开的链准备一个**纯收款地址**（建议跟交易/经营钱包分离，做收款专用）：

| 链 | 地址类型 | 来源 |
|---|---|---|
| TRC20 | `T...` (base58, 34 字符) | TronLink / imToken / TP / 任意 TRON 钱包 |
| BEP20 | `0x...` (40 字符 EVM) | MetaMask / TrustWallet — 同一个 EVM 私钥也可用于 ERC20 |
| ERC20 | `0x...` (40 字符 EVM) | 通常和 BEP20 用同一个 EVM 地址，省一组管理 |
| SOL | base58 (44 字符左右) | Phantom / Solflare / TP |

> ⚠️ Solana 必须填**钱包地址**（不是 USDT ATA），扫描器内部自动定位用户 ATA。

---

## 3. 申请区块浏览器 API Key（强烈建议）

匿名访问 Etherscan / BscScan 每天 ≤200 次，订单略多就被限流。免费 Key 配额是 100k/月，绝对够用。

| 服务 | 申请页面 | env 变量 |
|---|---|---|
| Etherscan | <https://etherscan.io/myapikey> | `ETHERSCAN_API_KEY` |
| BscScan | <https://bscscan.com/myapikey> | `BSCSCAN_API_KEY` |
| TronGrid | <https://www.trongrid.io/dashboard/keys> | `TRONGRID_API_KEY` |
| Solana RPC | 公开节点免费即可；若高并发可用 [Helius](https://helius.dev/) 或 [QuickNode](https://www.quicknode.com/) | `SOLANA_RPC_URL` |

---

## 4. 编辑 `.env`

最小化配置（只开 BSC + TRC20）：

```bash
# ===== 主开关 =====
USDT_PAY_ENABLED=true
USDT_PAY_ENABLED_CHAINS=TRC20,BEP20

# ===== 收款地址（只填要开的链） =====
USDT_TRC20_ADDRESS=Txxx...你的TRON地址xxxxxxxxxxxx
USDT_BEP20_ADDRESS=0xxxx...你的BSC地址xxxxxxxxxxxxxxxxxxxx

# ===== 浏览器 API Key（推荐） =====
TRONGRID_API_KEY=trongrid-key-here
BSCSCAN_API_KEY=bscscan-key-here

# ===== 金额尾数精度（默认 6 位就够，每单最多额外 1¢） =====
USDT_AMOUNT_SUFFIX_DECIMALS=6

# ===== 入账确认延迟 / 订单过期 =====
USDT_PAY_CONFIRM_SECONDS=30
USDT_PAY_EXPIRE_MINUTES=30
USDT_WORKER_POLL_INTERVAL=30
```

四条全开的样例直接复制 `env.example` 里 USDT 段即可。

---

## 5. 启动 & 验证

### 5.1 重启后端

数据库 schema 会自动迁移（`init.sql` 里的 `DO $$ ... ADD COLUMN IF NOT EXISTS ...` 块幂等），不需要任何 `psql` 手工命令。

### 5.2 验证链选择器

打开前端「会员中心」→ 点任意一个套餐的「立即购买」按钮：

- ✅ 看到「选择支付网络」弹窗，列出你开启的所有链
- ❌ 看不到选项 → 检查 env：链未配地址或不在 `USDT_PAY_ENABLED_CHAINS` 白名单

### 5.3 发一笔最小订单测试

1. 选 BSC（最便宜），点「继续支付」
2. 弹支付页 → 看到大字号金额 `19.99xxxx USDT`（**xxxx 高亮成红色** = 尾数）
3. 用 MetaMask / TokenPocket 移动端扫二维码 → 应该自动跳到 USDT 转账页，**地址 + 金额都已填好**（这就是 EIP-681 deep link 效果）
4. 转账完成 → 后端 worker 30s 内扫到 → 订单变成 `paid` → 再 30s 后变 `confirmed` → 会员到期日刷新

### 5.4 常见自检命令

```bash
# 看后端 worker 日志
docker compose logs -f backend | grep -E "UsdtOrderWorker|USDT reconcile|USDT order"

# 直接 ping API（带登录 Cookie 或 Bearer Token）
curl -H "Authorization: Bearer <token>" http://localhost:5000/api/billing/usdt/chains
```

正常返回示例：

```json
{
  "code": 1,
  "data": {
    "chains": [
      { "code": "BEP20", "label": "BSC (BEP20)", "address": "0x...", "recommended": true, "typical_fee_usdt": 0.3, ... },
      { "code": "TRC20", "label": "TRON (TRC20)", "address": "Txxx", "recommended": false, "typical_fee_usdt": 1.5, ... }
    ]
  }
}
```

---

## 6. 故障排查

| 症状 | 可能原因 | 处理 |
|---|---|---|
| 前端弹「暂无可用的支付网络」 | `USDT_PAY_ENABLED_CHAINS` 为空 / 所有 `USDT_*_ADDRESS` 为空 | 至少配一条 |
| 订单创单返回 `usdt_pay_disabled` | `USDT_PAY_ENABLED=false` | 改为 `true` 重启 |
| 订单创单返回 `chain_not_available` | 用户选的链未配地址或不在白名单 | 见 5.2 |
| 订单 30 分钟后还 `pending`，链上明明到账 | watcher 没运行 / API Key 超限 / 金额没匹配上 | 看 worker 日志；金额匹配是**精确匹配**，转账时金额必须严格等于订单要求 |
| 创单返回 `amount_collision` | 极少见：10 次重试都撞到同 (chain, amount) 唯一索引 | 通常是 `USDT_AMOUNT_SUFFIX_DECIMALS=4` 太小，改为 6 |
| 单子 `expired` 但用户说付了 | 转账金额尾数错（手输金额漏了几位） | 提示用户重新下单；旧订单从客服后台手工兑账 |

---

## 7. 钱包兼容性对照

| 钱包 | TRC20 URI | EVM (EIP-681) | Solana Pay |
|---|---|---|---|
| **MetaMask** | – | ✅ 自动填 | – |
| **TrustWallet** | – | ✅ 自动填 | – |
| **imToken** | ✅ 自动填 | ✅ 自动填 | ✅ 自动填 |
| **TokenPocket (TP)** | ✅ 自动填 | ✅ 自动填 | ✅ 自动填 |
| **OKX Wallet** | ✅ 自动填 | ✅ 自动填 | ✅ 自动填 |
| **Coinbase Wallet** | – | ✅ 自动填 | – |
| **Phantom** | – | – | ✅ 自动填 |
| **Solflare** | – | – | ✅ 自动填 |
| **TronLink (旧版)** | ⚠️ 只读地址 | – | – |
| **Binance Wallet (内置)** | ⚠️ 只读地址 | ⚠️ 只读地址 | ⚠️ 只读地址 |

「只读地址」的钱包扫码后只会读到收款地址，用户需要从订单页**复制金额**（金额按钮就在二维码下方）。订单页对金额做了红色高亮 + 一键复制，最大程度降低漏付/少付的概率。

---

## 8. FAQ

**Q：为什么每单要让用户多付一点点（比如 19.9 → 19.991234）？**
A：这就是「订单身份证」—— 我们用这个尾数把链上转账匹配回订单。每单最多额外 1¢ 是设计上限。

**Q：能不能让金额完全对齐 base 价（不带尾数）？**
A：可以，但那样多笔金额相同的并发订单会撞车，必须重新引入派生地址。两难取舍，我们选了「+1¢ 容忍」。

**Q：碰撞概率有多大？**
A：6 位精度下尾数 slot 空间 ≈ 10000，30 分钟窗口内同金额同链订单要超过 ~100 个才有可观碰撞率。下单冲突会自动重试 10 次，业务侧基本看不到。

**Q：API Key 不申请行不行？**
A：测试可以，生产强烈不建议。Etherscan / BscScan 匿名 200 次/天，一上量就会限流，导致订单 30 分钟内匹配不到链上转账，用户体验掉到地板。

**Q：旧的 xpub 派生订单还能用吗？**
A：v3.0.6 不再生成新的派生订单。老订单数据仍保留在 `qd_usdt_orders` 表里，用户可以查看历史；但 worker 只对新模型订单做匹配（chain ∈ 新四链 + address = 主钱包地址）。需要兑账老订单请走客服后台手工处理。

**Q：用户关闭支付窗口后重新打开会怎样？**
A：v3.0.6 起 `create_order` 是幂等的 —— 同一用户在 `(plan, chain)` 上如果已有一笔 `pending` 且未过期的订单，再次点购买会直接复用那张单（同样的金额、地址、URI、剩余过期时间），不会插入新行。前端会弹一行 toast「检测到您还有一笔未支付的订单，已为您继续展示」让用户知道这是同一笔。如果用户切换到另一条链，则视为新的支付意图，会创建一张新订单。

**Q：金额显示为什么固定 6 位小数？**
A：精度由 `USDT_AMOUNT_SUFFIX_DECIMALS` 控制（默认 6）。DB 列宽 `NUMERIC(20,8)` 留了 2 位扩展空间，但所有出口（API / URI / 二维码 / UI）统一量化到 `suffix_decimals()` 位 —— 你看到的金额永远长这样：`19.9` → `19.901234`、`20` → `20.001234`、`19.99` → `19.991234`。多 1 位或少 1 位都属于 bug。
