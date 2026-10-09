import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import securityHeaders from '../apps/mobile/web-security.cjs';

// Expo's HTML handler precedes Metro enhanceMiddleware; put response policy outside both.
const require = createRequire(import.meta.url);
const index = process.argv.indexOf('--port');
const port = Number(index < 0 ? 8081 : process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65000)
  throw new Error('Invalid local web port');
const upstream = port + 10;
const probe = createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(upstream, 'localhost', () => probe.close(resolve));
});
const child = spawn(
  process.execPath,
  [require.resolve('expo/bin/cli'), 'start', '--web', '--localhost', '--port', String(upstream)],
  { stdio: 'inherit' },
);
const headers = securityHeaders(true);
const server = createServer((req, res) => {
  const forward = request(
    {
      hostname: 'localhost',
      port: upstream,
      path: req.url,
      method: req.method,
      headers: req.headers,
    },
    (response) => {
      res.writeHead(response.statusCode || 502, { ...response.headers, ...headers });
      response.pipe(res);
    },
  );
  forward.on('error', () => {
    if (!res.headersSent) res.writeHead(503, headers);
    res.end('Customer development server is starting.');
  });
  res.on('close', () => forward.destroy());
  req.pipe(forward);
});
server.on('upgrade', (req, socket, head) => {
  const remote = connect(upstream, 'localhost', () => {
    remote.write(
      `${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n')}\r\n\r\n`,
    );
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
  });
  remote.on('error', () => socket.destroy());
  socket.on('error', () => remote.destroy());
  socket.on('close', () => remote.destroy());
});
server.headersTimeout = 10000;
server.requestTimeout = 30000;
server.listen(port, '127.0.0.1');
server.on('error', () => {
  child.kill('SIGTERM');
  process.exitCode = 1;
});
const stop = () => {
  child.kill('SIGTERM');
  server.close();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => {
  server.close();
  process.exitCode = code || 0;
});
