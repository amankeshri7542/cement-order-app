import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftsVisible, reviewOn } from './review';

test('a build customers can reach never shows placeholders', () => {
  assert.equal(reviewOn({ NODE_ENV: 'production' }), false);
  assert.equal(reviewOn({ NODE_ENV: 'production', NEXT_PUBLIC_CONTENT_REVIEW: 'off' }), false);
  assert.equal(reviewOn({ NODE_ENV: 'production', NEXT_PUBLIC_CONTENT_REVIEW: 'true' }), false);
});
test('development and an opted-in private build show them', () => {
  assert.equal(reviewOn({ NODE_ENV: 'development' }), true);
  assert.equal(reviewOn({ NODE_ENV: 'production', NEXT_PUBLIC_CONTENT_REVIEW: 'on' }), true);
});
test('unsigned guide drafts show only on a private review build, never on the indexed site', () => {
  assert.equal(draftsVisible(true, false), true);
  assert.equal(draftsVisible(true, true), false);
  assert.equal(draftsVisible(false, false), false);
  assert.equal(draftsVisible(false, true), false);
});
