import assert from 'node:assert/strict';
import test from 'node:test';
import { legacyRedirects } from './redirects';

test('every legacy redirect is a path on this site and none loops', () => {
  const sources = new Set<string>();
  for (const { source, destination } of legacyRedirects) {
    assert.match(source, /^\/[^\s]*$/, `source ${source}`);
    assert.match(destination, /^\/[^\s]*$/, `destination ${destination}`);
    assert.notEqual(source, destination, `${source} redirects to itself`);
    assert.ok(!sources.has(source), `${source} is listed twice`);
    sources.add(source);
  }
  for (const { destination } of legacyRedirects)
    assert.ok(!sources.has(destination), `${destination} is itself redirected`);
});
