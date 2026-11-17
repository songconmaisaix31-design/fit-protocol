# Environment half — root, store, cache

This is the v0.1 layer: making runtimes and package caches exist once. The registry
(v0.2) sits on top and records what is available; it does not replace this.

## Layout

```
<Root>/
├── mise.toml          # toolchain + env, single source of truth
├── mise/              # Store — one copy per runtime version
├── cache/             # Cache — shared by every project
│   ├── npm/  pnpm/  uv/  pip/
│   └── go/{mod,build}/
├── registry/fit.json  # the catalogue (see REGISTRY.md)
└── tools/
    └── tools.ps1      # env-only entry point
```

`<Root>` must be local, space-free in its path, and on a volume with headroom.
`D:\env` is the reference choice.

## `scripts/setup-env.ps1`

| Flag | Effect |
|---|---|
| `-Root DIR` | Target root. Default `D:\env` |
| `-WhatIf` | Print every action, write nothing |
| `-InstallMise` | Download mise from GitHub Releases into `<Root>\bin` |
| `-WireProfile` | Append a marked block to **both** PowerShell profiles |
| `-SkipEnvVars` | Directory/file work only (used by the tests) |
| `-Force` | Overwrite `mise.toml` / `tools.ps1` if present |
| `-Proxy URL` | HTTP proxy for the mise download |

```powershell
pwsh -File scripts/setup-env.ps1 -Root D:\env -WhatIf
pwsh -File scripts/setup-env.ps1 -Root D:\env -InstallMise -WireProfile
```

It creates the skeleton, writes user-level environment variables, generates
`mise.toml`, installs `tools.ps1`, and (optionally) wires both profiles. It never
deletes, and it skips existing files unless `-Force`.

## Environment variables

| Variable | Value |
|---|---|
| `MISE_DATA_DIR` | `<Root>\mise` |
| `MISE_GLOBAL_CONFIG_FILE` | `<Root>\mise.toml` |
| `MISE_SHARED_ROOT` | `<Root>` |
| `npm_config_cache` | `<Root>\cache\npm` |
| `UV_CACHE_DIR` | `<Root>\cache\uv` |
| `PIP_CACHE_DIR` | `<Root>\cache\pip` |
| `GOMODCACHE` / `GOCACHE` | `<Root>\cache\go\{mod,build}` |

pnpm reads its store from `~/.npmrc` (`store-dir=`), not from the environment — the
setup script explains this if the file is missing. Config files without a trailing
newline must be rewritten whole; appending glues keys together.

## `scripts/tools.ps1`

The env-only entry point, independent of `fit`:

```powershell
tools list        # every managed tool, version, resolved path
tools which node  # which copy actually runs
tools doctor      # store/cache locations, disk, mise health
tools clean       # clear shared caches (safe to re-download)
tools json        # machine-readable catalog
```

`tools.ps1` derives `<Root>` from its own location, so the whole root is
relocatable.

## Why reuse instead of install

`mise.toml` ships with `[tools]` commented out. The point of the protocol is *fewer
copies*, not *newer copies* — installing node through mise when node is already on
`PATH` adds a copy and violates I2. Uncomment `[tools]` only when you need to pin a
version:

```toml
[tools]
node   = "24"
python = "3.13"
```

`mise install` then downloads once into `MISE_DATA_DIR`, and every project shares it.

## Verifying

| Level | Check |
|---|---|
| L1 | `tools list` shows one path per language |
| L2 | `tools doctor` reports store/cache under Root; second setup run changes nothing |
| L3 | delete a project's `node_modules`, reinstall, no network fetch for cached packages |

Then open a **new** terminal and repeat — environment changes apply to new processes
only, so verifying in the shell that set them shows empty values and looks like a
failure.

## Windows specifics

Two profiles (PowerShell 7 and Windows PowerShell 5.1) are different files; wiring
one means the config "disappears" in the other shell. Scripts must be UTF-8 **with
BOM** or 5.1 decodes them as ANSI and Chinese comments break the parser. Nine
reproducible pitfalls, including both of these, are documented in
[references/windows-gotchas.md](../references/windows-gotchas.md).

## Project-level layering

Copy [`assets/repo-template/`](../assets/repo-template) into a repository root for a
`ws.ps1` dispatcher and a repo `mise.toml` that inherits the shared store and cache.
