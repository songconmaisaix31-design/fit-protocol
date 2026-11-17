# FIT Protocol

**F**ully **I**ntegrated **T**oolchain — one root directory for every runtime, package cache, and tool entrypoint on a developer machine.

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Spec](https://img.shields.io/badge/spec-v0.1-blue.svg)](SPEC.md)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey.svg)](#compatibility)
[![PowerShell](https://img.shields.io/badge/PowerShell-5.1%2B-5391FE.svg?logo=powershell&logoColor=white)](#requirements)

---

## At a glance

| | |
|---|---|
| **Problem** | Runtimes installed N times, dependencies downloaded N times, tools scattered across N directories |
| **Fix** | One root, one store, one cache, one entry — enforced by eight invariants |
| **Cost** | One directory, five environment variables, two shell profiles |
| **Not** | A package manager, a container runtime, or a cleanup tool that deletes things |

```powershell
git clone https://github.com/songconmaisaix31-design/fit-protocol.git
pwsh -File fit-protocol/scripts/setup-env.ps1 -Root D:\env -WhatIf   # preview
pwsh -File fit-protocol/scripts/setup-env.ps1 -Root D:\env           # apply
tools list                                                            # in a new terminal
```

---

## Contents

- [The drift](#the-drift)
- [The idea](#the-idea)
- [Quickstart](#quickstart)
- [What you get](#what-you-get)
- [Verify conformance](#verify-conformance)
- [Use it inside a repository](#use-it-inside-a-repository)
- [Use it as an agent skill](#use-it-as-an-agent-skill)
- [Design decisions](#design-decisions)
- [Compatibility](#compatibility)
- [中文速览](#中文速览)
- [Repository layout](#repository-layout)
- [Status](#status)
- [License](#license)

---

## The drift

Three symptoms show up on almost every machine that has been used for a year:

```text
C:\Program Files\nodejs\      ← node 24
C:\node-win-x64\              ← node 22, forgotten
C:\Users\me\project-a\.venv\  ← python 3.13 + 800 MB of packages
C:\Users\me\project-b\.venv\  ← the same packages again
C:\Users\me\AppData\Local\npm-cache\      ← cache #1
C:\Users\me\AppData\Local\pnpm\store\     ← cache #2
C:\Users\me\AppData\Local\uv\cache\       ← cache #3
C:\Users\me\project-a\scripts\fix.ps1     ← tool, location 1
C:\Users\me\project-b\tools\fix.ps1       ← same tool, location 2
```

None of this is a tooling failure. It is the absence of a **place**. Without a
fixed location, every install defaults to "next to me", every project defaults to
"my own copy", and every script defaults to "wherever I was standing".

Cleaning up does not fix it. The drift returns the moment the next project starts,
because nothing changed about *where things go*.

## The idea

FIT prescribes the place, not the tools. Four nouns carry the whole protocol:

| Noun | Path | Rule |
|---|---|---|
| **Root** | `<Root>` | Everything lives under it. Local disk, no spaces. |
| **Store** | `<Root>/mise` | Each runtime version exists **at most once**. |
| **Cache** | `<Root>/cache` | Every package manager resolves here. Content-addressed. |
| **Entry** | `<Root>/tools/tools.ps1` | The one command you have to remember. |

Plus eight invariants — single root, single store, shared cache, single entry,
idempotent setup, non-destructive by default, relocatable, verifiable — spelled
out normatively in [SPEC.md](SPEC.md#4-invariants).

The practical consequence: **deleting a project's `node_modules` and reinstalling
it should not hit the network.** If it does, the cache is not actually shared,
and the protocol is not actually implemented.

## Quickstart

### Requirements

- PowerShell 5.1 (built into Windows) or PowerShell 7+
- [mise](https://mise.jdx.dev) — installed automatically with `-InstallMise`, or `winget install jdx.mise`
- ~20 GB free on the target volume

### 1. Preview

```powershell
pwsh -File scripts/setup-env.ps1 -Root D:\env -WhatIf
```

`-WhatIf` prints every directory and variable it would touch and writes nothing.

### 2. Apply

```powershell
pwsh -File scripts/setup-env.ps1 -Root D:\env -InstallMise -WireProfile
```

| Flag | Effect |
|---|---|
| `-Root` | Where Root lives. Default `D:\env`. No spaces. |
| `-InstallMise` | Download mise from GitHub Releases into `<Root>\bin` |
| `-WireProfile` | Append a marked block to **both** PowerShell profiles |
| `-SkipEnvVars` | Directory/file work only — useful for testing |
| `-Force` | Overwrite `mise.toml` and `tools.ps1` if they exist |

### 3. Verify in a **new** terminal

```powershell
tools list
tools doctor
```

Environment variables apply to processes created *after* they are set. Verifying
in the shell that set them will show empty values and look like a failure. It is not.

## What you get

```text
D:\env
├── mise.toml          # toolchain + env, single source of truth
├── mise\              # Store — one copy per runtime version
├── cache\             # Cache — npm, pnpm, uv, pip, go
│   ├── npm\  pnpm\  uv\  pip\
│   └── go\{mod,build}\
└── tools\
    └── tools.ps1      # Entry
```

`tools` subcommands:

```powershell
tools list          # every managed tool: name, version, resolved path
tools which node    # which copy actually runs
tools doctor        # store/cache locations, disk, mise health
tools clean         # clear shared caches (safe to re-download)
tools json          # machine-readable catalog
```

`setup-env.ps1` deliberately **reuses runtimes the machine already has** instead
of installing fresh ones. The protocol's goal is fewer copies, not newer copies —
so `mise.toml` ships with `[tools]` commented out, and you opt in to pinning a
version only when you actually need one.

## Verify conformance

FIT is checkable without reading the docs ([SPEC.md §5](SPEC.md#5-conformance-levels)):

| Level | Command | Passes when |
|---|---|---|
| L1 | `tools list` | One runtime path per language, no duplicates |
| L2 | `tools doctor` | Store and cache both resolve under Root |
| L3 | Delete a project's `node_modules`, reinstall | No network fetch for cached packages |

Sample L2 output:

```text
shared root      : D:\env
mise data dir    : D:\env\mise
npm cache        : D:\env\cache\npm
uv cache         : D:\env\cache\uv
pip cache        : D:\env\cache\pip
go mod cache     : D:\env\cache\go\mod

Name FreeGB UsedGB
C      46.7  453.3
D     101.4  350.3

cache\npm           0 MB
cache\pnpm          0 MB
```

Empty caches right after setup are correct — nothing has been downloaded yet.

## Use it inside a repository

A project may layer its own entry on top, as long as runtimes and caches still
come from Root. Copy [`assets/repo-template/`](assets/repo-template) into the
repository root:

```powershell
# .\tools\ws.ps1
.\tools\ws.ps1 doctor      # repo health: python, git, mise
.\tools\ws.ps1 projects    # sub-project size, branch, uncommitted files
.\tools\ws.ps1 clean       # preview removable build output
.\tools\ws.ps1 clean -Apply  # actually remove

# or through mise
mise run doctor
mise run clean
```

The point is not saving keystrokes. It is changing the default: a new utility gets
added to one dispatcher instead of becoming a new `scripts/` directory.

## Use it as an agent skill

This repository is simultaneously a valid agent skill directory — `SKILL.md`,
`scripts/`, `references/`, `assets/` at the root.

```powershell
# copy or symlink the repo into your agent's skills directory
New-Item -ItemType Junction -Path "$env:USERPROFILE\.agents\skills\fit-protocol" `
  -Target "D:\repos\fit-protocol"
```

The skill triggers when a user says things like *"my C: drive is full of node and
python copies"*, *"every project installs its own node_modules"*, or *"give this
repo one tool entrypoint"* — and deliberately **not** for ordinary disk cleanup,
single tool installation, or dependency error troubleshooting.

Routing was validated with a 20-query blind eval
([`evals/trigger-eval.json`](evals/trigger-eval.json)): two independent judges
scored 18/20 and 19/20 on the first description; both misses were the *migration*
and *shell-wiring* cases. After adding those to the description, the third judge
scored 20/20.

## Design decisions

**Reuse, don't reinstall.** Installing node through mise when node is already on
PATH adds a copy and contradicts the goal. `mise.toml` leaves `[tools]` commented
until you have a reason to pin something.

**Non-destructive by default.** `setup-env.ps1` never deletes. Anything that
deletes requires an explicit flag and prints its targets first. Machine setup is
run rarely and often on a machine someone depends on.

**Two profiles, not one.** PowerShell 7 and Windows PowerShell 5.1 read different
profile files. Writing one means the config "disappears" the moment another shell
opens. Existing user functions are preserved; FIT's block is wrapped in
`# >>> env-unify >>>` markers so re-running replaces only that block.

**BOM matters.** PowerShell 5.1 decodes a BOM-less UTF-8 script as ANSI. Chinese
comments then break the parser at a line far from the real cause. Every `.ps1`
here is UTF-8 **with BOM**.

**Measure with disk, not with arithmetic.** Recursive size functions that wrap a
whole loop in one `try/catch` silently drop subtrees and under-report
(a 49 GB directory once measured as 0.03 GB). Use the free-space delta as the
authoritative number. Details in [references/windows-gotchas.md](references/windows-gotchas.md).

## Compatibility

| Platform | Status | Notes |
|---|---|---|
| Windows 10/11 + PowerShell 7 | Supported | Primary target |
| Windows + Windows PowerShell 5.1 | Supported | All scripts tested on both |
| Linux / macOS | Conceptually identical | `setup-env.ps1` is PowerShell-first; layout and invariants carry over |

`setup-env.ps1` requires PowerShell. The protocol itself — layout, invariants,
conformance checks — is shell-agnostic.

## 中文速览

一句话：**一台机器只留一个环境根目录，运行时只装一份、缓存共用一份、工具只从一个入口进。**

```powershell
# 1. 预览（不落盘）
pwsh -File scripts/setup-env.ps1 -Root D:\env -WhatIf

# 2. 执行（顺带装 mise、接好两个 PowerShell profile）
pwsh -File scripts/setup-env.ps1 -Root D:\env -InstallMise -WireProfile

# 3. 新开一个终端再验证（环境变量只对新进程生效）
tools list
tools doctor
```

判断有没有真的做到：**删掉某个项目的 `node_modules` 再装一次，不应该产生下载。**
如果还在下载，说明缓存没真正共享。

完整规范见 [SPEC.md](SPEC.md)，Windows 上的坑见
[references/windows-gotchas.md](references/windows-gotchas.md)。

## Repository layout

```text
fit-protocol/
├── README.md
├── SPEC.md                      # the protocol: terms, invariants, conformance
├── LICENSE                      # MIT
├── SKILL.md                     # agent skill entry (same repo, two audiences)
├── scripts/
│   ├── setup-env.ps1            # idempotent bootstrap, -WhatIf preview
│   └── tools.ps1                # entry: list / which / doctor / clean / json
├── references/
│   └── windows-gotchas.md       # nine reproducible failure modes
├── assets/
│   └── repo-template/           # project-level layering
│       ├── mise.toml
│       └── tools/{ws.ps1,README.md}
└── evals/
    └── trigger-eval.json        # 20-query routing eval set
```

## Status

v0.1 — draft. The layout, the eight invariants, and the conformance checks are
implemented and were exercised on a real machine (two nearly-full volumes, ~130 GB
reclaimed before adoption). Not yet exercised on Linux/macOS.

Planned: a `bash` equivalent of `setup-env.ps1`, and a `tools verify` subcommand
that runs the §5 checks as a single pass/fail.

## License

[MIT](LICENSE) © 2026 Dawei
