import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { newTurnId, startTurn, applyEvent, finishTurn, parseEvent, reachedLimit, askWhatsApp } =
  loadTs('src/logic/ask-core.ts', {}, {});

const view = (over = {}) => ({
  id: 'turn1',
  text: 'Whole answer.',
  products: [],
  limit: null,
  whatsappUrl: null,
  articles: [],
  ...over,
});

test('each question gets a new id the server accepts', () => {
  assert.match(newTurnId(), /^[A-Za-z0-9_-]{8,64}$/);
  assert.notEqual(newTurnId(), newTurnId());
});

test('sentences appear whole, in order', () => {
  let turn = startTurn('c', 'Q');
  turn = applyEvent(turn, { type: 'status', turnId: 't', clientTurnId: 'c', text: '' });
  assert.equal(turn.turnId, 't');
  assert.equal(turn.status, 'streaming');
  turn = applyEvent(turn, { type: 'text', text: 'One.' });
  turn = applyEvent(turn, { type: 'text', text: 'Two.' });
  assert.deepEqual(turn.sentences, ['One.', 'Two.']);
});

test('a blocked answer is replaced, with no alarm, and what was shown is gone', () => {
  let turn = applyEvent(startTurn('c', 'Q'), { type: 'text', text: 'Bad sentence.' });
  turn = applyEvent(turn, {
    type: 'replace',
    text: 'Signed text.',
    level: 'FALLBACK',
    label: 'AI_BUSY',
  });
  assert.deepEqual(turn.sentences, ['Signed text.']);
  assert.equal(turn.replaced, true);
});

test('done is the last word and holds the whole answer', () => {
  let turn = applyEvent(startTurn('c', 'Q'), { type: 'text', text: 'Part.' });
  turn = applyEvent(turn, { type: 'done', turn: view() });
  assert.equal(turn.status, 'done');
  assert.deepEqual(turn.sentences, ['Whole answer.']);
  assert.equal(turn.turnId, 'turn1');
});

test('an unknown event changes nothing', () => {
  const turn = startTurn('c', 'Q');
  assert.equal(applyEvent(turn, { type: 'route', route: 'CATALOG' }), turn);
});

test('at a limit, articles and a way to the shop show; the button hides without a number', () => {
  const limited = finishTurn(
    startTurn('c', 'Q'),
    view({ limit: 'DEVICE', whatsappUrl: 'https://wa.me/919000000000' }),
  );
  assert.equal(reachedLimit(limited), true);
  assert.equal(askWhatsApp(limited), 'https://wa.me/919000000000');
  const noNumber = finishTurn(startTurn('c', 'Q'), view({ limit: 'DEVICE' }));
  assert.equal(askWhatsApp(noNumber), null);
  assert.equal(reachedLimit(finishTurn(startTurn('c', 'Q'), view())), false);
});

test('a broken block from the stream is left out', () => {
  assert.equal(parseEvent('text', null), null);
  assert.equal(parseEvent('text', 'not json'), null);
  assert.deepEqual(parseEvent('text', '{"text":"Hi."}'), { text: 'Hi.', type: 'text' });
  assert.deepEqual(parseEvent('status', '{"type":"status","turnId":"t"}'), {
    type: 'status',
    turnId: 't',
  });
});
