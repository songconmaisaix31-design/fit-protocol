# FIT Protocol v0.2

**Fully Integrated Toolchain** — a filesystem convention plus a shared registry
for keeping a developer machine's runtimes, package caches, tools, skills and
agents in exactly one place, reachable over several protocols.

| | |
|---|---|
| Status | Draft (v0.2) — adds the registry and multi-surface layer |
| Scope | Developer workstations and the agents that run on them |
| Normative language | MUST / SHOULD / MAY per RFC 2119 |
| Reference implementation | `core/`, `bin/fit.mjs`, `adapters/`, `sdk/` in this repo |

---

## 1. Why a protocol

Every machine drifts the same way: a second Node appears next to the first; every
checkout grows its own `node_modules` and `.venv`; npm, pnpm, uv, pip and Go each
keep a private cache; agents are configured against three different protocol
configs that never agree.

v0.1 fixed the filesystem. v0.2 fixes the catalogue: there must be one place that
knows what the machine offers, and every protocol speaks to that place rather than
carrying its own list.

## 2. Terminology

**Root** — a single directory containing everything. Local path, no spaces, on a
data volume.

**Store** — `<Root>/mise`. Installed runtime versions, at most one copy each.

**Cache** — `<Root>/cache`. Content-addressed package caches shared by all projects.

**Endpoint** — one callable thing: an executable (`env`), a skill directory
(`skill`), an MCP server (`mcp`), an ACP agent (`acp`), or an A2A agent (`a2a`).

**Registry** — `<Root>/registry/fit.json`. The single catalogue of endpoints and
of the agents that registered against it.

**Surface** — a way to reach the Registry: CLI, MCP, HTTP/A2A, or an SDK.

**Agent** — a process that registers itself with the Registry and then consumes it.

## 3. Layout

```
<Root>/
├── mise.toml          # toolchain + env, single source of truth
├── mise/              # Store
├── cache/             # Cache  (npm, pnpm, uv, pip, go/{mod,build})
├── registry/
│   └── fit.json       # Registry
└── tools/
    └── tools.ps1      # env-only entry point
```

The reference implementation lives in the repository, not in Root:

```
fit-protocol/
├── bin/fit.mjs        # CLI surface
├── core/              # registry model, discovery, probes
├── adapters/          # mcp-server.mjs, http-server.mjs
├── sdk/{js,py}        # SDK surfaces
└── scripts/           # environment bootstrap (setup-env.ps1, tools.ps1)
```

A project MAY layer its own `mise.toml` and `tools/` on top, delegating runtimes
and caches to Root.

## 4. Invariants

**I1 — Single root.** Managed artifacts live under one directory.

**I2 — Single store.** At most one installed copy per runtime version. Reusing an
OS-provided runtime satisfies I2; installing a second copy to "stay clean" violates it.

**I3 — Shared cache.** Every package manager resolves its cache into `Cache`.
Deleting a project's dependency directory MUST NOT require a download.

**I4 — Single env entry.** Every managed executable is reachable through the env
entry point.

**I5 — Idempotent setup.** Running setup twice equals running it once. Existing
files MUST NOT be overwritten without an explicit flag.

**I6 — Non-destructive by default.** Setup MUST NOT delete. Destructive operations
require explicit opt-in and MUST print affected paths first.

**I7 — Relocatable.** Root moves by changing one path and re-running setup. No
absolute Root path is baked into project files.

**I8 — Verifiable.** Conformance is checkable by command, not by documentation.

**I9 — Single registry.** Every endpoint the machine offers is described in exactly
one Registry file. Surfaces read from it; none keeps a private list.

**I10 — Surface parity.** A capability available on one surface is available on the
others, or the gap is documented in `docs/PROTOCOLS.md`. A registry that answers
over MCP but not over CLI is two registries.

## 5. Registry model

The Registry is JSON, versioned, and human-editable:

```json
{
  "version": 1,
  "root": "D:\\env",
  "updatedAt": "2026-11-17T12:00:00.000Z",
  "endpoints": [
    { "kind": "env",   "name": "node", "transport": "local",      "command": "C:\\Program Files\\nodejs\\node.exe" },
    { "kind": "skill", "name": "fit-protocol", "transport": "filesystem", "path": "C:\\Users\\me\\.agents\\skills\\fit-protocol" },
    { "kind": "mcp",   "name": "github", "transport": "stdio",    "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] },
    { "kind": "acp",   "name": "editor-agent", "transport": "stdio", "command": "/path/to/agent" },
    { "kind": "a2a",   "name": "researcher", "transport": "http", "url": "https://example.com" }
  ],
  "agents": [
    { "id": "agent_ab12cd34", "name": "my-agent", "transport": "mcp",
      "capabilities": ["registry.read"], "registeredAt": "2026-11-17T12:00:00.000Z" }
  ]
}
```

Rules:

- `(kind, name)` is the identity. Registering the same pair again updates in place
  — registration is idempotent by construction.
- `kind` MUST be one of `env | skill | mcp | acp | a2a`.
- `transport` MUST be one of `local | filesystem | stdio | http | sse`.
- Unknown fields MUST be preserved so newer writers do not destroy older metadata.
- `agents` records registrations, not credentials. The Registry is not an identity
  provider; trust stays with the transport.

## 6. Access surfaces

| Surface | Mechanism | Writable |
|---|---|---|
| CLI | `fit <command> [--json]` | yes |
| MCP | stdio JSON-RPC, tools `fit_*` | yes |
| HTTP / A2A | agent card + `message/send` | no (read-only) |
| SDK | in-process (JS) or CLI subprocess (Python) | yes |

Requirements:

- **Parity (I10).** `list`, `resolve`, `register`, `register agent`, `probe`,
  `doctor` MUST be reachable on CLI, MCP, and both SDKs. HTTP MAY be read-only,
  provided the omission is documented.
- **JSON everywhere.** Every CLI command MUST support `--json`; the JSON shape is
  the SDK contract. A CLI whose only output is a table cannot be an SDK.
- **Probing is active.** `probe` MUST perform a real handshake (`initialize` for
  MCP/ACP, agent-card fetch for A2A, `--version` for env) and report failure as
  data, not as a crash.

## 7. Conformance levels

### L1 — Discoverable

| Check | Requirement |
|---|---|
| `tools list` | Every managed tool listed with a resolved path |
| One runtime per language | No duplicate runtime paths |

### L2 — Consolidated

| Check | Requirement |
|---|---|
| `tools doctor` | Store and Cache resolve under Root |
| Cache binding | Each package manager's effective cache is under `Cache` |
| Idempotence | Second setup run reports no changes |

### L3 — Reproducible

| Check | Requirement |
|---|---|
| Cold rebuild | Deleting a project's dependencies and reinstalling fetches nothing cached |
| Fresh shell | A new shell resolves the entry point without manual export |
| Relocation | Moving Root and re-running setup leaves all checks passing |

### L4 — Interoperable

| Check | Requirement |
|---|---|
| Registry exists | `fit doctor` reports a Registry file, not "not created yet" |
| All five kinds supported | Registry accepts `env`, `skill`, `mcp`, `acp`, `a2a` |
| MCP handshake | `fit serve mcp` answers `initialize` and `tools/list` |
| A2A card | `GET /.well-known/agent-card.json` returns a valid card |
| Probe works | `fit probe <name>` performs a real handshake for each kind |
| Parity | Every §6 capability present on every writable surface |

Claim no level you have not run the checks for.

## 8. Adoption procedure

1. **Audit.** Enumerate installed runtimes, caches, skills directories, and MCP
   configs. Delete nothing yet.
2. **Choose Root.** Same volume as projects, no spaces, ≥ 20 GB free.
3. **Create the skeleton and bind caches.** §3 layout, user-level environment
   variables, package-manager config files. Config files lacking a trailing newline
   MUST be rewritten whole, not appended to.
4. **Install the env entry.** It derives Root from its own location (I7).
5. **Wire every shell.** On Windows that is two PowerShell profiles; preserve
   unrelated user functions.
6. **Seed the Registry.** `fit discover --skills <dir> --env --save`, then register
   MCP/ACP/A2A endpoints that discovery cannot infer.
7. **Attach agents.** `fit agent register <name>` per agent, then have it consume
   through its native surface.
8. **Verify.** Run §7 checks, then repeat in a new terminal — environment changes
   apply to new processes only.

## 9. Portability and migration

- Copy Root; do not migrate by symlinking across volumes (breaks I2 and cache hardlinks).
- Re-run setup at the new path: environment variables are machine-local.
- Pinned versions travel in `mise.toml`; installed artifacts do not — `mise install`
  restores them from the Store definition.
- The Registry travels as-is; endpoints holding absolute paths SHOULD be re-discovered
  after a move (`fit discover --save`), and `fit doctor` reports the broken ones.

## 10. Non-conformance

| Pattern | Broken invariant |
|---|---|
| Root on the system volume until the OS complains | I1 |
| Deleting runtimes to "start clean", then reinstalling all of them | I2 |
| Clearing caches without first binding them to a shared location | I3 |
| Each project keeping its own one-off utility scripts | I4 |
| Setup that overwrites `~/.npmrc`, shell profiles, or existing installs | I5 |
| "Cleanup" that deletes before checking the data exists elsewhere | I6 |
| Hard-coded `D:\env` inside project files | I7 |
| Claiming conformance from documentation rather than §7 checks | I8 |
| A second `mcp.json` that duplicates what the Registry already knows | I9 |
| MCP surface exposing tools the CLI cannot | I10 |

## 11. Versioning

Adding a kind, a transport, a surface tool, or a Registry field is compatible.
Renaming a normative path, changing the identity rule, or weakening an invariant
requires a minor bump and a migration note. Registry `version` is independent and
bumps only on breaking schema change.

## 12. Reference

- `bin/fit.mjs` — CLI surface; `--json` on every command.
- `core/registry.mjs` — Registry model and validation.
- `core/providers.mjs` — discovery from PATH, skills dir, `mcp.json`, agent config.
- `core/probe.mjs` — MCP/ACP/A2A handshakes with node builtins only.
- `adapters/mcp-server.mjs` — MCP stdio surface (6 tools).
- `adapters/http-server.mjs` — HTTP + A2A agent card + `message/send`.
- `sdk/js/index.mjs`, `sdk/py/fit_sdk.py` — SDK surfaces.
- `docs/PROTOCOLS.md` — parity table, protocol detail, explicit non-goals.
- `test/smoke.mjs` — 12 end-to-end checks across every surface.
- `scripts/setup-env.ps1`, `scripts/tools.ps1` — environment half (v0.1 surface).
- `references/windows-gotchas.md` — verification pitfalls that produce false passes.
