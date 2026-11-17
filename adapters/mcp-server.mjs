// MCP surface — exposes the registry as MCP tools over stdio (JSON-RPC, NDJSON).
// An agent that speaks MCP can list what this machine offers, register itself,
// and resolve endpoints without knowing anything about FIT internals.
import { createInterface } from 'node:readline';
import { probe } from '../core/probe.mjs';
import { KINDS } from '../core/registry.mjs';
import { nowIso } from '../core/util.mjs';

const VERSION = '0.2.0';
const PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'fit_list',
    description: 'List registered endpoints (env tools, skills, MCP servers, ACP agents, A2A agents).',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', enum: KINDS } },
      additionalProperties: false,
    },
  },
  {
    name: 'fit_resolve',
    description: 'Resolve one endpoint by name and return its transport details.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, kind: { type: 'string', enum: KINDS } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_register',
    description: 'Register or update an endpoint in the shared registry.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS },
        name: { type: 'string' },
        transport: { type: 'string' },
        command: { type: 'string' },
        url: { type: 'string' },
        path: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['kind', 'name'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_register_agent',
    description: 'Register the calling agent itself so the hub can report who is connected.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        transport: { type: 'string' },
        capabilities: { type: 'array', items: { type: 'string' } },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_probe',
    description: 'Actively probe an endpoint (spawn MCP/ACP server, fetch A2A agent card, run --version).',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string' }, kind: { type: 'string', enum: KINDS } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'fit_doctor',
    description: 'Registry health: counts by kind, broken endpoints, registered agents.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

function asText(value) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

async function callTool(reg, name, args = {}) {
  switch (name) {
    case 'fit_list': {
      const rows = reg.list({ kind: args.kind }).map((e) => ({
        kind: e.kind,
        name: e.name,
        transport: e.transport,
        target: e.url || e.command || e.path || null,
        description: e.description || '',
      }));
      return asText({ count: rows.length, endpoints: rows });
    }
    case 'fit_resolve': {
      const entry = reg.find(args.name, args.kind);
      if (!entry) throw new Error(`not found: ${args.name}`);
      return asText(entry);
    }
    case 'fit_register': {
      if (!KINDS.includes(args.kind)) throw new Error(`unknown kind: ${args.kind}`);
      const saved = reg.upsert({
        kind: args.kind,
        name: args.name,
        transport: args.transport || undefined,
        command: args.command || undefined,
        url: args.url || undefined,
        path: args.path || undefined,
        description: args.description || '',
      });
      reg.save();
      return asText({ registered: saved, file: reg.file });
    }
    case 'fit_register_agent': {
      const agent = reg.registerAgent({
        name: args.name,
        transport: args.transport || 'mcp',
        capabilities: args.capabilities || ['registry.read'],
      });
      reg.save();
      return asText(agent);
    }
    case 'fit_probe': {
      const entry = reg.find(args.name, args.kind);
      if (!entry) throw new Error(`not found: ${args.name}`);
      return asText(await probe(entry));
    }
    case 'fit_doctor': {
      return asText(reg.stats());
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export async function serveMcp(reg) {
  // stdout is the protocol channel — diagnostics go to stderr only.
  process.stderr.write(`[fit] MCP server on stdio · root=${reg.root} · ${reg.data.endpoints.length} endpoints\n`);
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    const { id, method, params } = msg;
    try {
      if (method === 'initialize') {
        return send({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'fit', version: VERSION },
          },
        });
      }
      if (method === 'notifications/initialized' || method?.startsWith('notifications/')) return undefined;
      if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
      if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      if (method === 'tools/call') {
        const out = await callTool(reg, params?.name, params?.arguments || {});
        return send({ jsonrpc: '2.0', id, result: out });
      }
      if (method === 'resources/list') return send({ jsonrpc: '2.0', id, result: { resources: [] } });
      return send({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    } catch (e) {
      return send({
        jsonrpc: '2.0',
        id,
        result: { content: [{ type: 'text', text: `error: ${e.message}` }], isError: true },
      });
    }
  });
  rl.on('close', () => process.exit(0));
  process.stderr.write(`[fit] ready ${nowIso()}\n`);
}
