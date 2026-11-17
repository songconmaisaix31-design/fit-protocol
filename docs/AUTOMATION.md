# Automation

Two workflows, both in `.github/workflows/`.

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | push to `main`, PR, manual | runs `npm test` (12 end-to-end checks) on Node 20 and 22 |
| `demo.yml` | push touching code, daily 03:17 UTC, manual | regenerates `assets/demo/fit-demo.svg` and commits it back |

## The README animation

The terminal card at the top of [README](../README.md) is **not a screenshot and not
a hand-written mock-up**. `tools/make-demo-svg.mjs` runs the real CLI in a throwaway
registry, captures what came back, and renders it as an animated SVG.

```
fit init
fit register env node --command node
fit register mcp fit-hub --command node --args bin/fit.mjs,serve,mcp
fit list
fit probe fit-hub          ← real MCP initialize + tools/list
fit serve mcp              ← real MCP call, count comes from fit_doctor
```

So if `fit list` starts printing a new column, the next `demo.yml` run shows it. If
the CLI breaks, the animation is what breaks first — which is the point.

What is *not* real: the registry lives in a temp directory, so paths are rendered as
`<demo-root>` rather than a runner-specific absolute path. Everything else — counts,
table layout, probe results, tool names — comes from the run.

### Preview locally

```bash
node tools/make-demo-svg.mjs
# wrote assets/demo/fit-demo.svg (16 lines, 2 endpoints)
```

Open the file in a browser, or push it and view the rendered README. It is plain SVG
with CSS keyframes; GitHub renders it as an image (scripts stripped, animation kept).

### Change the look

Edit `tools/make-demo-svg.mjs`:

| What | Where |
|---|---|
| Palette | `color` map + the `bg`/`accent` gradients in the `<defs>` |
| Timing | `delay = 0.35 + i * 0.42` — per-line stagger |
| Card size | `W`, `lineH`, `top` |
| Caption | the last `<text class="pulse">` |
| Which lines appear | the `lines` array in `main()` |

Keep the line count stable-ish: the height is computed, but very long lines are
clipped at 88 characters.

### Why commit it back

GitHub serves the SVG from the repository, so it must exist in the tree. Committing
the generated file keeps the README working without a Pages deployment or an external
image host, and makes the diff visible when behaviour changes.

`[skip ci]` in the commit message prevents the demo commit from re-triggering CI; the
`concurrency: demo-svg` group prevents two renders racing.

### Requirements

The workflow's token needs write access: repository **Settings → Actions → General →
Workflow permissions → Read and write**. The repository already sets this via
`gh api -X PUT .../actions/permissions/workflow -f default_workflow_permissions=write`.

If a render job fails with `403`, that setting was flipped back to read-only.

## CI

`npm test` runs `test/smoke.mjs`: 12 checks covering CLI, discovery, idempotent
upsert, all five probe kinds against local stubs, the MCP handshake and tool calls,
HTTP health/registry/agent-card/A2A `message/send`, and both SDKs.

The fixtures in `test/fixtures/` are throwaway MCP / ACP / A2A peers — so the suite
does not depend on any network service and never touches a real registry.
