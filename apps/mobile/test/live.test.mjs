import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('src/live.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function load() {
  const exports = {};
  // Wrappers resolve the globals at call time, so node:test's mocked timers apply.
  runInNewContext(compiled, {
    exports,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
  });
  return exports;
}
function fakeSources() {
  const opened = [];
  const connect = () => {
    const handlers = {};
    const source = {
      closed: false,
      addEventListener: (type, listener) => (handlers[type] = listener),
      close: () => (source.closed = true),
      emit: (type, event = {}) => handlers[type]?.(event),
    };
    opened.push(source);
    return source;
  };
  return { opened, connect };
}

test('a burst of store events causes one refresh; heartbeats cause none', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { liveStream } = load();
  const { opened, connect } = fakeSources();
  let refreshes = 0;
  const live = liveStream(connect, () => refreshes++);
  live.start();
  for (let i = 0; i < 10; i++) {
    opened[0].emit('message', { data: '{"type":"CATALOG_UPDATED"}' });
    t.mock.timers.tick(100);
  }
  t.mock.timers.tick(1500);
  assert.equal(refreshes, 1);
  opened[0].emit('message', { data: '{"type":"HEARTBEAT"}' });
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 1);
  live.stop();
});

test('a dropped stream reopens with growing waits and catches up once open', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { liveStream, reconnectDelays } = load();
  const { opened, connect } = fakeSources();
  let refreshes = 0;
  const live = liveStream(connect, () => refreshes++);
  live.start();
  let expected = 1;
  for (const wait of [...reconnectDelays, reconnectDelays.at(-1)]) {
    opened.at(-1).emit('error');
    t.mock.timers.tick(wait - 1);
    assert.equal(opened.length, expected, `no reopen before ${wait} ms`);
    t.mock.timers.tick(1);
    assert.equal(opened.length, ++expected, `reopened after ${wait} ms`);
    assert.equal(opened.at(-2).closed, true);
  }
  // A successful open resets the ladder and refreshes what was missed.
  opened.at(-1).emit('open');
  t.mock.timers.tick(1500);
  assert.equal(refreshes, 1);
  opened.at(-1).emit('error');
  t.mock.timers.tick(reconnectDelays[0]);
  assert.equal(opened.length, expected + 1);
  // Events from a stream that was replaced are ignored.
  opened[0].emit('message', { data: 'ORDER_UPDATED' });
  t.mock.timers.tick(5000);
  assert.equal(refreshes, 1);
  live.stop();
});

test('silence longer than a minute reopens; background closes and active reopens at once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { liveStream, silenceLimit } = load();
  const { opened, connect } = fakeSources();
  const live = liveStream(connect, () => {});
  live.start();
  opened[0].emit('open');
  t.mock.timers.tick(25000);
  opened[0].emit('message', { data: '{"type":"HEARTBEAT"}' });
  t.mock.timers.tick(silenceLimit - 1);
  assert.equal(opened.length, 1, 'a heartbeat keeps the stream');
  t.mock.timers.tick(1);
  t.mock.timers.tick(2000);
  assert.equal(opened.length, 2, 'a silent stream is replaced');
  assert.equal(opened[0].closed, true);
  live.stop();
  assert.equal(opened[1].closed, true);
  t.mock.timers.tick(120000);
  assert.equal(opened.length, 2, 'a stopped stream stays closed');
  live.start();
  assert.equal(opened.length, 3);
  live.start();
  assert.equal(opened.length, 3, 'start on an open stream does nothing');
  // Waiting to retry, a return to the app reconnects now instead of after the wait.
  opened[2].emit('error');
  live.start();
  assert.equal(opened.length, 4);
  live.stop();
});
