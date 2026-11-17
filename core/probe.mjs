// Protocol probes: prove an endpoint actually answers before trusting it.
// MCP and ACP speak newline-delimited JSON-RPC over stdio; A2A publishes an
// agent card over HTTP. All three are implemented with node builtins only.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isWindows, which } from './util.mjs';

const DEFAULT_TIMEOUT = 15000;

/** Start a stdio JSON-RPC session. Returns { request, notify, close }. */
export function openRpcSession({ command, args = [], env = {}, timeoutMs = DEFAULT_TIMEOUT }) {
  const resolved = which(command) || command;
  const shell = isWindows && /\.(cmd|bat)$/i.test(resolved);
  const child = spawn(resolved, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell,
    env: { ...process.env, ...env },
    windowsHide: true,
  });

  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  let stderr = '';
  let closed = false;

  child.stderr.on('data', (d) => {
    stderr += d.toString();
    if (stderr.length > 20000) stderr = stderr.slice(-20000);
  });

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    }
  });

  child.on('exit', () => {
    closed = true;
    for (const { reject } of pending.values()) reject(new Error('process exited'));
    pending.clear();
  });

  function send(payload) {
    if (closed) throw new Error('session closed');
    child.stdin.write(JSON.stringify(payload) + '\n');
  }

  function request(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      try {
        send({ jsonrpc: '2.0', id, method, params });
      } catch (e) {
        clearTimeout(timer);
        pending.delete(id);
        reject(e);
      }
    });
  }

  function notify(method, params = {}) {
    send({ jsonrpc: '2.0', method, params });
  }

  function close() {
    try {
      child.stdin.end();
    } catch {
      /* already gone */
    }
    if (!closed) child.kill();
  }

  return { request, notify, close, stderr: () => stderr };
}

export async function probeMcp(entry) {
  if (entry.transport === 'http' || entry.url) {
    const url = entry.url;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'fit-probe', version: '0.2.0' } },
      }),
    });
    const body = await res.json();
    return { ok: true, transport: 'http', status: res.status, serverInfo: body?.result?.serverInfo ?? null };
  }

  const session = openRpcSession({ command: entry.command, args: entry.args || [], env: entry.env || {} });
  try {
    const init = await session.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'fit-probe', version: '0.2.0' },
    });
    session.notify('notifications/initialized');
    let tools = [];
    try {
      const listed = await session.request('tools/list', {});
      tools = (listed?.tools || []).map((t) => t.name);
    } catch {
      /* server may not expose tools */
    }
    return {
      ok: true,
      transport: 'stdio',
      serverInfo: init?.serverInfo ?? null,
      protocolVersion: init?.protocolVersion ?? null,
      tools,
      toolCount: tools.length,
    };
  } finally {
    session.close();
  }
}

export async function probeAcp(entry) {
  const session = openRpcSession({ command: entry.command, args: entry.args || [], env: entry.env || {} });
  try {
    const init = await session.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: {},
    });
    return { ok: true, transport: 'stdio', agentInfo: init?.agentInfo ?? init ?? null };
  } finally {
    session.close();
  }
}

export async function probeA2a(entry) {
  const url = entry.url;
  if (!url) throw new Error('a2a endpoint needs a url');
  const cardUrl = url.includes('.well-known')
    ? url
    : new URL('/.well-known/agent-card.json', url).toString();
  const res = await fetch(cardUrl, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`agent card HTTP ${res.status}`);
  const card = await res.json();
  return {
    ok: true,
    transport: 'http',
    cardUrl,
    name: card.name ?? null,
    description: card.description ?? null,
    skills: (card.skills || []).map((s) => s.id || s.name),
    capabilities: card.capabilities ?? null,
  };
}

export async function probeEnv(entry) {
  const path = which(entry.command) || entry.command;
  if (!path) return { ok: false, error: 'not found on PATH' };
  const resolved = path;
  const shell = isWindows && /\.(cmd|bat|ps1)$/i.test(resolved);
  return await new Promise((resolve) => {
    const child = spawn(resolved, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell,
      windowsHide: true,
      timeout: 5000,
    });
    let out = '';
    const grab = (d) => (out += d.toString());
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (e) => resolve({ ok: false, error: e.message }));
    child.on('close', () => {
      const first = out.split(/\r?\n/).find((l) => l.trim()) || '';
      resolve({ ok: true, path: resolved, version: first.trim().slice(0, 120) });
    });
  });
}

export async function probeSkill(entry) {
  const target = entry.entry || entry.path;
  if (!existsSync(target)) return { ok: false, error: `missing ${target}` };
  return { ok: true, path: entry.path, entry: entry.entry || null };
}

export async function probe(entry) {
  switch (entry.kind) {
    case 'env': return probeEnv(entry);
    case 'skill': return probeSkill(entry);
    case 'mcp': return probeMcp(entry);
    case 'acp': return probeAcp(entry);
    case 'a2a': return probeA2a(entry);
    default: return { ok: false, error: `unknown kind ${entry.kind}` };
  }
}
