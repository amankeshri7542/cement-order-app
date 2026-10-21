import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTs } from './load-ts.mjs';

const { codeFromMessage } = loadTs('src/sms-code.ts');

test('finds the six-digit code in a retriever message', () => {
  assert.equal(codeFromMessage('<#> Your Shiv Cement Store code is 482913\nFA+9qCX9VSu'), '482913');
  assert.equal(codeFromMessage('482913 is your code'), '482913');
  assert.equal(codeFromMessage('Code: 482913.'), '482913');
});

test('ignores numbers that are not a six-digit code', () => {
  assert.equal(codeFromMessage('Code 12345'), '');
  assert.equal(codeFromMessage('OTP 1234567'), '');
  assert.equal(codeFromMessage('Order SC-2026-482913X'), '482913');
  assert.equal(codeFromMessage('No digits here'), '');
  assert.equal(codeFromMessage(''), '');
});

test('skips a longer number and takes the code after it', () => {
  assert.equal(codeFromMessage('Ref 123456789 code 654321'), '654321');
});
