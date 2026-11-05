import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clamp,
  currentPanel,
  duskAt,
  easeInOut,
  easeOut,
  filmEnd,
  filmHeight,
  jumpFor,
  lightsOn,
  needsStepDown,
  panelState,
  platesNear,
  prog,
  REACH,
  start,
  T,
} from './tracks';
import { stages } from './stages';

test('the film ends where the plan says', () => {
  assert.equal(duskAt, 514);
  assert.equal(lightsOn, 570);
  assert.equal(filmEnd, 644);
  assert.equal(filmHeight, 744);
});
test('there is a word panel and a reach for every stage', () => {
  assert.equal(stages.length, 6);
  assert.equal(REACH.length, 6);
  assert.equal(stages.at(-1)!.night, true);
});
test('tiles and putty stay out of the film', () => {
  assert.doesNotMatch(JSON.stringify(stages), /tile|putty/i);
});
test('helpers stay in range', () => {
  assert.equal(clamp(-1), 0);
  assert.equal(clamp(2), 1);
  assert.equal(prog(10, 20, 15), 0.5);
  assert.equal(prog(10, 20, 5), 0);
  assert.equal(prog(10, 20, 25), 1);
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    assert.ok(easeOut(t) >= 0 && easeOut(t) <= 1);
    assert.ok(easeInOut(t) >= 0 && easeInOut(t) <= 1);
  }
});
test('no two panels are readable at the same time', () => {
  for (let s = 0; s <= filmEnd + 100; s += 0.5) {
    const visible = stages.map((_, i) => panelState(i, s).opacity).filter((value) => value > 0.5);
    assert.ok(visible.length <= 1, `at ${s}: ${visible}`);
  }
});
test('the panel the rail marks is the panel you can read', () => {
  for (let s = T.s1 + 20; s <= filmEnd; s += 7) {
    const opacity = stages.map((_, i) => panelState(i, s).opacity);
    const top = opacity.indexOf(Math.max(...opacity));
    if (Math.max(...opacity) > 0.9) assert.equal(currentPanel(s), top, `at ${s}`);
  }
});
test('nothing is marked on the hero', () => {
  assert.equal(currentPanel(0), -1);
  assert.equal(currentPanel(T.s1 - 3), -1);
});
test('the last panel stays up to the end of the film', () => {
  assert.ok(panelState(5, filmEnd).opacity > 0.99);
  assert.ok(panelState(5, filmEnd + 500).opacity > 0.99);
});
test('each rail jump lands on its own stage', () => {
  stages.forEach((_, i) => assert.equal(currentPanel(jumpFor(i)), i));
});
test('plates load near where you are, and only those', () => {
  assert.deepEqual(platesNear(0), []);
  assert.deepEqual(platesNear(59), []);
  assert.deepEqual(platesNear(start(0)), [0, 1]);
  assert.deepEqual(platesNear(start(2)), [1, 2, 3]);
  assert.deepEqual(platesNear(filmEnd), [4, 5]);
  for (let s = 0; s < filmEnd + 200; s += 13) assert.ok(platesNear(s).length <= 3);
});
test('the film steps down only after a real sample of slow frames', () => {
  assert.equal(needsStepDown(Array(119).fill(100)), false);
  assert.equal(needsStepDown(Array(120).fill(16)), false);
  assert.equal(needsStepDown([...Array(100).fill(16), ...Array(20).fill(50)]), true);
  assert.equal(needsStepDown([...Array(110).fill(16), ...Array(10).fill(50)]), false);
});
