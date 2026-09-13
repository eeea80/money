# Agent / MCP 回测计费

2026-09-11：补齐 `/api/agent/v1/backtest/run` 未接入平台点数计费的问题。

## 生效规则

- 复用 `BillingService`、`BILLING_ENABLED` 和 `BILLING_COST_BACKTEST`，不另设 MCP 价格。
- 关闭计费或价格为零时不扣点。启用计费且价格大于零时，提交前检查余额。
- 创建任务、扣余额、写标准 `qd_credits_log` 流水在同一数据库事务中完成。任一步失败全部回滚。
- Agent Token 的用户 ID 是计费主体，客户端不能提交用户 ID 或 `__billing` 收据覆盖它。
- 相同 Token、用户、任务类型和防重键，通过事务锁只创建一个任务；改变请求参数返回冲突。
- 不补扣部署前已有的历史任务。行情查询、源码保存与编译继续遵循原有功能规则；没有为 Codex 自身的分析和生成另加平台费用。

## 成功、失败和取消

提交返回 `job_id` 和 `billing`。任务完成后，`get_job` 顶层和 `result.billing` 均返回收据，`result.runId` 继续指向标准回测记录。

收据字段：

| 字段 | 含义 |
| --- | --- |
| enabled / cost | 提交时的计费开关与配置价格 |
| charged / refunded | 原扣款金额、已退款金额 |
| remaining | 最近一次该操作结算时的余额快照，不是实时余额 |
| referenceId | `agent-backtest:<job_id>`，关联任务和扣款/退款流水 |
| transactionId | 标准扣款流水 ID，免费时为 null |
| refundTransactionId | 退款流水 ID，未退款时为 null |
| status | free、charged 或 refunded |

余额不足返回 HTTP 402，包含 `INSUFFICIENT_CREDITS`、当前余额、所需点数及差额；不会创建任务或扣款流水。数据库不可用时不会放行免费任务。

执行失败、排队或运行期间取消、队列投递失败都会退回原扣款。退款和终态更新在同一事务中完成；重复取消或重复失败通知不重复退款。若退款写入失败，终态也回滚，保留待处理任务供后续重试。设置变化不会改变原扣款的退款额。成功任务不能再取消退款；成功和取消并发时，以获得任务行锁的终态事务为准。

任务取消属于逻辑取消；已有执行线程可能仍会结束计算。其迟到的结果、失败通知和进度不能覆盖已确定的任务终态及退款结果。

## Docker / Worker 中断

生产环境由 Celery Beat 每分钟派发一次 `expire_agent_jobs` 到 `maintenance` 队列。

- `AGENT_BILLED_JOB_TIMEOUT_SEC` 默认 7200 秒，计算从任务创建起的排队加执行总时长。
- 超时仍为 queued/running 的新计费任务转为 failed，错误码为 `AGENT_JOB_EXPIRED`，并原子退款。
- 正常超长回测需要相应调高此值；它应大于预期最长排队加执行时间。
- 重复 Celery 投递不能再次执行已领取或已结束的任务；中断后未完成的已领取任务按上述超时规则结束和退款。
- 必须运行 Beat 和消费 maintenance 队列的 Worker。关闭 Celery 的本地线程模式没有自动定时回收，仍可通过取消接口退款；本地运维也可显式调用 `expire_billed_jobs()`。

## 部署

更新后端 API、Celery Worker 和 Celery Beat 使用的后端镜像，并保留/确认现有计费配置。无需增加数据库表或迁移；本次运行时修改均在后端，MCP 与插件无需因计费再次发版。不要只更新 API 而继续使用旧 Worker，因为它不具备原子结算和退款逻辑。

本次未发布线上镜像或修改线上余额。部署后应使用专用测试账号核对提交收据、回测 runId 和标准点数流水。

## 验证结果

- 40 项 pytest 回归通过：Agent HTTP 计费契约、网页既有计费、回测保存、权限、任务进度、Celery 路由和重复投递处理。
- MCP 5 项错误协议测试通过，包含 HTTP 402 余额不足。
- PostgreSQL 13 组场景通过：成功与收据、相同请求重试、参数冲突、余额不足、免费配置、失败退款、租户隔离、取消、并发去重、并发余额竞争、派发失败、配置变化、超时、终态竞争、持久化故障回滚等组合。
- PostgreSQL 测试只使用独立随机 schema，结束后删除；未访问业务表中的用户余额。

相关测试：`tests/test_agent_backtest_billing.py`、`tests/test_backtest_billing.py`、`tests/integration/check_agent_billing_postgres.py`、`mcp_server/tests/test_security_and_tools.py`。

独立数据库测试的运行方式（在后端运行环境，使用测试数据库）：

```sh
PYTHONPATH=. python tests/integration/check_agent_billing_postgres.py
```

该检查读取 `DATABASE_URL`，始终在独立 schema 中建测试表，并在 finally 中清理。`RELEASE_SOURCE_DIR` 可指定包含候选 `db_postgres.py`、`billing_service.py`、`agent_jobs.py` 的目录，以便在独立进程中验证待部署源码。
