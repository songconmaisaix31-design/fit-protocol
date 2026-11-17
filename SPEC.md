# FIT Protocol v0.1

**Fully Integrated Toolchain** — a filesystem convention for keeping a developer
machine's runtimes, package caches, and tool entrypoints in exactly one place.

| | |
|---|---|
| Status | Draft (v0.1) |
| Scope | Developer workstations; Windows-first, portable to Linux/macOS |
| Normative language | MUST / SHOULD / MAY per RFC 2119 |
| Reference implementation | `scripts/setup-env.ps1`, `scripts/tools.ps1` in this repo |

---

## 1. Why a protocol

Every machine drifts the same way: a second Node appears next to the first; every
checkout grows its own `node_modules` and `.venv`; npm, pnpm, uv, pip and Go each
keep a private cache; utility scripts land wherever the author happened to be
standing. Nothing here is a tooling failure — it is the absence of a *place*.

FIT fixes the place. It does not prescribe which tools you use; it prescribes
where they live and how many copies may exist.

## 2. Terminology

**Root** — a single directory that contains everything below. MUST be a local
filesystem path, MUST NOT contain spaces, SHOULD be on a data volume rather than
the system volume.

**Store** — `<Root>/mise`. Holds installed runtime versions. A runtime version is
installed at most once per machine.

**Cache** — `<Root>/cache`. Content-addressed package caches, shared by every
project on the machine.

**Entry** — `<Root>/tools/tools.ps1` (reference implementation). The only command
a user needs to remember to discover and invoke managed tools.

**Project** — any repository or working copy. A project MUST NOT own a private
runtime or a private package cache.

**Wiring** — the shell-level configuration (PATH, environment variables, shell
profile) that makes Root visible to a new terminal.

## 3. Layout

A conforming installation has exactly this shape (names are normative):

```
<Root>/
├── mise.toml          # single source of truth for toolchain + env
├── mise/              # Store
├── cache/             # Cache
│   ├── npm/
│   ├── pnpm/
│   ├── uv/
│   ├── pip/
│   └── go/{mod,build}/
└── tools/             # Entry
    └── tools.ps1
```

A project MAY add a project-level `mise.toml` and `tools/` entry, but those MUST
delegate to Root for runtimes and caches rather than duplicating them.

## 4. Invariants

An installation is conforming only if **all** of the following hold.

**I1 — Single root.** Runtimes, caches, and the entry live under one directory.
No managed artifact is stored outside it except OS-level installs that FIT
explicitly reuses.

**I2 — Single store.** For each runtime and version there is at most one
installed copy on the machine. Reusing an OS-provided runtime satisfies I2;
installing a second copy to "keep things clean" violates it.

**I3 — Shared cache.** All package managers resolve their cache into `Cache`.
Removing a project's dependency directory MUST NOT require a fresh download,
because the content still exists in Cache.

**I4 — Single entry.** Every managed tool is discoverable and invocable through
Entry. Adding a tool MUST update Entry rather than adding a new top-level script
directory.

**I5 — Idempotent setup.** Running the setup procedure twice produces the same
state as running it once. Existing files MUST NOT be overwritten without an
explicit flag.

**I6 — Non-destructive by default.** Setup MUST NOT delete. Any destructive
operation MUST require an explicit opt-in (reference implementation: `-Apply`)
and MUST print the paths it will affect before acting.

**I7 — Relocatable.** Root is moved or renamed by changing the root path and
re-running setup. No absolute path may be baked into a project; project files
reference Root through environment variables or relative paths only.

**I8 — Verifiable.** Conformance is checkable without reading documentation, via
the checks in §5.

## 5. Conformance levels

### L1 — Discoverable

| Check | Requirement |
|---|---|
| `tools list` | Lists every managed tool with its resolved absolute path |
| Duplicate detection | For each language, at most one runtime path is reported |

### L2 — Consolidated

| Check | Requirement |
|---|---|
| `tools doctor` | Prints Store and Cache locations; all resolve under Root |
| Cache binding | Each package manager's effective cache path is under `<Root>/cache` |
| Idempotence | Second setup run reports no changes |

### L3 — Reproducible

| Check | Requirement |
|---|---|
| Cold rebuild | Deleting a project's dependency directory and reinstalling produces no network fetch for already-cached packages |
| Fresh shell | A newly opened shell resolves Entry without manual export |
| Relocation | Moving Root and re-running setup leaves all checks passing |

A tool may claim L1 while migrating. Claim no level you have not run the checks for.

## 6. Adoption procedure

1. **Audit.** Enumerate installed runtimes and caches. Record which are duplicates.
   Do not delete anything yet.
2. **Choose Root.** Same volume as projects, no spaces, ≥ 20 GB free.
3. **Create the skeleton and bind caches.** Directory layout from §3, user-level
   environment variables, package-manager config files. Package manager configs
   that lack a trailing newline MUST be rewritten whole, not appended to.
4. **Install the entry.** `tools.ps1` derives Root from its own location, so Root
   stays relocatable (I7).
5. **Wire the shells.** Every shell the user actually opens. On Windows this is
   two profiles, not one; preserve unrelated user functions when editing.
6. **Verify.** Run §5 checks, then open a *new* terminal and repeat — environment
   changes apply to new processes only.

## 7. Portability and migration

- Copy or clone Root to the new location; do not copy by exporting environment
  variables alone.
- Re-run setup at the new path. Environment variables are machine-local and MUST
  be rewritten, not assumed.
- Pinned versions in `mise.toml` travel with Root; installed artifacts need not.
  A fresh `mise install` restores them from the store definition.
- Never migrate by symlinking Root across volumes — it defeats I2 and breaks
  package cache hardlinks.

## 8. Non-conformance (anti-patterns)

| Pattern | Broken invariant |
|---|---|
| Root on the system volume, filling it until the OS complains | I1 (pragmatic) |
| Deleting existing runtimes to "start clean", then reinstalling all of them | I2 |
| Clearing caches without first binding them to a shared location | I3 |
| Each project carrying its own `scripts/` of one-off utilities | I4 |
| Setup that overwrites `~/.npmrc`, shell profiles, or an existing install | I5 |
| "Cleanup" that deletes before checking whether the data exists elsewhere | I6 |
| Hard-coded `D:\env` inside project files | I7 |
| Claiming conformance from documentation rather than running §5 checks | I8 |

## 9. Versioning

The layout and invariants are the stable surface. Adding a cache subdirectory or a
new `tools` subcommand is a compatible change. Renaming a normative path, or
weakening an invariant, requires a minor-version bump and a migration note.

## 10. Reference

- `scripts/setup-env.ps1` — implements steps 2–5 of §6, idempotent, `-WhatIf` preview.
- `scripts/tools.ps1` — implements §5 checks (`list`, `doctor`) and `clean`.
- `assets/repo-template/` — project-level layering (§3, last paragraph).
- `references/windows-gotchas.md` — verification pitfalls that produce false passes.
- `evals/trigger-eval.json` — routing eval set for the accompanying agent skill.
