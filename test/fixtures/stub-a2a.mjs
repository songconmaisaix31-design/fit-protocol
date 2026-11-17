// Minimal A2A agent used by tests: serves an agent card on /.
import { createServer } from 'node:http';

const card = {
  name: 'stub-a2a',
  description: 'test fixture',
  url: 'http://127.0.0.1/0',
  version: '0.0.1',
  protocolVersion: '0.2.0',
  capabilities: { streaming: false },
  skills: [{ id: 'echo', name: 'Echo', description: 'echoes', tags: ['test'] }],
};

const server = createServer((req, res) => {
  if (req.url.includes('.well-known')) {
    const payload = JSON.stringify(card);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(payload);
  }
  res.writeHead(404).end();
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(String(server.address().port) + '\n');
});
