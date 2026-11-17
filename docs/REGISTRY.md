# Registry — `fit.json`

One file describes everything the machine offers. Five surfaces read it; none
keeps a private list (SPEC I9).

## Location

`<Root>/registry/fit.json`, where `<Root>` is resolved as:

1. `--root DIR`
2. `$FIT_ROOT`
3. `D:\env` — if it contains `mise.toml`
4. `~/.fit`

`fit doctor` prints the exact path in use.

## Schema

```json
{
  "version": 1,
  "root": "D:\\env",
  "updatedAt": "2026-11-17T11:56:07.976Z",
  "endpoints": [
    {
      "kind": "env",
      "name": "node",
      "transport": "local",
      "command": "C:\\Program Files\\nodejs\\node.exe",
      "description": "executable discovered on PATH",
      "registeredAt": "2026-11-17T11:56:07.976Z"
    }
  ],
  "agents": [
    {
      "id": "agent_qtffu3g8",
      "name": "example-client",
      "transport": "mcp",
      "capabilities": ["registry.read"],
      "endpoint": null,
      "note": "",
      "registeredAt": "2026-11-17T11:56:07.976Z",
      "lastSeenAt": "2026-11-17T11:56:07.976Z"
    }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `version` | yes | Schema version. `1` today. Bumps only on breaking change. |
| `root` | yes | Written by the CLI; informational, not authoritative for lookups |
| `updatedAt` | yes | Last write, ISO-8601 |
| `endpoints[]` | yes | May be empty |
| `endpoints[].kind` | yes | `env \| skill \| mcp \| acp \| a2a` |
| `endpoints[].name` | yes | Unique **within** a kind |
| `endpoints[].transport` | yes | `local \| filesystem \| stdio \| http \| sse` |
| `endpoints[].description` | no | Free text, shown in tables |
| `endpoints[].registeredAt` | no | ISO-8601 |
| `agents[]` | yes | May be empty |

## Identity

`(kind, name)` is the key. `node` as an `env` and `node` as a `skill` are two
different rows; registering either twice updates in place.

Consequences worth knowing:

- Registration is idempotent by construction — no dedupe pass needed.
- Renaming means register-new + unregister-old; there is no rename verb.
- Unknown fields on an entry are preserved on update, so a newer writer does not
  destroy metadata an older one does not understand.

## Per-kind fields

| Kind | Required | Optional | Example |
|---|---|---|---|
| `env` | `command` | `args`, `version` | `{"kind":"env","name":"node","transport":"local","command":"C:\\Program Files\\nodejs\\node.exe"}` |
| `skill` | `path` | `entry`, `description` | `{"kind":"skill","name":"fit-protocol","transport":"filesystem","path":"C:\\Users\\me\\.agents\\skills\\fit-protocol"}` |
| `mcp` | `command` (stdio) or `url` (http) | `args`, `env`, `description` | `{"kind":"mcp","name":"github","transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-github"]}` |
| `acp` | `command` | `args`, `env` | `{"kind":"acp","name":"zed","transport":"stdio","command":"/opt/zed-agent"}` |
| `a2a` | `url` | `description` | `{"kind":"a2a","name":"researcher","transport":"http","url":"https://example.com"}` |

For `mcp` over HTTP, `url` points at the JSON-RPC endpoint; `probe` POSTs
`initialize` to it.

## Agents

`agents[]` answers "who is attached", not "who is allowed".

- Registration records `name`, `transport`, `capabilities`, optional `endpoint`.
- It is **not** authentication: anyone with write access to the file can claim any
  name. Trust boundaries stay with the transport — stdio is local, HTTP should be
  firewalled.
- Re-registering the same `name` updates the record and keeps its `id`, so an agent
  that restarts does not accumulate duplicates.
- `fit list --agents` and the MCP tool `fit_doctor` both report the count.

## Hand editing

The file is plain JSON and may be edited by hand. Two rules:

1. Keep `(kind, name)` unique per kind.
2. Run `fit doctor` afterwards — it flags entries whose target is missing.

```bash
fit doctor
# broken      skill/old-skill, env/pnpm
```

`doctor` checks `skill` entries for an existing `SKILL.md` and `env` entries for a
resolvable command. It does **not** spawn `mcp`/`acp`/`a2a` endpoints (that is what
`probe` is for, and it can be slow or have side effects).

## Portability

- The Registry travels with the machine; endpoint paths are absolute and often
  machine-specific.
- After moving Root or reinstalling tools, re-run `fit discover --env --save`;
  `fit doctor` lists what broke in the meantime.
- Nothing in the Registry is secret. Do not put tokens in `env` — use your
  operating system's secret store and reference it from the server's own config.

## Concurrency

There is no file lock. Two simultaneous `register` calls can lose one update. Treat
the Registry as a single-user local file; if you need concurrent writers, serialise
them (one job, or a mutex in your orchestration layer).

## Versioning

`version` describes the **schema**, not the product. Adding a field or a kind is
compatible and does not bump it; changing identity or removing a required field
does, and ships with a migration note.
