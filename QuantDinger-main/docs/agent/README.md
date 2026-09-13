# Agent documentation (English)

This folder holds **agent-facing** material for coding assistants (Cursor, Claude Code, Codex, CLI bots, etc.).

| Document | Purpose |
|----------|---------|
| [MCP_SETUP.md](MCP_SETUP.md) | Wire Cursor / Claude Code / Codex / remote agents to a QuantDinger backend via the `quantdinger-mcp` MCP server (local stdio + remote HTTP) |
| [AGENT_ENVIRONMENT_DESIGN.md](AGENT_ENVIRONMENT_DESIGN.md) | Architecture: layered contracts (docs → commands → API/MCP), security boundaries, roadmap, implementation checklist |
| [AI_INTEGRATION_DESIGN.md](AI_INTEGRATION_DESIGN.md) | How external AI agents (P4) and autonomous strategy AIs (P5) consume QuantDinger via a versioned, scoped Agent Gateway |
| [AGENT_QUICKSTART.md](AGENT_QUICKSTART.md) | Operator + integrator walkthrough: issue a token, call the Gateway, run paper trades |
| [agent-openapi.json](agent-openapi.json) | Machine-readable contract for `/api/agent/v1` (OpenAPI 3.0) |
| [../architecture/API_CONVENTIONS.md](../architecture/API_CONVENTIONS.md) | Shared HTTP conventions (envelopes, auth, Public/Internal tiers) |
| [../api/openapi.yaml](../api/openapi.yaml) | Human Web API spec (flask-smorest; migration in progress) |

**Language policy:** Machine-readable schemas, route names, scopes, environment variables, and tool identifiers remain in English as the canonical contract. Human setup guides are maintained in paired editions: [中文入口](README_CN.md) and this English entry. The automation-oriented [`.cursor/skills/`](../../.cursor/skills/) content remains English-only so it behaves consistently across tools and locales.
