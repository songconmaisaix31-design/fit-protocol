# CLI — `fit`

Zero dependencies. Runs with `node bin/fit.mjs`, or `fit` after `npm i -g .` /
`npm link`.

Every command supports `--json`; that JSON is the SDK contract (see [SDK](SDK.md)).
Human tables are a convenience, not an interface.

## Global flags

| Flag | Meaning |
|---|---|
| `--root DIR` | Registry root. Default: `$FIT_ROOT`, else `D:\env` if it has a `mise.toml`, else `~/.fit` |
| `--json` | Machine-readable output on stdout |
| `--help` | Usage |
| `--version` | Print version |

Exit codes: `0` success · `1` error (including a failed `probe`).

---

## `fit init`

Creates the registry directory and an empty `fit.json`. Idempotent.

```bash
fit init --root D:\env
fit init --root D:\env --json     # {"root": "...", "file": "...", "total": 0, ...}
```

## `fit discover`

Reads what the machine already has and prints it. **Prints, does not save**, unless
`--save` is passed — discovery is a read-only audit by default.

| Flag | Effect |
|---|---|
| `--env` | Executables on `PATH` (node, python, git, …) |
| `--skills DIR` | Directories containing `SKILL.md`; default `~/.agents/skills` |
| `--mcp FILE` | A Claude/Cursor-style `mcp.json` (`mcpServers` object) |
| `--agents FILE` | `fit.agents.json` with `{ name, url | command }` entries → acp/a2a |
| `--save` | Persist what was found |

With no flags it discovers env + skills, and auto-detects a known MCP config if
one exists (`~/.config/mcp/mcp.json`, `~/.cursor/mcp.json`, `~/.claude/mcp.json`,
`~/.codex/mcp.json`, Claude Desktop config).

```bash
fit discover --skills ~/.agents/skills --save
fit discover --env --save
fit discover --mcp ~/.cursor/mcp.json --save
fit discover --json | jq '.entries | group_by(.kind) | map({kind: .[0].kind, n: length})'
```

Discovery never overwrites unrelated entries; it upserts by `(kind, name)`.

## `fit register <kind> <name>`

Adds or updates one endpoint. Re-registering the same pair updates in place.

| Flag | Applies to |
|---|---|
| `--transport T` | all — `local`, `filesystem`, `stdio`, `http`, `sse` |
| `--command C` | `env`, `mcp`, `acp` |
| `--args a,b` | `mcp`, `acp` (comma-separated) |
| `--url U` | `a2a`, HTTP-based `mcp` |
| `--path P` / `--entry E` | `skill` |
| `--description D` | all |

```bash
fit register env   node          --command "$(which node)"
fit register skill fit-protocol  --path ~/.agents/skills/fit-protocol
fit register mcp   github        --command npx --args "-y,@modelcontextprotocol/server-github"
fit register acp   zed-agent     --command /opt/zed/agent
fit register a2a   researcher    --url https://example.com
```

## `fit agent register <name>`

Records the calling agent so the hub can report who is attached. Not
authentication — see [Registry](REGISTRY.md#agents).

```bash
fit agent register my-agent --transport mcp --capabilities registry.read,registry.write
fit list --agents
```

## `fit list [--kind K] [--agents]`

```bash
fit list
# kind  name     transport  target                            description
# ----  -------  ---------  --------------------------------  -----------
# env   node     local      C:\Program Files\nodejs\node.exe  executable discovered on PATH
# mcp   fit-hub  stdio      C:\Program Files\nodejs\node.exe  FIT hub itself (MCP stdio)
# skill fit-protocol filesystem C:\Users\me\.agents\skills\fit-protocol  ...
#
# 139 endpoints · env=18 skill=120 mcp=1 acp=0 a2a=0 · 2 agent(s)
```

`--json` returns the endpoint array directly, so `jq` composes cleanly.

## `fit resolve <name>`

Full record for one endpoint, all fields, no truncation. Use it when you need the
exact `command`/`args`/`url` rather than a table cell.

## `fit probe <name>`

**Actively** verifies an endpoint. This is the difference between "configured" and
"works":

| Kind | What happens |
|---|---|
| `env` | Runs `<command> --version`, reports path + first line |
| `skill` | Checks the `SKILL.md` entry exists |
| `mcp` | Spawns the server (or POSTs for HTTP), `initialize` → `tools/list` |
| `acp` | Spawns the agent, `initialize` |
| `a2a` | Fetches `/.well-known/agent-card.json` |

```bash
fit probe fit-hub
# mcp/fit-hub: OK
#   transport       stdio
#   serverInfo      {"name":"fit","version":"0.2.0"}
#   tools           fit_list, fit_resolve, fit_register, fit_register_agent, fit_probe, fit_doctor
```

Exit code is `1` when the probe fails, so it works as a CI gate.

## `fit call <name> [-- args…]`

Runs an **env** endpoint with the given arguments, inheriting stdio. Only `env` is
callable — FIT is a registry, not a proxy for other protocols (see
[Protocols](PROTOCOLS.md#what-is-not-implemented)).

```bash
fit call node -- --version
fit call python -- -c "print('hi')"
```

For `mcp`/`acp`/`a2a`, use `probe` to verify and your own client to call — that
keeps the trust boundary at the protocol, not at FIT.

## `fit doctor`

Health summary: counts by kind, registry path, registered agents, and endpoints
whose target is missing (`broken`). Exit `1` if anything is broken.

```bash
fit doctor
fit doctor --json
```

## `fit serve mcp`

Exposes the registry over MCP on stdio. See [MCP](MCP.md).

## `fit serve http [--port 7777]`

HTTP surface + A2A agent card. Binds `127.0.0.1` by default. See
[Protocols](PROTOCOLS.md#a2a-surface-detail).

| Route | Method | Purpose |
|---|---|---|
| `/healthz` | GET | liveness + root |
| `/registry` | GET | full registry JSON |
| `/.well-known/agent-card.json` | GET | A2A agent card |
| `/a2a` | POST | JSON-RPC `message/send` (`list`, `resolve <name>`, `doctor`) |

## Scripting notes

- Prefer `--json` + `jq` over parsing tables.
- `discover` without `--save` is safe to run in a pre-commit hook.
- `probe` spawns real processes; do not run it against untrusted `command` values.
- All writes are last-writer-wins on one file — do not run concurrent `register`
  calls from parallel jobs against the same root.
