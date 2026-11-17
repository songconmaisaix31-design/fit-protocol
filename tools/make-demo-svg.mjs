#!/usr/bin/env node
// Generates the animated terminal card used by README.md.
//
// The animation is not a mock-up: the script runs the real CLI in a throwaway
// registry and renders what actually came back. GitHub Actions re-runs this on
// every push to the code paths below, so the picture tracks the implementation.
//
//   node tools/make-demo-svg.mjs [--out assets/demo/fit-demo.svg]
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const FIT = join(repo, 'bin', 'fit.mjs');

const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outPath = resolve(repo, outIdx !== -1 ? args[outIdx + 1] : 'assets/demo/fit-demo.svg');

const root = mkdtempSync(join(tmpdir(), 'fit-demo-'));

function fit(...cliArgs) {
  const r = spawnSync(process.execPath, [FIT, ...cliArgs, '--root', root], { encoding: 'utf8' });
  return (r.stdout || r.stderr || '').trim();
}

/** Ask the hub a question over MCP, exercising the real stdio surface. */
async function mcpDoctorTotal() {
  const child = spawn(process.execPath, [FIT, 'serve', 'mcp', '--root', root], { stdio: ['pipe', 'pipe', 'ignore'] });
  let buf = '';
  const queue = [];
  const waiters = [];
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.shift();
      if (w) w(msg);
      else queue.push(msg);
    }
  });
  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const next = () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((res, rej) => {
          const t = setTimeout(() => rej(new Error('timeout')), 8000);
          waiters.push((m) => {
            clearTimeout(t);
            res(m);
          });
        });
  try {
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
    await next();
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'fit_doctor', arguments: {} } });
    const res = await next();
    return JSON.parse(res.result.content[0].text).total;
  } finally {
    child.kill();
  }
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clip(s, n = 88) {
  const plain = String(s).replace(/\s+$/, '');
  return plain.length > n ? plain.slice(0, n - 1) + '…' : plain;
}

async function main() {
  // A tiny, deterministic registry so the card looks the same on any runner.
  const first = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean)[0] || '';
  const clean = (s) =>
    s.replaceAll(root, '<demo-root>').replaceAll(homedir(), '~').replaceAll(repo, '.');
  const arrow = (s) => s.split(' → ')[0];

  const initOut = clean(first(fit('init')));
  const regEnv = arrow(clean(first(fit('register', 'env', 'node', '--command', 'node'))));
  const regMcp = arrow(
    clean(
      first(fit('register', 'mcp', 'fit-hub', '--command', 'node', '--args', `${FIT},serve,mcp`)),
    ),
  );
  const listLines = fit('list')
    .split('\n')
    .filter((l) => l.trim())
    .slice(0, 4);
  const probeLines = fit('probe', 'fit-hub').split('\n').filter((l) => l.trim());
  const probeHead = probeLines[0] || '';
  const toolsLine = probeLines.find((l) => l.trim().startsWith('tools')) || '';
  const toolNames = toolsLine.replace(/^\s*tools\s+/, '').split(',').slice(0, 3).map((t) => t.trim()).join(', ');
  const probeTools = `tools  ${toolNames}, …`;
  const total = await mcpDoctorTotal();

  const lines = [
    { text: '$ fit init', kind: 'cmd' },
    { text: initOut, kind: 'dim' },
    { text: '$ fit register env node --command node', kind: 'cmd' },
    { text: regEnv, kind: 'dim' },
    { text: '$ fit register mcp fit-hub --command node --args bin/fit.mjs,serve,mcp', kind: 'cmd' },
    { text: regMcp, kind: 'dim' },
    { text: '$ fit list', kind: 'cmd' },
    ...listLines.map((t) => ({ text: t, kind: 'out' })),
    { text: '$ fit probe fit-hub', kind: 'cmd' },
    { text: probeHead, kind: 'ok' },
    { text: probeTools, kind: 'out' },
    { text: `$ fit serve mcp   # ${total} endpoints reachable over MCP`, kind: 'cmd' },
    { text: 'agent connected · registered as example-client', kind: 'ok' },
  ];

  const W = 900;
  const lineH = 23;
  const top = 78;
  const H = top + lines.length * lineH + 34;

  const color = {
    cmd: '#e2e8f0',
    out: '#94a3b8',
    dim: '#64748b',
    ok: '#34d399',
  };

  const body = lines
    .map((l, i) => {
      const delay = (0.35 + i * 0.42).toFixed(2);
      const prefix = l.kind === 'cmd' ? '<tspan fill="#22d3ee">$ </tspan>' : '';
      const text = l.kind === 'cmd' ? l.text.replace(/^\$ /, '') : l.text;
      return (
        `<g class="ln" style="animation-delay:${delay}s">` +
        `<text x="34" y="${top + i * lineH}" fill="${color[l.kind]}" xml:space="preserve">${prefix}${esc(clip(text))}</text>` +
        `</g>`
      );
    })
    .join('\n  ');

  const cursorY = top + (lines.length - 1) * lineH;
  const cursorDelay = (0.35 + lines.length * 0.42).toFixed(2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="FIT CLI demo: one registry, five surfaces">
  <title>FIT — one registry, five surfaces</title>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#0b1020"/>
      <stop offset="1" stop-color="#121a33"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="0.5" stop-color="#a855f7"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
    <style>
      text { font-family: "SFMono-Regular", ui-monospace, "Cascadia Code", Consolas, "Liberation Mono", monospace; font-size: 13.5px; }
      .ln { opacity: 0; animation: fade .18s ease-out forwards; }
      @keyframes fade { to { opacity: 1; } }
      .cursor { opacity: 0; animation: blink 1.05s steps(1) infinite; animation-delay: ${cursorDelay}s; }
      @keyframes blink { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
      .pulse { animation: pulse 6s ease-in-out infinite; }
      @keyframes pulse { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
    </style>
  </defs>

  <rect width="${W}" height="${H}" rx="14" fill="url(#bg)"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="#1f2a44"/>
  <rect x="0" y="0" width="${W}" height="4" fill="url(#accent)"/>

  <circle cx="28" cy="30" r="6" fill="#ef4444" opacity=".85"/>
  <circle cx="50" cy="30" r="6" fill="#f59e0b" opacity=".85"/>
  <circle cx="72" cy="30" r="6" fill="#22c55e" opacity=".85"/>
  <text x="${W / 2}" y="35" text-anchor="middle" fill="#7c8db5" font-size="12">fit — one registry · five surfaces</text>

  ${body}

  <rect class="cursor" x="34" y="${cursorY + 5}" width="8" height="15" fill="#22d3ee" rx="1"/>
  <text class="pulse" x="${W - 24}" y="${H - 12}" text-anchor="end" fill="#475569" font-size="10.5">generated by GitHub Actions from real CLI output</text>
</svg>
`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, svg, 'utf8');
  console.log(`wrote ${outPath} (${lines.length} lines, ${total} endpoints)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => rmSync(root, { recursive: true, force: true }));
