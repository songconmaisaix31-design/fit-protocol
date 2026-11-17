// HTTP surface — registry browsing plus an A2A-compatible agent card and a
// minimal `message/send` endpoint. Deliberately small: it exposes *this hub's*
// capabilities (list / resolve / doctor), not an open chat proxy.
import { createServer } from 'node:http';
import { KINDS } from '../core/registry.mjs';

const VERSION = '0.2.0';

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'access-control-allow-origin': '*',
  });
  res.end(payload);
}

function agentCard(reg, base) {
  return {
    name: 'FIT Tool Hub',
    description:
      'Shared tool registry for one machine: env tools, agent skills, MCP servers, ACP and A2A agents.',
    url: `${base}/a2a`,
    version: VERSION,
    protocolVersion: '0.2.0',
    provider: { organization: 'fit-protocol', url: 'https://github.com/songconmaisaix31-design/fit-protocol' },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'registry.list',
        name: 'List endpoints',
        description: `Return registered endpoints. ${reg.data.endpoints.length} currently registered across ${KINDS.join(', ')}.`,
        tags: ['registry', 'discovery'],
      },
      {
        id: 'registry.resolve',
        name: 'Resolve endpoint',
        description: 'Return transport details for a single endpoint by name.',
        tags: ['registry', 'resolve'],
      },
      {
        id: 'registry.doctor',
        name: 'Registry health',
        description: 'Counts by kind, broken endpoints, and registered agents.',
        tags: ['registry', 'health'],
      },
    ],
  };
}

/** Interpret a natural-language-ish message as one of the card's skills. */
function handleIntent(reg, text) {
  const t = (text || '').trim().toLowerCase();
  if (t.startsWith('list') || t === '' || t === 'help') {
    const rows = reg.list().map((e) => ({ kind: e.kind, name: e.name, transport: e.transport }));
    return { skill: 'registry.list', data: { count: rows.length, endpoints: rows } };
  }
  if (t.startsWith('resolve ')) {
    const name = text.trim().slice('resolve '.length).trim();
    const entry = reg.find(name);
    if (!entry) return { skill: 'registry.resolve', error: `not found: ${name}` };
    return { skill: 'registry.resolve', data: entry };
  }
  if (t.startsWith('doctor') || t.startsWith('health')) {
    return { skill: 'registry.doctor', data: reg.stats() };
  }
  return {
    error: `unsupported request. Try: "list", "resolve <name>", "doctor".`,
    skills: ['registry.list', 'registry.resolve', 'registry.doctor'],
  };
}

export async function serveHttp(reg, { port = 7777, host = '127.0.0.1' } = {}) {
  const server = createServer(async (req, res) => {
    // port may be 0 (ephemeral) until listen() completes — read it per request
    const actualPort = server.address()?.port ?? port;
    const base = `http://${host}:${actualPort}`;
    const url = new URL(req.url, base);

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, 200, { ok: true, version: VERSION, root: reg.root });
    }

    if (req.method === 'GET' && url.pathname === '/registry') {
      return json(res, 200, reg.data);
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/agent-card.json') {
      return json(res, 200, agentCard(reg, base));
    }

    if (req.method === 'POST' && (url.pathname === '/a2a' || url.pathname === '/')) {
      let body = '';
      for await (const chunk of req) body += chunk;
      let rpc;
      try {
        rpc = JSON.parse(body || '{}');
      } catch {
        return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      }
      const { id = null, method, params } = rpc;
      if (method === 'message/send' || method === 'tasks/send') {
        const text = params?.message?.parts?.map((p) => p.text).filter(Boolean).join(' ') || '';
        const out = handleIntent(reg, text);
        return json(res, 200, {
          jsonrpc: '2.0',
          id,
          result: {
            id: `task_${Math.random().toString(36).slice(2, 10)}`,
            status: { state: out.error ? 'failed' : 'completed' },
            artifacts: [
              {
                name: out.skill || 'error',
                parts: [{ type: 'text', text: JSON.stringify(out.error ? { error: out.error, skills: out.skills } : out.data, null, 2) }],
              },
            ],
          },
        });
      }
      if (method === 'agent/getAuthenticatedExtendedCard') {
        return json(res, 200, { jsonrpc: '2.0', id, result: agentCard(reg, base) });
      }
      return json(res, 200, {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `method not found: ${method}` },
      });
    }

    return json(res, 404, { error: 'not found', paths: ['/healthz', '/registry', '/.well-known/agent-card.json', '/a2a'] });
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const actualPort = server.address()?.port ?? port;
  process.stderr.write(`[fit] HTTP on http://${host}:${actualPort} · root=${reg.root}\n`);
  process.stderr.write(`[fit] agent card: http://${host}:${actualPort}/.well-known/agent-card.json\n`);
  return server;
}
