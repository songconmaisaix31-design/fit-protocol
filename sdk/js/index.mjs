// JS SDK — in-process access to the same registry the CLI and MCP server use.
// No subprocess, no network: import this from an agent runtime that runs in Node.
import { Registry, resolveRoot, KINDS } from '../../core/registry.mjs';
import { discoverEnv, discoverSkills, importMcpConfig, importAgentConfig } from '../../core/providers.mjs';
import { probe } from '../../core/probe.mjs';

export class Fit {
  constructor({ root } = {}) {
    this.registry = new Registry(resolveRoot(root)).load();
  }

  get root() {
    return this.registry.root;
  }

  /** All endpoints, optionally filtered by kind. */
  list(kind) {
    return this.registry.list({ kind });
  }

  resolve(name, kind) {
    return this.registry.find(name, kind);
  }

  register(entry) {
    const saved = this.registry.upsert(entry);
    this.registry.save();
    return saved;
  }

  unregister(name, kind) {
    const n = this.registry.remove(name, kind);
    this.registry.save();
    return n;
  }

  /** Register the calling agent, so the hub can report who is attached. */
  registerAgent({ name, transport = 'js-sdk', capabilities = ['registry.read'] }) {
    const agent = this.registry.registerAgent({ name, transport, capabilities });
    this.registry.save();
    return agent;
  }

  agents() {
    return this.registry.data.agents;
  }

  async probe(name, kind) {
    const entry = this.registry.find(name, kind);
    if (!entry) throw new Error(`not found: ${name}`);
    return probe(entry);
  }

  stats() {
    return this.registry.stats();
  }

  discover({ env = true, skills = null, mcp = null, agents = null } = {}) {
    const found = [];
    if (env) found.push(...discoverEnv());
    if (skills) found.push(...discoverSkills(skills));
    if (mcp) found.push(...importMcpConfig(mcp));
    if (agents) found.push(...importAgentConfig(agents));
    return found;
  }
}

export { KINDS };
export default Fit;
