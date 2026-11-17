# Access surfaces and endpoint kinds

FIT separates **what is registered** from **how you reach it**. One registry,
several surfaces; the surfaces must agree (SPEC I10).

## Endpoint kinds

| Kind | What it points at | Transport | `fit probe` does |
|---|---|---|---|
| `env` | An executable on PATH (node, python, git…) | `local` | Runs `--version`, reports the resolved path |
| `skill` | A directory with `SKILL.md` | `filesystem` | Checks the entry file exists, reports the path |
| `mcp` | An MCP server | `stdio` or `http` | `initialize` → `tools/list`, returns tool names |
| `acp` | An ACP (Agent Client Protocol) agent | `stdio` | `initialize`, returns `agentInfo` |
| `a2a` | A remote agent publishing an agent card | `http` | Fetches `/.well-known/agent-card.json`, returns skills |

Registration is the same for every kind:

```bash
fit register env   node       --command "$(which node)"
fit register skill fit-protocol --path ~/.agents/skills/fit-protocol
fit register mcp   github     --command npx --args "-y,@modelcontextprotocol/server-github"
fit register acp   zed-agent  --command /path/to/agent
fit register a2a   researcher --url https://example.com
```

## Surfaces

| Surface | Entry point | Best for | Writes? |
|---|---|---|---|
| CLI | `fit <command>` | Humans, shell scripts, CI | yes |
| MCP (stdio) | `fit serve mcp` | Any MCP-capable agent | yes |
| HTTP / A2A | `fit serve http --port 7777` | Remote agents, dashboards, A2A peers | no (read-only) |
| JS SDK | `import { Fit } from 'fit-protocol'` | Node-based agent runtimes | yes |
| Python SDK | `from fit_sdk import Fit` | Python agent runtimes | yes |

### Parity rule

A capability available on one surface must be available on the others, or the
difference must be documented here. Current parity:

| Capability | CLI | MCP | HTTP | JS | Python |
|---|---|---|---|---|---|
| list endpoints | ✅ `fit list` | ✅ `fit_list` | ✅ `GET /registry` | ✅ `list()` | ✅ `list()` |
| resolve one | ✅ `fit resolve` | ✅ `fit_resolve` | ⚠️ via `message/send` | ✅ `resolve()` | ✅ `resolve()` |
| register endpoint | ✅ `fit register` | ✅ `fit_register` | ❌ read-only | ✅ `register()` | ✅ `register()` |
| register agent | ✅ `fit agent register` | ✅ `fit_register_agent` | ❌ | ✅ `registerAgent()` | ✅ `register_agent()` |
| probe endpoint | ✅ `fit probe` | ✅ `fit_probe` | ❌ | ✅ `probe()` | ✅ `probe()` |
| health / stats | ✅ `fit doctor` | ✅ `fit_doctor` | ✅ `GET /healthz` | ✅ `stats()` | ✅ `stats()` |

HTTP is deliberately read-only: it is the surface most likely to be exposed to
another machine, and a registry that anyone can write to is not a registry.

## Registering an agent

An agent registers itself once, then consumes the registry:

```bash
# 1. identify
fit agent register my-agent --transport mcp --capabilities registry.read,registry.write

# 2. consume through whichever surface it already speaks
fit list --kind skill --json      # CLI
# or MCP: fit_list { "kind": "skill" }
# or HTTP: GET /registry
```

Registration is not authentication — it records intent and capabilities so the hub
can report who is attached (`fit list --agents`). Trust boundaries stay with the
transport: stdio is local, HTTP should be firewalled.

## MCP surface detail

`fit serve mcp` exposes six tools: `fit_list`, `fit_resolve`, `fit_register`,
`fit_register_agent`, `fit_probe`, `fit_doctor`. It does **not** proxy other MCP
servers' tools — if you want a registered server's tools, point your client at
that server directly. FIT's job is telling you it exists and whether it answers.

## A2A surface detail

The HTTP surface publishes an agent card at `/.well-known/agent-card.json`
declaring three skills (`registry.list`, `registry.resolve`, `registry.doctor`)
and accepts JSON-RPC `message/send` at `/a2a`. Requests are interpreted as
commands, e.g. `{"parts":[{"type":"text","text":"list"}]}`.

This is a deliberately small subset of A2A: no streaming, no push notifications,
no task persistence. It is enough for another agent to discover the hub and read
the registry; it is not a general-purpose task runtime.

## What is not implemented

Being explicit beats looking complete:

- MCP: no resources/subscriptions/prompts, no server-side proxy to other MCP servers.
- ACP: probe only (`initialize`). FIT does not drive an ACP session.
- A2A: discovery + one request/response shape. No streaming, no task resumption.
- Registry: no locking. Two concurrent writers can lose an update — treat it as a
  local, single-user file.
