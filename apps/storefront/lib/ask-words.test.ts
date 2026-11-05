import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  advisorChrome,
  advisorDeviceHeader,
  advisorLabelText,
  advisorSpeaker,
  advisorStarters,
  checkedMonth as sharedMonth,
} from '@shiv/shared/src/advisor';
import { askWords, checkedMonth, parseEvents } from './ask-words';

test('the words on the panel are the reviewed words', () => {
  assert.equal(askWords.speaker, advisorSpeaker);
  assert.equal(askWords.speaker, 'Shiv Cement AI');
  assert.equal(askWords.deviceHeader, advisorDeviceHeader);
  assert.equal(askWords.checking, advisorChrome.statusChecking.en);
  assert.equal(askWords.title, advisorChrome.firstOpenTitle.en);
  assert.equal(askWords.firstOpen, advisorChrome.firstOpen.en);
  assert.equal(askWords.underBox, advisorChrome.underBox.en);
  assert.equal(askWords.sourceLine, advisorChrome.sourceLine.en);
  assert.equal(askWords.askShop, advisorChrome.askShopWhatsApp.en);
  for (const key of ['CHECKED', 'GENERAL', 'AI_BUSY', 'FROM_GUIDE'] as const)
    assert.equal(askWords.labels[key], advisorLabelText[key].en);
  assert.deepEqual(askWords.starters, [
    ...advisorStarters.home.map((item) => item.en),
    ...advisorStarters.website.map((item) => item.en),
  ]);
});
test('months read the same as the shared rule', () => {
  for (const value of ['2027-03', '2026-11', 'bad', '2026-13', ''])
    assert.equal(checkedMonth(value), sharedMonth(value));
  assert.equal(checkedMonth('2027-03'), 'March 2027');
});
test('whole events come out, a half event waits', () => {
  const first = parseEvents(
    'event: text\ndata: {"type":"text","text":"Hi."}\n\nevent: done\ndata: {"ty',
  );
  assert.deepEqual(first.events, [{ type: 'text', text: 'Hi.' }]);
  assert.equal(first.rest, 'event: done\ndata: {"ty');
  const second = parseEvents(`${first.rest}pe":"done"}\n\n`);
  assert.deepEqual(second.events, [{ type: 'done' }]);
  assert.equal(second.rest, '');
});
test('heartbeats and broken blocks are skipped', () => {
  const out = parseEvents(': keep-alive\n\ndata: {not json\n\ndata: {"type":"text"}\n\n');
  assert.deepEqual(out.events, [{ type: 'text' }]);
});
