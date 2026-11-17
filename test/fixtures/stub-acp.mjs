// Minimal ACP (Agent Client Protocol) agent used by tests.
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
  const { id, method } = msg;
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: 1,
        agentInfo: { name: 'stub-acp', version: '0.0.1' },
        agentCapabilities: { promptCapabilities: {} },
      },
    });
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `not found: ${method}` } });
});
