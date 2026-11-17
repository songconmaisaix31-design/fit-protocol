// End-to-end smoke test: every surface (CLI, MCP, HTTP/A2A, SDKs) against a
// throwaway registry root. Run with: node test/smoke.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Registry } from '../core/registry.mjs';
import { probe } from '../core/probe.mjs';
import { serveHttp } from '../adapters/http-server.mjs';
import { Fit } from '../sdk/js/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = dirname(here);
const FIT = join(repo, 'bin', 'fit.mjs');
const FIX = join(here, 'fixtures');

const results = [];
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => results.push({ name, ok: true }))
    .catch((e) => results.push({ name, ok: false, error: e.message }));
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function cli(root, ...args) {
  const r = spawnSync(process.execPath, [FIT, ...args, '--root', root], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`fit ${args.join(' ')} failed: ${r.stderr || r.stdout}`);
  return r.stdout;
}
function cliJson(root, ...args) {
  return JSON.parse(cli(root, ...args, '--json'));
}

function startMcpServer(root) {
  const child = spawn(process.execPath, [FIT, 'serve', 'mcp', '--root', root], { stdio: ['pipe', 'pipe', 'pipe'] });
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
  return {
    send: (obj) => child.stdin.write(JSON.stringify(obj) + '\n'),
    next(timeout = 8000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('MCP response timeout')), timeout);
        waiters.push((m) => {
          clearTimeout(t);
          resolve(m);
        });
      });
    },
    stop: () => child.kill(),
  };
}

async function startStubA2a() {
  const child = spawn(process.execPath, [join(FIX, 'stub-a2a.mjs')], { stdio: ['ignore', 'pipe', 'ignore'] });
  const port = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('a2a stub timeout')), 8000);
    child.stdout.once('data', (d) => {
      clearTimeout(t);
      resolve(Number(d.toString().trim()));
    });
  });
  return { child, url: `http://127.0.0.1:${port}/` };
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'fit-smoke-'));
  console.log(`smoke root: ${root}\n`);

  await check('cli: init creates registry file', () => {
    cli(root, 'init');
    assert(existsSync(join(root, 'registry', 'fit.json')), 'registry/fit.json missing');
  });

  await check('cli: register + list + resolve', () => {
    cli(root, 'register', 'env', 'node', '--command', 'node', '--description', 'node runtime');
    const list = cliJson(root, 'list');
    assert(list.some((e) => e.name === 'node' && e.kind === 'env'), 'node not listed');
    const resolved = cliJson(root, 'resolve', 'node');
    assert(resolved.transport === 'local', 'wrong transport');
  });

  await check('cli: idempotent upsert (no duplicate rows)', () => {
    cli(root, 'register', 'env', 'node', '--command', 'node');
    const list = cliJson(root, 'list');
    assert(list.filter((e) => e.name === 'node' && e.kind === 'env').length === 1, 'duplicate entry');
  });

  await check('cli: register skill + agent, doctor reports both', () => {
    cli(root, 'register', 'skill', 'demo-skill', '--path', FIX, '--entry', join(FIX, 'stub-mcp.mjs'));
    cli(root, 'agent', 'register', 'smoke-agent', '--capabilities', 'registry.read,registry.write');
    const doc = cliJson(root, 'doctor');
    assert(doc.byKind.skill === 1, `skill count ${doc.byKind.skill}`);
    assert(doc.agents === 1, `agent count ${doc.agents}`);
  });

  await check('probe: env endpoint reports a version', async () => {
    const reg = new Registry(root).load();
    const r = await probe(reg.find('node'));
    assert(r.ok && r.version.length > 0, `probe failed: ${JSON.stringify(r)}`);
  });

  await check('probe: MCP stub handshake returns tools', async () => {
    cli(root, 'register', 'mcp', 'stub-mcp', '--command', process.execPath, '--args', join(FIX, 'stub-mcp.mjs'));
    const reg = new Registry(root).load();
    const r = await probe(reg.find('stub-mcp'));
    assert(r.ok, `probe failed: ${JSON.stringify(r)}`);
    assert(r.serverInfo?.name === 'stub-mcp', 'wrong serverInfo');
    assert(r.tools.includes('echo'), 'tool list missing echo');
  });

  await check('probe: ACP stub handshake returns agentInfo', async () => {
    cli(root, 'register', 'acp', 'stub-acp', '--command', process.execPath, '--args', join(FIX, 'stub-acp.mjs'));
    const reg = new Registry(root).load();
    const r = await probe(reg.find('stub-acp'));
    assert(r.ok, `probe failed: ${JSON.stringify(r)}`);
    assert(r.agentInfo?.name === 'stub-acp', 'wrong agentInfo');
  });

  const a2a = await startStubA2a();
  await check('probe: A2A stub serves an agent card', async () => {
    cli(root, 'register', 'a2a', 'stub-a2a', '--url', a2a.url);
    const reg = new Registry(root).load();
    const r = await probe(reg.find('stub-a2a'));
    assert(r.ok, `probe failed: ${JSON.stringify(r)}`);
    assert(r.name === 'stub-a2a', 'wrong card name');
    assert(r.skills.includes('echo'), 'missing skill');
  });

  await check('mcp surface: initialize / tools list / tools call', async () => {
    const srv = startMcpServer(root);
    try {
      srv.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {} } });
      const init = await srv.next();
      assert(init.result?.serverInfo?.name === 'fit', 'bad serverInfo');

      srv.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      srv.send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const tools = await srv.next();
      const names = tools.result.tools.map((t) => t.name);
      assert(names.includes('fit_list') && names.includes('fit_register_agent'), `tools: ${names}`);

      srv.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fit_list', arguments: {} } });
      const listed = await srv.next();
      const payload = JSON.parse(listed.result.content[0].text);
      assert(payload.endpoints.some((e) => e.name === 'node'), 'node not visible over MCP');

      srv.send({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'fit_register_agent', arguments: { name: 'mcp-client', transport: 'mcp' } },
      });
      const regAgent = await srv.next();
      const agent = JSON.parse(regAgent.result.content[0].text);
      assert(agent.id?.startsWith('agent_'), 'agent not registered');
    } finally {
      srv.stop();
    }
  });

  await check('http surface: healthz / registry / agent card / a2a message', async () => {
    const server = await serveHttp(new Registry(root).load(), { port: 0 });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const health = await (await fetch(`${base}/healthz`)).json();
      assert(health.ok === true, 'healthz failed');

      const registry = await (await fetch(`${base}/registry`)).json();
      assert(Array.isArray(registry.endpoints), 'registry shape');

      const card = await (await fetch(`${base}/.well-known/agent-card.json`)).json();
      assert(card.name === 'FIT Tool Hub', `card name ${card.name}`);
      assert(card.skills.length >= 3, 'card skills');

      const rpc = await (
        await fetch(`${base}/a2a`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 't1',
            method: 'message/send',
            params: { message: { parts: [{ type: 'text', text: 'list' }] } },
          }),
        })
      ).json();
      assert(rpc.result?.status?.state === 'completed', 'a2a task did not complete');
      const body = JSON.parse(rpc.result.artifacts[0].parts[0].text);
      assert(body.count >= 4, `a2a payload count ${body.count}`);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  await check('sdk: JS registers an agent and lists endpoints', () => {
    const fit = new Fit({ root });
    const agent = fit.registerAgent({ name: 'js-sdk-agent' });
    assert(agent.id?.startsWith('agent_'), 'agent not registered');
    const skills = fit.list('skill');
    assert(skills.length >= 1, 'skill list empty');
    assert(fit.stats().total >= 4, 'stats wrong');
  });

  await check('sdk: Python wrapper lists endpoints', () => {
    const py = spawnSync('python', ['-c', `
import sys, json
sys.path.insert(0, r"${join(repo, 'sdk', 'py')}")
from fit_sdk import Fit
fit = Fit(root=r"${root}")
rows = fit.list()
print(json.dumps({"count": len(rows), "names": [r["name"] for r in rows]}))
`], { encoding: 'utf8' });
    if (py.error) throw new Error(`python unavailable: ${py.error.message}`);
    if (py.status !== 0) throw new Error(py.stderr || 'python sdk failed');
    const out = JSON.parse(py.stdout.trim().split('\n').pop());
    assert(out.count >= 4, `python sdk saw ${out.count} endpoints`);
  });

  a2a.child.kill();
  const failed = results.filter((r) => !r.ok);
  console.log('');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n        ${r.error}`}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  rmSync(root, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
