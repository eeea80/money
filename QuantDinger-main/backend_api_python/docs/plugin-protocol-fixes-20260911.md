# 插件协议与搜索修复 — 2026-09-11

## 完成的修复

- MCP 0.5.1 在协议注册边界识别 HTTP 错误、业务错误、验证失败和未确认操作，返回 `CallToolResult(isError=true)`，保留脱敏后的内容与结构化错误。正常空账户不被误标为失败，已有内部工具函数调用方式不变。
- 全部 58 个上游工具增加四类风险注解；加上连接器共 60 个，实际注册后 60 个均有注解。写操作保守标记为非幂等，避免旧后端缺少防重时调用方自动重试；注解不代替权限与确认检查。
- 搜索目录按 market + 大写 symbol 合并，再排序和分页；同名不同市场保留，优先保留排序值高的记录。精确匹配、模糊/别名匹配、旧表回退和热门列表均覆盖，热门标记取同组任一活跃记录。没有删除或修改目录数据库记录。

## 验证

- MCP：38 项测试通过。
- 后端搜索及相关回归：37 项测试通过，包括 5 项新增 SQL 执行测试。
- 插件连接器与离线安装：26 项通过；组合首次安装/连接轮换用例 45.8 秒。
- 合计 101 项自动化测试通过。没有真实下单、启动策略或发送通知。
- 新插件原始启动入口连接现有线上服务：不存在的策略、语法错误、危险指标导入、Alpaca 账户错误，全部返回 `isError=true`；健康检查仍正常。
- 用修复后的搜索函数在本机 backend 容器内执行只读 PostgreSQL 查询，NVDA 返回一条。这是独立进程验证，没有修改运行中的服务代码。

## 插件交付

- MCP 包：0.5.1，wheel 已构建，未上传 PyPI。
- 本地插件已重装为 `0.1.0+codex.20260911082228`。
- 离线运行包 SHA-256：`8688b279add72cf8a8bda2a8b78e35d3713063e915c4d38b9e58fab83f96b5eb`。
- 安装目录与经过测试的运行包 manifest 一致。最后一次重装仅同步了文档，运行包内容未变。
- 可分发 ZIP：`outputs/plugin-fixes-20260911/quantdinger-plugin-mcp-0.5.1.zip`（相对于工作区根目录），SHA-256：`635a50a5ec9c2b324de7e8aaa9b31b5b8dc6e3f0bd0d078dad221ca3b3df2baf`。
- Codex 新任务才能可靠加载更新的工具。没有提交到公开插件市场。

## Alpaca 环境错误的解释

已观察的账户 #983 为 `exchange_id=alpaca`、`environment=demo`。`UNSUPPORTED_TRADING_ENVIRONMENT` 出自 QuantDinger 自己的 `live_trading/factory.py` 环境校验，并非 Alpaca 返回的鉴权错误。

旧版本的允许列表没有 Alpaca，因而回退到只允许 live；demo 在创建券商客户端前就被拒绝。对两个现有容器的校验函数做无网络验证：

| 容器 | 输入 | 结果 |
|---|---|---|
| 新 backend（3fdc2709cd72） | alpaca / demo / both | 接受 |
| 旧 trading-worker（a5e2fe718223） | alpaca / demo / both | UNSUPPORTED_TRADING_ENVIRONMENT |

本地现有修复允许 Alpaca live/demo，并将模拟账户路由到 paper API。本轮没有更改账户环境或密钥，也没有把 paper 账户切为 live。

线上 `ai.quantdinger.com` 在 08:20 UTC 仍返回这一错误，因此不能把本机 backend 的新版本视为线上已更新。账户快照由 backend 处理，实际交易由 trading-worker 处理，两者都需要确认实际加载的代码版本。仅重启原容器不会换镜像。

这次诊断确证了环境校验拒绝的原因；不代表已验证密钥在 Alpaca 上有效，也不代表完整持仓/挂单读取已经通过。当前账户快照仍有通用加密货币适配回退路径，环境修复部署后还应专门验证 Alpaca 股票持仓及挂单映射。

## 仍需部署

后端搜索修复在本地源码中，运行中的 Docker 服务与线上服务没有在本轮被重建。更新后端镜像后才能使服务端去重生效。Alpaca 需对齐线上 backend 与 trading-worker 的修复版本，然后重新读取账户快照。本轮没有改动交易 worker 状态。

测试日志与真实调用结果位于工作区 `outputs/plugin-fixes-20260911/`。
