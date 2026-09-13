# QuantDinger 中文文档

QuantDinger 是一套可自托管的 AI 量化交易平台，覆盖行情研究、Strategy API V2
策略开发、回测、模拟盘与实盘执行、生产运维，以及 AI Agent 接入。本页是当前 v5
版本的中文文档入口。

[English](README.md) · [官方网站](https://quantdinger.com) ·
[在线应用](https://ai.quantdinger.com) · [GitHub](https://github.com/OpenByteInc/QuantDinger)

> 启用实盘后，系统可以提交真实订单。请先使用模拟盘，为交易凭据设置最小权限，
> 并确认所在地区的法律、合规与运营要求。QuantDinger 不提供投资建议。

## 观看 QuantDinger 宣传视频

<p align="center">
  <img src="screenshots/quantdinger-v5-2x.gif" alt="QuantDinger 完整宣传片，2 倍速动态演示" width="800">
</p>

## 按目标开始

| 你的目标 | 首先阅读 | 接下来阅读 |
| --- | --- | --- |
| 安装 QuantDinger | [云服务器部署](deployment/CLOUD_DEPLOYMENT_CN.md) | [安装故障排查](deployment/INSTALL_TROUBLESHOOTING_CN.md) |
| 上生产环境 | [生产加固](deployment/PRODUCTION_HARDENING_CN.md) | [可观测性](deployment/OBSERVABILITY_CN.md) |
| 开发交易策略 | [Strategy API V2 策略指南](trading/STRATEGY_DEV_GUIDE_CN.md) | [图表指标指南](trading/INDICATOR_DEV_GUIDE_CN.md) |
| 接入 AI Agent | [MCP 接入](agent/MCP_SETUP_CN.md) | [Agent Gateway 快速开始](agent/AGENT_QUICKSTART_CN.md) |
| 通过 HTTP 集成 | [Human API 与 OpenAPI](api/README_CN.md) | [API 约定（英文）](architecture/API_CONVENTIONS.md) |
| 扩展后端能力 | [系统架构总览](architecture/README_CN.md) | [扩展指南（英文）](architecture/EXTENSION_GUIDE.md) |

## 五分钟安装

前置条件：Docker 与 Compose v2。一键安装程序会要求设置管理员账号，生成必要密钥，
写入部署环境并启动预构建的 GHCR 服务栈。

Linux 或 macOS：

```bash
curl -fsSL https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/install.ps1 | iex
```

启动后默认访问地址：

| 功能 | 本机默认地址 |
| --- | --- |
| PC Web | `http://127.0.0.1:8888` |
| 移动 H5 | `http://127.0.0.1:8889` |
| 后端健康检查 | `http://127.0.0.1:5000/api/health` |

源码构建、反向代理、HTTPS、版本升级和网络代理等配置，请继续阅读
[云服务器部署指南](deployment/CLOUD_DEPLOYMENT_CN.md)。

## 系统运行结构

v5 将长期运行的职责与 HTTP 请求处理分开：

| 进程 | 主要职责 |
| --- | --- |
| `migration` | 在其他服务启动前应用数据库结构变更。 |
| `backend` | 处理 HTTP 鉴权、校验、查询和持久命令提交。 |
| `trading-worker` | 管理策略运行、券商会话、订单、租约和状态对账。 |
| `scheduler-worker` | 执行组合、部署、支付和通知等领域调度。 |
| `celery-worker` | 执行 AI、回测、报告和维护等有限、可重试任务。 |
| `celery-beat` | 定期向 Celery 投递任务。 |

PostgreSQL 是系统记录来源；`redis` 是可淘汰缓存，`redis-jobs` 是持久化的
Celery broker 与结果存储。修改进程归属或共享状态前，请先阅读
[系统架构总览](architecture/README_CN.md)。

## 完整文档导航

### 部署与运维

- [云服务器部署](deployment/CLOUD_DEPLOYMENT_CN.md)
- [安装故障排查](deployment/INSTALL_TROUBLESHOOTING_CN.md)
- [生产加固](deployment/PRODUCTION_HARDENING_CN.md)
- [可观测性](deployment/OBSERVABILITY_CN.md)
- [多用户运行](deployment/MULTI_USER_SETUP_CN.md)
- [OAuth 登录配置](deployment/OAUTH_CONFIG_CN.md)
- [管理员与系统设置排错](deployment/ADMIN_AND_SETTINGS_TROUBLESHOOTING_CN.md)
- 通知配置：[邮件](deployment/NOTIFICATION_EMAIL_CONFIG_CN.md)、
  [短信](deployment/NOTIFICATION_SMS_CONFIG_CN.md)、
  [Telegram](deployment/NOTIFICATION_TELEGRAM_CONFIG_CN.md)
- [USDT 支付](deployment/USDT_PAYMENT_GUIDE.md)

### 交易与研究

- [Strategy API V2 策略开发](trading/STRATEGY_DEV_GUIDE_CN.md)
- [图表指标开发](trading/INDICATOR_DEV_GUIDE_CN.md)
- [公开股票池与基本面数据](trading/PUBLIC_UNIVERSE_AND_FUNDAMENTALS_CN.md)
- [Interactive Brokers](trading/IBKR_TRADING_GUIDE_CN.md)
- 可运行示例位于 [`examples/`](examples/)

### API 与 Agent

- [Human API 与 OpenAPI](api/README_CN.md)
- [Agent 文档总览](agent/README_CN.md)
- [MCP 接入](agent/MCP_SETUP_CN.md)
- [Agent Gateway 快速开始](agent/AGENT_QUICKSTART_CN.md)
- 机器可读契约：[`api/openapi.yaml`](api/openapi.yaml) 与
  [`agent/agent-openapi.json`](agent/agent-openapi.json)

## 语言与维护规则

每篇面向人的文档只使用一种主要语言。中英文均维护时，官网语言切换会直接跳转到
对应页面；接口路径、环境变量、代码标识和机器可读契约保留规范英文名称。

主仓库的 `docs/` 是唯一文档源。功能或契约变化时，应同时更新相关索引与对应语言页；
规划草稿、临时审查记录和已完成的路线图不应发布为产品文档。
