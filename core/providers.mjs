// Discovery: turn what is already on the machine into registry entries.
// Nothing here mutates state — `fit discover` decides what to persist.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { which, readSkillMeta, listDirs, readJson, expandHome } from './util.mjs';

export const DEFAULT_TOOLS = [
  'mise', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'deno',
  'python', 'pip', 'uv', 'go', 'rustc', 'cargo',
  'git', 'gh', 'docker', 'wsl', 'java', 'dotnet', 'rg', 'jq', 'curl',
];

export function discoverEnv(toolNames = DEFAULT_TOOLS) {
  const found = [];
  for (const name of toolNames) {
    const path = which(name);
    if (!path) continue;
    found.push({
      kind: 'env',
      name,
      transport: 'local',
      command: path,
      description: 'executable discovered on PATH',
    });
  }
  return found;
}

export function discoverSkills(skillsDir) {
  const dir = expandHome(skillsDir);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const d of listDirs(dir)) {
    const meta = readSkillMeta(d);
    if (!meta || !meta.name) continue;
    out.push({
      kind: 'skill',
      name: meta.name,
      transport: 'filesystem',
      path: d,
      entry: meta.path,
      description: (meta.description || '').replace(/\s+/g, ' ').slice(0, 240),
    });
  }
  return out;
}

/** Read a Claude/Cursor-style mcp.json and convert `mcpServers` into entries. */
export function importMcpConfig(file) {
  const abs = expandHome(file);
  if (!existsSync(abs)) return [];
  const cfg = readJson(abs, null);
  const servers = cfg?.mcpServers || cfg?.servers || {};
  const out = [];
  for (const [name, spec] of Object.entries(servers)) {
    const isHttp = Boolean(spec.url);
    out.push({
      kind: 'mcp',
      name,
      transport: isHttp ? 'http' : 'stdio',
      command: spec.command || null,
      args: spec.args || [],
      env: spec.env || {},
      url: spec.url || null,
      description: `imported from ${abs}`,
    });
  }
  return out;
}

/** Candidate locations for MCP client configs, most specific first. */
export function mcpConfigCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '.';
  return [
    join(home, '.config', 'mcp', 'mcp.json'),
    join(home, '.cursor', 'mcp.json'),
    join(home, '.claude', 'mcp.json'),
    join(home, '.codex', 'mcp.json'),
    join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
  ];
}

export function findExistingMcpConfig() {
  for (const c of mcpConfigCandidates()) {
    if (existsSync(c)) return c;
  }
  return null;
}

/** Parse a simple agents config for ACP/A2A endpoints (fit.agents.json). */
export function importAgentConfig(file) {
  const abs = expandHome(file);
  if (!existsSync(abs)) return [];
  const cfg = readJson(abs, null);
  if (!cfg) return [];
  const out = [];
  for (const a of cfg.agents || []) {
    if (!a?.name) continue;
    out.push({
      kind: a.kind === 'a2a' ? 'a2a' : 'acp',
      name: a.name,
      transport: a.url ? 'http' : 'stdio',
      command: a.command || null,
      args: a.args || [],
      url: a.url || null,
      description: a.description || '',
    });
  }
  return out;
}
