// The registry is the single shared catalogue: env tools, skills, MCP servers,
// ACP agents, A2A agents, plus the agents that registered themselves against it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { nowIso, readJson, writeJson, ensureDir } from './util.mjs';

export const KINDS = ['env', 'skill', 'mcp', 'acp', 'a2a'];
export const TRANSPORTS = ['local', 'filesystem', 'stdio', 'http', 'sse'];

export class Registry {
  constructor(root) {
    this.root = root;
    this.dir = join(root, 'registry');
    this.file = join(this.dir, 'fit.json');
    this.data = { version: 1, root, updatedAt: null, endpoints: [], agents: [] };
  }

  load() {
    const onDisk = readJson(this.file, null);
    if (onDisk) {
      this.data = {
        version: onDisk.version ?? 1,
        root: onDisk.root ?? this.root,
        updatedAt: onDisk.updatedAt ?? null,
        endpoints: Array.isArray(onDisk.endpoints) ? onDisk.endpoints : [],
        agents: Array.isArray(onDisk.agents) ? onDisk.agents : [],
      };
    }
    return this;
  }

  save() {
    ensureDir(this.dir);
    this.data.updatedAt = nowIso();
    this.data.root = this.root;
    writeJson(this.file, this.data);
    return this;
  }

  exists() {
    return existsSync(this.file);
  }

  /** Upsert by (kind, name) — registering twice updates instead of duplicating. */
  upsert(entry) {
    const normalized = {
      kind: entry.kind,
      name: entry.name,
      transport: entry.transport || 'local',
      description: entry.description || '',
      registeredAt: entry.registeredAt || nowIso(),
      ...entry,
    };
    const idx = this.data.endpoints.findIndex(
      (e) => e.kind === normalized.kind && e.name === normalized.name,
    );
    if (idx === -1) this.data.endpoints.push(normalized);
    else this.data.endpoints[idx] = { ...this.data.endpoints[idx], ...normalized };
    return normalized;
  }

  remove(name, kind) {
    const before = this.data.endpoints.length;
    this.data.endpoints = this.data.endpoints.filter(
      (e) => !(e.name === name && (!kind || e.kind === kind)),
    );
    return before - this.data.endpoints.length;
  }

  find(name, kind) {
    return this.data.endpoints.find((e) => e.name === name && (!kind || e.kind === kind)) || null;
  }

  list({ kind } = {}) {
    const rows = kind ? this.data.endpoints.filter((e) => e.kind === kind) : this.data.endpoints;
    return [...rows].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  }

  registerAgent({ name, transport, capabilities, endpoint, note }) {
    const agent = {
      id: `agent_${Math.random().toString(36).slice(2, 10)}`,
      name,
      transport: transport || 'mcp',
      capabilities: capabilities || ['registry.read'],
      endpoint: endpoint || null,
      note: note || '',
      registeredAt: nowIso(),
      lastSeenAt: nowIso(),
    };
    const idx = this.data.agents.findIndex((a) => a.name === agent.name);
    if (idx === -1) this.data.agents.push(agent);
    else this.data.agents[idx] = { ...this.data.agents[idx], ...agent };
    return agent;
  }

  findAgent(name) {
    return this.data.agents.find((a) => a.name === name) || null;
  }

  stats() {
    const byKind = Object.fromEntries(KINDS.map((k) => [k, 0]));
    for (const e of this.data.endpoints) {
      if (byKind[e.kind] === undefined) byKind[e.kind] = 0;
      byKind[e.kind] += 1;
    }
    return {
      root: this.root,
      file: this.file,
      exists: this.exists(),
      total: this.data.endpoints.length,
      byKind,
      agents: this.data.agents.length,
      updatedAt: this.data.updatedAt,
    };
  }
}

/** Resolve the registry root: --root > FIT_ROOT > <repo>/.. > D:\env > ~/.fit */
export function resolveRoot(explicit) {
  if (explicit) return explicit;
  if (process.env.FIT_ROOT) return process.env.FIT_ROOT;
  const candidates = ['D:\\env', join(process.env.USERPROFILE || process.env.HOME || '.', '.fit')];
  for (const c of candidates) {
    if (c && existsSync(join(c, 'mise.toml'))) return c;
  }
  return candidates[0];
}
