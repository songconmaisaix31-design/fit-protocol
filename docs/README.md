# Documentation

Every feature has its own page. Start where your task is.

| Doc | Covers | Read it when |
|---|---|---|
| [CLI](CLI.md) | `fit init / discover / register / agent / list / resolve / probe / call / doctor / serve` | you want to drive the hub from a shell or script |
| [Registry](REGISTRY.md) | `fit.json` schema, endpoint kinds, identity rules, hand editing | you need to understand or repair what is registered |
| [MCP](MCP.md) | the six MCP tools, transports, client config | you are attaching an agent that speaks MCP |
| [SDK](SDK.md) | JavaScript (in-process) and Python (subprocess) APIs | you are writing an agent runtime |
| [Environment](ENVIRONMENT.md) | the v0.1 half: root, store, cache, setup script, `tools.ps1` | you are consolidating runtimes and package caches |
| [Protocols](PROTOCOLS.md) | surfaces vs. endpoint kinds, parity table, non-goals | you need the big picture or want to know what is *not* implemented |
| [Automation](AUTOMATION.md) | the CI and demo workflows, how the README animation is produced | you changed the CLI and the demo looks stale |

Normative specification: [SPEC.md](../SPEC.md). Bilingual overview: [README](../README.md).

## Reading order for a first setup

1. [Environment](ENVIRONMENT.md) — create the root, bind the caches, wire the shells.
2. [Registry](REGISTRY.md) — what the hub now knows.
3. [CLI](CLI.md) — seed it (`discover`) and verify it (`probe`).
4. [MCP](MCP.md) or [SDK](SDK.md) — attach an agent.
5. [Protocols](PROTOCOLS.md) — if you need ACP/A2A or want the parity rules.
