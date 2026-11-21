import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRecallFeedback } from '../src/recallFeedback.ts';

const hit = (id, evidence) => ({ photo: { id }, evidence, captured: null, place: null });

test('outcomes break ties without displacing an exact match', () => {
  const page = { items: [
    hit('a', ['Photo text: My electricity bill']),
    hit('b', ['Photo text: Your electricity bill']),
    hit('c', ['Eye category: Receipts']),
  ], next: 24 };
  const result = applyRecallFeedback(page, 'electricity bill', new Map([['b', 1], ['c', 5]]));
  assert.deepEqual(result.items.map((item) => item.photo.id), ['b', 'a', 'c']);
  assert.equal(result.next, 24);
  assert.deepEqual(page.items.map((item) => item.photo.id), ['a', 'b', 'c']);
});

test('browse collections remain in native order', () => {
  const page = { items: [hit('a', []), hit('b', [])], next: null };
  assert.equal(applyRecallFeedback(page, '', new Map([['b', 1]])), page);
});
