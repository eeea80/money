# MCP 接入指南

QuantDinger MCP Server 将 Agent Gateway 封装为 Agent 可调用的工具；REST API 仍是服务端事实来源。

## 前置条件

- QuantDinger 已启动，并能通过 `http://localhost:8888` 访问。
- 已在管理界面创建 Agent Token，并只授予任务需要的 Scope。
- 本机有 Python 和 `pip`（使用仓库源码开发时可改为可编辑安装）。

## 安装与环境变量

```bash
pip install "quantdinger-mcp==0.5.0"
```

```text
QUANTDINGER_BASE_URL=http://localhost:8888
QUANTDINGER_AGENT_TOKEN=qd_agent_xxx
```

默认运行 `quantdinger-mcp` 使用 `stdio` 传输。开发仓库中的 MCP 包时，可执行 `pip install -e ./mcp_server`。

## 客户端配置

大多数支持 MCP 的客户端可使用以下配置：

```json
{
  "mcpServers": {
    "quantdinger": {
      "command": "quantdinger-mcp",
      "env": {
        "QUANTDINGER_BASE_URL": "http://localhost:8888",
        "QUANTDINGER_AGENT_TOKEN": "qd_agent_xxx"
      }
    }
  }
}
```

不要把真实 Token 提交到代码仓库。客户端支持密钥存储或环境注入时，应优先使用。

## 远程传输

如需网络访问，可将 `QUANTDINGER_MCP_TRANSPORT` 设置为 `sse` 或 `streamable-http`，并按需配置 `QUANTDINGER_MCP_HOST`、`QUANTDINGER_MCP_PORT`。

监听非回环地址时，服务端要求独立的 `QUANTDINGER_MCP_AUTH_TOKEN`（至少 32 个字符），并建议配置外部可访问的 HTTPS 地址 `QUANTDINGER_MCP_PUBLIC_URL`。注意两类凭据职责不同：

- `QUANTDINGER_MCP_AUTH_TOKEN` 保护 MCP 网络入口；
- `QUANTDINGER_AGENT_TOKEN` 标识并限制上游 QuantDinger 租户权限。

## 验收清单

1. 客户端能发现 QuantDinger 工具。
2. 使用 `whoami` 或只读工具确认 Base URL、租户和 Scope 正确。
3. 先以只读或模拟盘流程验证；实盘 Token 不应授予无关 Scope。
4. 对写入、回测、通知、交易类工具使用唯一幂等键，并保留人工确认。

精确工具签名见 [MCP 包 README](../../mcp_server/README.md) 和 [Agent OpenAPI](agent-openapi.json)。
