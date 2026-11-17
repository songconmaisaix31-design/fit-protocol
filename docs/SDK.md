# SDKs

Two SDKs, one contract. The JavaScript one runs in-process against the same core
the CLI uses; the Python one shells out to the CLI's `--json` output. That is
deliberate: reimplementing the file format in a second language is how two
"registries" appear where there should be one (SPEC I9).

## JavaScript (in-process)

```js
import { Fit } from 'fit-protocol';        // or: import { Fit } from './sdk/js/index.mjs'

const fit = new Fit({ root: 'D:\\env' });   // root optional: $FIT_ROOT → D:\env → ~/.fit
```

| Method | Returns | Notes |
|---|---|---|
| `list(kind?)` | `Endpoint[]` | sorted by kind then name |
| `resolve(name, kind?)` | `Endpoint \| null` | |
| `register(entry)` | `Endpoint` | upserts by `(kind, name)`, saves immediately |
| `unregister(name, kind?)` | `number` | rows removed |
| `registerAgent({ name, transport?, capabilities? })` | `Agent` | idempotent per name |
| `agents()` | `Agent[]` | |
| `probe(name, kind?)` | `Promise<ProbeResult>` | performs the real handshake |
| `stats()` | `{ root, file, total, byKind, agents }` | same as `fit doctor --json` |
| `discover({ env?, skills?, mcp?, agents? })` | `Endpoint[]` | **does not save** |

`root` is read-only after construction; construct a new `Fit` to switch roots.

```js
const fit = new Fit();
const agent = fit.registerAgent({ name: 'my-agent', capabilities: ['registry.read'] });

for (const s of fit.list('skill')) console.log(s.name, s.path);

const probe = await fit.probe('fit-hub');
if (!probe.ok) console.error('hub is down:', probe.error);
```

Errors: write methods throw on a malformed entry (unknown kind); `probe` rejects
only when the endpoint cannot be found — a failed handshake resolves to
`{ ok: false, error }`, because "the server is broken" is data, not an exception.

## Python (subprocess)

```python
import sys
sys.path.insert(0, "sdk/py")
from fit_sdk import Fit, FitError

fit = Fit(root=r"D:\env")          # or FIT_ROOT env var
fit.register_agent("my-agent", capabilities=["registry.read"])
for ep in fit.list(kind="skill"):
    print(ep["name"])
print(fit.probe("node"))
```

| Method | Returns |
|---|---|
| `list(kind=None)` | `list[dict]` |
| `resolve(name, kind=None)` | `dict` |
| `probe(name, kind=None)` | `dict` |
| `stats()` | `dict` |
| `register(kind, name, **fields)` | `dict` — kwargs map to `--flag` |
| `register_agent(name, capabilities=None, transport="python-sdk")` | `dict` |
| `unregister(name, kind=None)` | `dict` |
| `agents()` | `list[dict]` |

A non-zero exit from the CLI raises `FitError` with stderr attached.

```python
try:
    fit.register("mcp", "github", command="npx", args=["-y", "@modelcontextprotocol/server-github"])
except FitError as exc:
    print("registration failed:", exc)
```

`Fit(..., fit_bin="...")` points at a different `bin/fit.mjs`; `Fit(..., node="...")`
picks a specific interpreter. `Fit.available()` reports whether `node` is on `PATH`.

## Choosing a surface

| Situation | Use |
|---|---|
| Node agent, same process, lowest latency | JS SDK |
| Python agent | Python SDK (or subprocess `fit --json` yourself) |
| Shell, CI, cron | CLI |
| Agent already speaks MCP | [MCP](MCP.md) — no SDK needed |
| Remote agent, another machine | HTTP/A2A ([Protocols](PROTOCOLS.md)) |

## Writing a third SDK

The contract is smaller than it looks:

1. Run `fit <command> --json`.
2. Parse stdout as JSON.
3. Treat non-zero exit as an error with stderr as the message.

That is the whole Python SDK. Anything that can spawn a process and parse JSON can
be an SDK — the file format stays owned by `core/registry.mjs`.
