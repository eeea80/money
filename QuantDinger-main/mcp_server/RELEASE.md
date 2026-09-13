# Release quantdinger-mcp to PyPI

## This release: 0.6.2

Disable inferred output schemas for heterogeneous gateway responses. On Python
3.10, FastMCP inferred an `Any` return as a required `result` wrapper and rejected
our explicit error `CallToolResult` before it reached the client. Error results
retain `isError=true`, redacted text, and structured details; successful responses
remain unwrapped JSON text. CI now completes every Python matrix job even when
one version fails, and regression tests cover both tool schemas and success payloads.

## Previous release: 0.6.1

Health probes now report MCP protocol errors for HTTP failures, timeouts, connection failures, and malformed or unsuccessful health responses. Error details still pass through the redaction contract. The accompanying backend patch fixes idempotency row counts, Alpaca account snapshots, and best-effort futures quotes; deploying the MCP package alone does not update the backend.

## Previous release: 0.6.0

Gateway HTTP errors, application errors, validation failures, and confirmation denials now return MCP `isError=true` while preserving redacted structured details. All 58 tools declare read-only, destructive, idempotent, and open-world hints. Write hints remain conservatively non-idempotent so clients cannot infer that retries against older gateways are safe. Confirmation and server-side permission checks remain required.

## Previous release: 0.5.0

This release expands MCP to complete research, strategy authoring, backtest, broker observation, notification, and safety-gated trading workflows. It adds atomic idempotency, distributed quotas, job cancellation, notional caps, and an emergency stop.

Before uploading:

- configure and test a distinct `QUANTDINGER_MCP_AUTH_TOKEN` for every public HTTP deployment;
- verify the Strategy API V2 source, compile, backtest, and stopped-deployment workflow;
- rebuild from a clean directory so no 0.3 artifacts are present.

```powershell
cd mcp_server

# 1. Install build tools (once)
py -3.13 -m pip install -e ".[dev]"

# 2. Tests
py -3.13 -m pytest tests/ -q

# 3. Clean old artifacts (optional)
Remove-Item -Recurse -Force dist, build -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force src\quantdinger_mcp.egg-info -ErrorAction SilentlyContinue

# 4. Build
py -3.13 -m build

# 5. Upload (you run this -- needs your PyPI token)
$env:TWINE_USERNAME = "__token__"
$env:TWINE_PASSWORD = "pypi-Ag..."   # your API token
py -3.13 -m twine upload dist/quantdinger_mcp-0.6.2*

# 6. Verify
pip install --upgrade "quantdinger-mcp==0.6.2"
quantdinger-mcp
```

Linux / macOS upload:

```bash
cd mcp_server
pip install -e ".[dev]"
python -m pytest tests/ -q
rm -rf dist build src/*.egg-info
python -m build
TWINE_USERNAME=__token__ TWINE_PASSWORD=pypi-... python -m twine upload dist/quantdinger_mcp-0.6.2*
```

## Notes

- Upload **only** the `0.6.2` files from `dist/` -- do not upload older versions again.
- PyPI token: Account settings -> API tokens -> scope `quantdinger-mcp` or entire account.
- After publish: restart Cursor MCP or `pip install --upgrade quantdinger-mcp`.
