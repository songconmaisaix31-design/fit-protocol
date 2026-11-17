#!/usr/bin/env node
// fit — the CLI surface of the FIT tool hub.
// Zero dependencies; every command has a --json form so agents can parse it.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Registry, resolveRoot, KINDS } from '../core/registry.mjs';
import { discoverEnv, discoverSkills, importMcpConfig, importAgentConfig, findExistingMcpConfig } from '../core/providers.mjs';
import { probe } from '../core/probe.mjs';
import { isWindows, which } from '../core/util.mjs';

const VERSION = '0.2.0';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--') {
      positional.push('--', ...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (argv[i + 1] && !argv[i + 1].startsWith('--')) {
        flags[a.slice(2)] = argv[++i];
      } else {
        flags[a.slice(2)] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function pad(s, n) {
  const str = String(s ?? '');
  // CJK characters occupy two columns; keep table output aligned.
  let width = 0;
  for (const ch of str) width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1;
  return str + ' '.repeat(Math.max(0, n - width));
}

function printTable(rows, columns) {
  if (!rows.length) {
    console.log('(empty)');
    return;
  }
  const widths = columns.map((c) =>
    Math.max(c.header.length, ...rows.map((r) => String(c.get(r) ?? '').length)),
  );
  console.log(columns.map((c, i) => pad(c.header, widths[i])).join('  '));
  console.log(columns.map((_, i) => '-'.repeat(widths[i])).join('  '));
  for (const r of rows) {
    console.log(columns.map((c, i) => pad(c.get(r), widths[i])).join('  '));
  }
}

function openRegistry(flags) {
  const root = resolveRoot(flags.root);
  return new Registry(root).load();
}

function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function usage() {
  console.log(`fit ${VERSION} — multi-surface tool registry

Usage:
  fit init [--root DIR]
  fit discover [--env] [--skills DIR] [--mcp FILE] [--agents FILE] [--save] [--json]
  fit register <kind> <name> [--transport T] [--command C] [--args A,B] [--url U] [--path P] [--description D]
  fit agent register <name> [--transport mcp|cli|http] [--capabilities a,b] [--endpoint E]
  fit unregister <name> [--kind K]
  fit list [--kind K] [--agents] [--json]
  fit resolve <name> [--json]
  fit probe <name> [--json]
  fit call <name> [-- args...]
  fit doctor [--json]
  fit serve mcp
  fit serve http [--port 7777]

Kinds: ${KINDS.join(' | ')}
Global: --root DIR (default: $FIT_ROOT, else D:\\env, else ~/.fit)   --json   --help   --version`);
}

async function cmdInit(flags) {
  const reg = openRegistry(flags);
  reg.save();
  if (flags.json) return console.log(JSON.stringify(reg.stats(), null, 2));
  console.log(`initialised ${reg.file}`);
  console.log(`root: ${reg.root}`);
}

async function cmdDiscover(flags) {
  const reg = openRegistry(flags);
  const found = [];
  if (flags.env || (!flags.skills && !flags.mcp && !flags.agents)) {
    found.push(...discoverEnv());
  }
  if (flags.skills || (!flags.env && !flags.mcp && !flags.agents)) {
    const dir = flags.skills || join(homedir(), '.agents', 'skills');
    found.push(...discoverSkills(dir));
  }
  if (flags.mcp) found.push(...importMcpConfig(flags.mcp));
  else if (!flags.env && !flags.skills && !flags.agents) {
    const auto = findExistingMcpConfig();
    if (auto) found.push(...importMcpConfig(auto));
  }
  if (flags.agents) found.push(...importAgentConfig(flags.agents));

  if (flags.save) {
    for (const e of found) reg.upsert(e);
    reg.save();
  }

  if (flags.json) {
    console.log(JSON.stringify({ saved: Boolean(flags.save), count: found.length, entries: found }, null, 2));
    return;
  }
  printTable(found, [
    { header: 'kind', get: (r) => r.kind },
    { header: 'name', get: (r) => r.name },
    { header: 'transport', get: (r) => r.transport },
    { header: 'target', get: (r) => r.url || r.entry || r.path || r.command || '' },
  ]);
  console.log(`\n${found.length} discovered${flags.save ? ' and saved' : ' (dry run — add --save)'}`);
}

async function cmdRegister(positional, flags) {
  const [kind, name] = positional;
  if (!kind || !name) fail('usage: fit register <kind> <name> [flags]');
  if (!KINDS.includes(kind)) fail(`unknown kind "${kind}" (expected ${KINDS.join(', ')})`);
  const reg = openRegistry(flags);
  const entry = {
    kind,
    name,
    transport: flags.transport || (kind === 'skill' ? 'filesystem' : kind === 'a2a' ? 'http' : kind === 'env' ? 'local' : 'stdio'),
    description: flags.description || '',
  };
  if (flags.command) entry.command = flags.command;
  if (flags.args) entry.args = String(flags.args).split(',');
  if (flags.url) entry.url = flags.url;
  if (flags.path) entry.path = flags.path;
  if (flags.entry) entry.entry = flags.entry;
  if (flags.capabilities) entry.capabilities = String(flags.capabilities).split(',');
  const saved = reg.upsert(entry);
  reg.save();
  if (flags.json) return console.log(JSON.stringify(saved, null, 2));
  console.log(`registered ${saved.kind}/${saved.name} → ${reg.file}`);
}

async function cmdAgentRegister(positional, flags) {
  const [name] = positional;
  if (!name) fail('usage: fit agent register <name>');
  const reg = openRegistry(flags);
  const agent = reg.registerAgent({
    name,
    transport: flags.transport || 'mcp',
    capabilities: flags.capabilities ? String(flags.capabilities).split(',') : undefined,
    endpoint: flags.endpoint || null,
    note: flags.note || '',
  });
  reg.save();
  if (flags.json) return console.log(JSON.stringify(agent, null, 2));
  console.log(`agent registered: ${agent.name} (${agent.id})`);
  console.log(`capabilities: ${agent.capabilities.join(', ')}`);
  console.log('it can now call: fit list / fit resolve / fit probe / fit serve mcp');
}

async function cmdUnregister(positional, flags) {
  const [name] = positional;
  if (!name) fail('usage: fit unregister <name> [--kind K]');
  const reg = openRegistry(flags);
  const removed = reg.remove(name, flags.kind);
  reg.save();
  if (flags.json) return console.log(JSON.stringify({ removed }, null, 2));
  console.log(removed ? `removed ${removed} entr${removed === 1 ? 'y' : 'ies'}` : 'nothing matched');
}

async function cmdList(flags) {
  const reg = openRegistry(flags);
  if (flags.agents) {
    const agents = reg.data.agents;
    if (flags.json) return console.log(JSON.stringify(agents, null, 2));
    printTable(agents, [
      { header: 'name', get: (a) => a.name },
      { header: 'transport', get: (a) => a.transport },
      { header: 'capabilities', get: (a) => (a.capabilities || []).join(',') },
      { header: 'registered', get: (a) => a.registeredAt },
    ]);
    return;
  }
  const rows = reg.list({ kind: flags.kind });
  if (flags.json) return console.log(JSON.stringify(rows, null, 2));
  printTable(rows, [
    { header: 'kind', get: (r) => r.kind },
    { header: 'name', get: (r) => r.name },
    { header: 'transport', get: (r) => r.transport },
    { header: 'target', get: (r) => r.url || r.command || r.path || '' },
    { header: 'description', get: (r) => (r.description || '').slice(0, 60) },
  ]);
  const s = reg.stats();
  console.log(`\n${s.total} endpoints · ${KINDS.map((k) => `${k}=${s.byKind[k] || 0}`).join(' ')} · ${s.agents} agent(s)`);
}

async function cmdResolve(positional, flags) {
  const [name] = positional;
  if (!name) fail('usage: fit resolve <name>');
  const reg = openRegistry(flags);
  const entry = reg.find(name, flags.kind);
  if (!entry) fail(`not found: ${name}`);
  if (flags.json) return console.log(JSON.stringify(entry, null, 2));
  for (const [k, v] of Object.entries(entry)) {
    if (v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
    console.log(`${k.padEnd(14)} ${Array.isArray(v) ? v.join(' ') : v}`);
  }
}

async function cmdProbe(positional, flags) {
  const [name] = positional;
  if (!name) fail('usage: fit probe <name>');
  const reg = openRegistry(flags);
  const entry = reg.find(name, flags.kind) || (name === '*' ? null : null);
  if (!entry) fail(`not found: ${name}`);
  let result;
  try {
    result = await probe(entry);
  } catch (e) {
    result = { ok: false, error: e.message };
  }
  if (flags.json) return console.log(JSON.stringify({ entry, result }, null, 2));
  console.log(`${entry.kind}/${entry.name}: ${result.ok ? 'OK' : 'FAIL'}`);
  for (const [k, v] of Object.entries(result)) {
    if (k === 'ok') continue;
    console.log(`  ${k.padEnd(15)} ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`);
  }
  if (!result.ok) process.exitCode = 1;
}

async function cmdCall(positional, flags) {
  const sep = positional.indexOf('--');
  const name = sep === -1 ? positional[0] : positional[0];
  const passthrough = sep === -1 ? positional.slice(1) : positional.slice(sep + 1);
  if (!name) fail('usage: fit call <name> [-- args...]');
  const reg = openRegistry(flags);
  const entry = reg.find(name, flags.kind);
  if (!entry) fail(`not found: ${name}`);
  if (entry.kind !== 'env') {
    fail(`fit call only runs env endpoints; use "fit probe ${name}" or "fit resolve ${name}" for ${entry.kind}`);
  }
  const cmd = which(entry.command) || entry.command;
  const shell = isWindows && /\.(cmd|bat|ps1)$/i.test(cmd);
  const child = spawn(cmd, passthrough, { stdio: 'inherit', shell, windowsHide: true });
  child.on('close', (code) => process.exit(code ?? 0));
}

async function cmdDoctor(flags) {
  const reg = openRegistry(flags);
  const stats = reg.stats();
  const broken = [];
  for (const e of reg.list()) {
    if (e.kind === 'skill') {
      if (!existsSync(e.entry || e.path || '')) broken.push(e);
    } else if (e.kind === 'env') {
      if (!which(e.command)) broken.push(e);
    }
  }
  const report = { ...stats, broken: broken.map((b) => `${b.kind}/${b.name}`) };
  if (flags.json) return console.log(JSON.stringify(report, null, 2));
  console.log(`root        ${stats.root}`);
  console.log(`registry    ${stats.file}${stats.exists ? '' : ' (not created yet — run fit init)'}`);
  console.log(`endpoints   ${stats.total}  (${KINDS.map((k) => `${k}=${stats.byKind[k] || 0}`).join(' ')})`);
  console.log(`agents      ${stats.agents}`);
  console.log(`broken      ${broken.length ? broken.map((b) => `${b.kind}/${b.name}`).join(', ') : 'none'}`);
  if (broken.length) process.exitCode = 1;
}

async function cmdServe(positional, flags) {
  const [surface] = positional;
  const reg = openRegistry(flags);
  if (surface === 'mcp') {
    const { serveMcp } = await import('../adapters/mcp-server.mjs');
    await serveMcp(reg);
    return;
  }
  if (surface === 'http') {
    const { serveHttp } = await import('../adapters/http-server.mjs');
    await serveHttp(reg, { port: Number(flags.port || 7777) });
    return;
  }
  fail('usage: fit serve mcp | fit serve http [--port 7777]');
}

async function main() {
  const argv = process.argv.slice(2);
  const { positional, flags } = parseArgs(argv);

  if (flags.version || positional[0] === 'version') return console.log(VERSION);
  if (flags.help || positional.length === 0 || positional[0] === 'help') return usage();

  const command = positional[0];
  const rest = positional.slice(1);

  switch (command) {
    case 'init': return cmdInit(flags);
    case 'discover': return cmdDiscover(flags);
    case 'register': return cmdRegister(rest, flags);
    case 'agent':
      if (rest[0] === 'register') return cmdAgentRegister(rest.slice(1), flags);
      return fail('usage: fit agent register <name>');
    case 'unregister': return cmdUnregister(rest, flags);
    case 'list':
    case 'ls': return cmdList(flags);
    case 'resolve': return cmdResolve(rest, flags);
    case 'probe': return cmdProbe(rest, flags);
    case 'call': return cmdCall(rest, flags);
    case 'doctor': return cmdDoctor(flags);
    case 'serve': return cmdServe(rest, flags);
    default: return fail(`unknown command "${command}" — try: fit --help`);
  }
}

main().catch((e) => {
  console.error(`fatal: ${e.stack || e.message}`);
  process.exit(1);
});
