#!/usr/bin/env node
// Minimal MCP client — shows how an agent consumes the hub.
//
//   node examples/mcp-client.mjs [--root D:\\env]
//
// It starts `fit serve mcp`, performs the MCP handshake, registers itself,
// then reads the shared inventory. No SDK, no dependencies: this is the raw
// protocol, so you can see exactly what an agent has to do.
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const rootArgIndex = process.argv.indexOf('--root');
const root = rootArgIndex !== -1 ? process.argv[rootArgIndex + 1] : undefined;

const child = spawn(
  process.execPath,
  [join(repo, 'bin', 'fit.mjs'), 'serve', 'mcp', ...(root ? ['--root', root] : [])],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);

let buffer = '';
const queue = [];
const waiters = [];
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString();
  let i;
  while ((i = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    const w = waiters.shift();
    if (w) w(msg);
    else queue.push(msg);
  }
});

const send = (obj) => child.stdin.write(JSON.stringify(obj) + '\n');
const next = () =>
  queue.length
    ? Promise.resolve(queue.shift())
    : new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), 8000);
        waiters.push((m) => {
          clearTimeout(t);
          resolve(m);
        });
      });

const call = async (id, name, args = {}) => {
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const res = await next();
  if (res.result?.isError) throw new Error(res.result.content[0].text);
  return JSON.parse(res.result.content[0].text);
};

const main = async () => {
  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'example-client', version: '0.2.0' } },
  });
  const init = await next();
  console.log(`connected to ${init.result.serverInfo.name} v${init.result.serverInfo.version}`);

  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const tools = await next();
  console.log(`tools: ${tools.result.tools.map((t) => t.name).join(', ')}\n`);

  const agent = await call(3, 'fit_register_agent', {
    name: 'example-client',
    transport: 'mcp',
    capabilities: ['registry.read'],
  });
  console.log(`registered as ${agent.name} (${agent.id})`);

  const listed = await call(4, 'fit_list', { kind: 'skill' });
  console.log(`skills in the shared registry: ${listed.count}`);
  for (const e of listed.endpoints.slice(0, 5)) console.log(`  ${e.name}`);

  const doctor = await call(5, 'fit_doctor', {});
  console.log(`\nregistry: ${doctor.total} endpoints · ${doctor.agents} agent(s) · root ${doctor.root}`);

  child.kill();
};

main().catch((e) => {
  console.error(`example failed: ${e.message}`);
  child.kill();
  process.exit(1);
});
