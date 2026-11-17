# MCP surface

`fit serve mcp` turns the registry into six MCP tools over stdio. Any MCP-capable
agent can then read — and extend — what the machine offers, without knowing the
`fit.json` format.

## Start

```bash
node bin/fit.mjs serve mcp                 # root from $FIT_ROOT / D:\env / ~/.fit
node bin/fit.mjs serve mcp --root D:\env   # explicit
```

Transport is newline-delimited JSON-RPC on stdio. Diagnostics go to **stderr**;
stdout carries protocol frames only, so a client that logs stdout must not be
configured to swallow it.

## Client configuration

Claude Desktop / Cursor / any `mcpServers` host:

```json
{
  "mcpServers": {
    "fit": {
      "command": "node",
      "args": ["D:\\repos\\fit-protocol\\bin\\fit.mjs", "serve", "mcp"],
      "env": { "FIT_ROOT": "D:\\env" }
    }
  }
}
```

On macOS/Linux swap the path separators; the shape is identical. If `fit` is on
`PATH` (`npm link`), `"command": "fit", "args": ["serve", "mcp"]` also works.

## Tools

| Tool | Arguments | Returns |
|---|---|---|
| `fit_list` | `{ kind? }` | `{ count, endpoints[] }` — `kind`, `name`, `transport`, `target`, `description` |
| `fit_resolve` | `{ name, kind? }` | full registry record |
| `fit_register` | `{ kind, name, transport?, command?, url?, path?, description? }` | `{ registered, file }` |
| `fit_register_agent` | `{ name, transport?, capabilities? }` | the agent record, including its `id` |
| `fit_probe` | `{ name, kind? }` | handshake result (same shape as `fit probe --json`) |
| `fit_doctor` | `{}` | counts by kind, registry path, agent count |

Schemas are declared in `adapters/mcp-server.mjs` (`TOOLS`) and surfaced through
`tools/list`; clients should read them rather than rely on this table.

## Example session

```jsonc
// → request
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"my-agent","version":"1.0"}}}
// ← response
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"fit","version":"0.2.0"}}}

// → notification (no id)
{"jsonrpc":"2.0","method":"notifications/initialized"}

// → call
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"fit_list","arguments":{"kind":"skill"}}}
// ← result: text payload containing JSON
{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"{\n  \"count\": 120,\n  ...\n}"}]}}
```

`tools/call` results are always `content[0].text` containing JSON — parse it, do not
regex it. A runnable client lives in
[`examples/mcp-client.mjs`](../examples/mcp-client.mjs).

## Errors

Tool-level failures (unknown name, bad kind) come back as a normal result with
`isError: true` and the message in `content[0].text`, per MCP convention. Protocol
errors (`-32601` unknown method, `-32700` parse error) come back as JSON-RPC error
objects.

A discoverable failure mode: if you spawn the server with a `cwd` where `node` is
not resolvable, the process exits and the client reports a transport error, not a
tool error. `probe` from the CLI is the faster way to debug that.

## What this server does not do

- No `resources/*`, no `prompts/*`, no subscriptions. `resources/list` returns an
  empty list rather than erroring, for clients that always probe it.
- No proxying of other MCP servers' tools. If `github` is registered, this server
  tells you it exists and whether it answers — it does not re-export `github`'s
  tools. Point your client at `github` directly for that.
- No authentication. stdio is a local trust boundary; exposing this over a network
  transport is your responsibility (and currently unsupported).

## Self-registration

The hub can register itself, which is also the cheapest end-to-end check:

```bash
node bin/fit.mjs register mcp fit-hub --command node \
  --args "D:\repos\fit-protocol\bin\fit.mjs,serve,mcp" --root D:\env
node bin/fit.mjs probe fit-hub --root D:\env
# mcp/fit-hub: OK
#   tools  fit_list, fit_resolve, fit_register, fit_register_agent, fit_probe, fit_doctor
```
