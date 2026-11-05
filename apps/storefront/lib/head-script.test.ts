import assert from 'node:assert/strict';
import { test } from 'node:test';
import { filmTier, headScript, type TierInput } from '../film/tier';

/** Runs the real inline script against a fake browser. */
function run(input: Partial<TierInput>, off = false, hasFilm = true) {
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const timers: (() => void)[] = [];
  const listeners: ((event: { target: unknown }) => void)[] = [];
  const win: Record<string, unknown> = {
    innerHeight: input.height ?? 800,
    matchMedia: () => ({ matches: Boolean(input.reducedMotion) }),
    navigator: {
      deviceMemory: input.deviceMemory,
      connection: { saveData: input.saveData, effectiveType: input.effectiveType },
    },
    setTimeout: (fn: () => void) => timers.push(fn),
  };
  const doc = {
    documentElement: {
      classList: { add: (name: string) => classes.add(name) },
      setAttribute: (name: string, value: string) => attrs.set(name, value),
      removeAttribute: (name: string) => attrs.delete(name),
    },
    addEventListener: (_: string, fn: (event: { target: unknown }) => void) => listeners.push(fn),
    querySelector: () => (hasFilm ? {} : null),
  };
  new Function('window', 'document', headScript(off))(win, doc);
  return { attrs, classes, win, timers, click: listeners[0]! };
}
const cases: Partial<TierInput>[] = [
  {},
  { reducedMotion: true },
  { height: 499 },
  { height: 500 },
  { height: 2000 },
  { height: 2001 },
  { saveData: true },
  { effectiveType: '2g' },
  { effectiveType: 'slow-2g' },
  { effectiveType: '3g' },
  { effectiveType: '4g' },
  { deviceMemory: 1 },
  { deviceMemory: 2 },
  { deviceMemory: 4 },
  { deviceMemory: 8 },
];
for (const input of cases)
  test(`the inline script and the rule agree: ${JSON.stringify(input)}`, () => {
    const tier = filmTier({ reducedMotion: false, height: 800, ...input });
    assert.equal(run(input).attrs.get('data-film'), tier === 'still' ? undefined : tier);
  });
test('switched off, every visitor gets the still page', () => {
  assert.equal(run({}, true).attrs.get('data-film'), undefined);
  assert.equal(filmTier({ reducedMotion: false, height: 800, off: true }), 'still');
});
test('the page knows scripts run, so hidden Add buttons appear', () => {
  assert.ok(run({}).classes.has('js'));
});
test('if the film has not started after 8 seconds, the still page takes over', () => {
  const { attrs, timers } = run({});
  assert.equal(attrs.get('data-film'), 'full');
  timers[0]!();
  assert.equal(attrs.get('data-film'), undefined);
});
test('on a page with no film the tier waits, so the film can still start on the home page', () => {
  const { attrs, timers } = run({}, false, false);
  timers[0]!();
  assert.equal(attrs.get('data-film'), 'full');
});
test('a film that started in time is left alone', () => {
  const { attrs, timers, win } = run({});
  win.__filmOn = true;
  timers[0]!();
  assert.equal(attrs.get('data-film'), 'full');
});
test('a tap on Add before the code arrives is queued and shows pressed', () => {
  const { click, win } = run({});
  const pressed = new Map<string, string>();
  const owner = { getAttribute: () => '{"i":"a"}' };
  const button = {
    closest: (selector: string) => (selector === '[data-line]' ? owner : button),
    getAttribute: () => null,
    setAttribute: (name: string, value: string) => pressed.set(name, value),
  };
  click({ target: { closest: () => button } });
  assert.deepEqual(win.__listQ, [{ line: '{"i":"a"}', step: null }]);
  assert.equal(pressed.get('aria-pressed'), 'true');
});
test('a stepper tap is queued with its direction', () => {
  const { click, win } = run({});
  const owner = { getAttribute: () => '{"i":"a"}' };
  const button = {
    closest: (selector: string) => (selector === '[data-line]' ? owner : button),
    getAttribute: () => '-1',
    setAttribute: () => {},
  };
  click({ target: { closest: () => button } });
  assert.deepEqual(win.__listQ, [{ line: '{"i":"a"}', step: -1 }]);
});
test('once the page code runs, taps are left to it', () => {
  const { click, win } = run({});
  win.__listOn = true;
  const button = { closest: () => button, getAttribute: () => null, setAttribute: () => {} };
  click({ target: { closest: () => button } });
  assert.deepEqual(win.__listQ, []);
});
test('a tap on nothing special is ignored', () => {
  const { click, win } = run({});
  click({ target: { closest: () => null } });
  click({ target: null });
  click({ target: {} });
  assert.deepEqual(win.__listQ, []);
});
test('the script is small enough to sit in every page', () => {
  assert.ok(headScript(false).length < 1200, String(headScript(false).length));
});
