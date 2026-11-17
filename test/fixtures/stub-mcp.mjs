// Minimal MCP server used by tests: one tool, plain NDJSON over stdio.
import { createInterface } from 'node:readline';

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'stub-mcp', version: '0.0.1' },
      },
    });
  }
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0',
      id,
      result: { tools: [{ name: 'echo', description: 'echo back', inputSchema: { type: 'object' } }] },
    });
  }
  if (method === 'tools/call') {
    return send({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: `echo:${params?.arguments?.text ?? ''}` }] },
    });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'not found' } });
});
