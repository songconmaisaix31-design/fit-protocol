// Small, dependency-free helpers shared by the core and adapters.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { homedir, platform } from 'node:os';

export const isWindows = platform() === 'win32';

export function nowIso() {
  return new Date().toISOString();
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  return p;
}

export function resolveFromRoot(root, p) {
  if (!p) return p;
  const e = expandHome(p);
  return isAbsolute(e) ? resolve(e) : resolve(root, e);
}

/** Locate an executable on PATH, honouring PATHEXT on Windows. */
export function which(cmd) {
  if (!cmd) return null;
  if (isAbsolute(cmd) || cmd.includes('/') || cmd.includes('\\')) {
    return existsSync(cmd) ? cmd : null;
  }
  const path = process.env.PATH || '';
  const exts = isWindows ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const dir of path.split(isWindows ? ';' : ':')) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Minimal YAML frontmatter reader — enough for `name` and `description`. */
export function readFrontmatter(markdown) {
  if (!markdown.startsWith('---')) return {};
  const end = markdown.indexOf('\n---', 3);
  if (end === -1) return {};
  const block = markdown.slice(3, end);
  const out = {};
  let currentKey = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, '');
    if (!line) continue;
    const keyMatch = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyMatch) {
      currentKey = keyMatch[1];
      const value = keyMatch[2];
      out[currentKey] = value === '>-' || value === '|' || value === '>' ? '' : value;
      continue;
    }
    if (currentKey && /^\s+/.test(line)) {
      out[currentKey] = (out[currentKey] ? out[currentKey] + ' ' : '') + line.trim();
    }
  }
  return out;
}

export function readSkillMeta(skillDir) {
  const file = join(skillDir, 'SKILL.md');
  if (!existsSync(file)) return null;
  const fm = readFrontmatter(readFileSync(file, 'utf8'));
  return {
    name: fm.name || null,
    description: fm.description || null,
    path: file,
  };
}

export function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(dir, d.name));
}
