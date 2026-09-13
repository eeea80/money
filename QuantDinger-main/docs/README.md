# QuantDinger Documentation

QuantDinger is a self-hosted AI trading platform that connects market research,
Strategy API V2 development, backtesting, paper/live execution, operations, and
AI-agent access. This documentation describes the current v5 release.

[中文文档](README_CN.md) · [Official website](https://quantdinger.com) ·
[Web app](https://ai.quantdinger.com) · [GitHub](https://github.com/OpenByteInc/QuantDinger)

> Live trading can submit real orders. Start in paper mode, grant exchange keys
> the minimum permissions required, and confirm the legal and operational
> requirements for your jurisdiction. QuantDinger does not provide investment
> advice.

## Choose your goal

| Goal | Start here | Continue with |
| --- | --- | --- |
| Install QuantDinger | [Cloud deployment](deployment/CLOUD_DEPLOYMENT_EN.md) | [Installation troubleshooting](deployment/INSTALL_TROUBLESHOOTING.md) |
| Prepare production | [Production hardening](deployment/PRODUCTION_HARDENING.md) | [Observability](deployment/OBSERVABILITY.md) |
| Develop a strategy | [Strategy API V2 guide](trading/STRATEGY_DEV_GUIDE.md) | [Indicator guide](trading/INDICATOR_DEV_GUIDE.md) |
| Connect an AI agent | [MCP setup](agent/MCP_SETUP.md) | [Agent Gateway quickstart](agent/AGENT_QUICKSTART.md) |
| Integrate over HTTP | [Human OpenAPI](api/README.md) | [API conventions](architecture/API_CONVENTIONS.md) |
| Extend the backend | [Architecture overview](architecture/README.md) | [Extension guide](architecture/EXTENSION_GUIDE.md) |

## Five-minute installation

Prerequisites: Docker with Compose v2. The installer asks for an administrator
account, generates the required secrets, writes the deployment environment, and
starts the prebuilt GHCR stack.

Linux or macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/OpenByteInc/QuantDinger/main/install.ps1 | iex
```

After startup:

| Surface | Default local address |
| --- | --- |
| Desktop web app | `http://127.0.0.1:8888` |
| Mobile web app | `http://127.0.0.1:8889` |
| Backend health check | `http://127.0.0.1:5000/api/health` |

For source builds, reverse proxies, HTTPS, upgrades, and proxy settings, use the
[cloud deployment guide](deployment/CLOUD_DEPLOYMENT_EN.md).

## System map

The v5 runtime separates long-lived ownership from request handling:

| Process | Responsibility |
| --- | --- |
| `migration` | Applies database schema changes before dependent services start. |
| `backend` | HTTP authentication, validation, queries, and durable command submission. |
| `trading-worker` | Strategy runtimes, broker sessions, orders, leases, and reconciliation. |
| `scheduler-worker` | Portfolio, deployment, payment, and notification schedules. |
| `celery-worker` | Finite retryable work such as AI jobs, backtests, reports, and maintenance. |
| `celery-beat` | Periodically enqueues Celery work. |

PostgreSQL is the system of record. `redis` is an evictable cache;
`redis-jobs` is the durable Celery broker/result tier. See the
[architecture overview](architecture/README.md) before changing process
ownership or shared state.

## Documentation map

### Deployment and operations

- [Cloud deployment](deployment/CLOUD_DEPLOYMENT_EN.md)
- [Installation troubleshooting](deployment/INSTALL_TROUBLESHOOTING.md)
- [Production hardening](deployment/PRODUCTION_HARDENING.md)
- [Observability](deployment/OBSERVABILITY.md)
- [Multi-user operation](deployment/MULTI_USER_SETUP.md)
- [OAuth configuration](deployment/OAUTH_CONFIG_EN.md)
- [Administrator and settings troubleshooting](deployment/ADMIN_AND_SETTINGS_TROUBLESHOOTING_EN.md)
- Notifications: [Email](deployment/NOTIFICATION_EMAIL_CONFIG_EN.md),
  [SMS](deployment/NOTIFICATION_SMS_CONFIG_EN.md), and
  [Telegram](deployment/NOTIFICATION_TELEGRAM_CONFIG_EN.md)

### Trading and research

- [Strategy API V2 development](trading/STRATEGY_DEV_GUIDE.md)
- [Chart indicator development](trading/INDICATOR_DEV_GUIDE.md)
- [Interactive Brokers](trading/IBKR_TRADING_GUIDE_EN.md)
- Runnable examples in [`examples/`](examples/)

### APIs and agents

- [Human Web API and OpenAPI](api/README.md)
- [Agent documentation](agent/README.md)
- [MCP setup](agent/MCP_SETUP.md)
- [Agent Gateway quickstart](agent/AGENT_QUICKSTART.md)
- Machine-readable contracts:
  [`api/openapi.yaml`](api/openapi.yaml) and
  [`agent/agent-openapi.json`](agent/agent-openapi.json)

## Language and maintenance policy

Each human-readable page uses one primary language. English and Chinese pages
are paired when both are maintained; the website language switch links directly
to the paired page. Machine-readable schemas, identifiers, environment variable
names, and code remain in their canonical English form.

The repository `docs/` directory is the source of truth. Update the relevant
index and counterpart language page when a contract or workflow changes. Do not
publish planning notes, completed roadmaps, or temporary audits as product
documentation.
