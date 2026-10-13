#!/usr/bin/env node
// Test harness for Android failure drills (scripts/android-drills.sh). Sits between the
// emulator (adb reverse) and the local API on loopback only, and can:
//   --delay <ms>        add latency to every reply (slow 2G is about 600)
//   --kbps <n>          throttle reply bodies (2G is about 40)
//   --min-version <v>   answer GET /client-config as if the shop requires app version v
// Control while running: POST http://127.0.0.1:<port>/__drill with
//   {"offline": true|false}   every request fails as if the network dropped
//   {"dropNextPost": "/api/v1/orders"}   that POST reaches the API but its reply is lost
//
//   node scripts/android-proxy.mjs --port 4001 --delay 600 --kbps 40
import { createServer, request } from 'node:http';

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
};
const port = Number(arg('port', 4001));
const target = Number(arg('target', 4000));
const delay = Number(arg('delay', 0));
const kbps = Number(arg('kbps', 0));
const minimumVersion = arg('min-version', '');
let offline = false;
let dropNextPost = '';
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer(async (req, res) => {
  if (req.url === '/__drill' && req.method === 'POST') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const control = JSON.parse(body || '{}');
    offline = Boolean(control.offline);
    dropNextPost = control.dropNextPost || '';
    // Going offline also drops open connections (the app's live-update stream).
    if (offline) for (const socket of sockets) if (socket !== req.socket) socket.destroy();
    res.end(JSON.stringify({ offline, dropNextPost }));
    return;
  }
  if (offline) {
    req.socket.destroy();
    return;
  }
  if (minimumVersion && req.method === 'GET' && req.url === '/api/v1/client-config') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        android: {
          minimumVersion,
          latestVersion: minimumVersion,
          storeUrl: 'https://play.google.com/store/apps/details?id=in.shivcement.store',
        },
      }),
    );
    return;
  }
  const upstream = request(
    { host: '127.0.0.1', port: target, path: req.url, method: req.method, headers: req.headers },
    async (reply) => {
      if (req.method === 'POST' && dropNextPost && req.url === dropNextPost) {
        // The API has done the work; the phone never hears back.
        dropNextPost = '';
        reply.resume();
        req.socket.destroy();
        return;
      }
      if (delay) await wait(delay);
      res.writeHead(reply.statusCode || 502, reply.headers);
      for await (const chunk of reply) {
        if (kbps) await wait((chunk.length * 8) / kbps);
        res.write(chunk);
      }
      res.end();
    },
  );
  upstream.on('error', () => res.destroy());
  req.pipe(upstream);
});
const sockets = new Set();
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Drill proxy 127.0.0.1:${port} -> 127.0.0.1:${target}` +
      `${delay ? ` delay=${delay}ms` : ''}${kbps ? ` ${kbps}kbps` : ''}` +
      `${minimumVersion ? ` minimum-version=${minimumVersion}` : ''}`,
  ),
);
