import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChoice, photoFeedbackScores, preferredActions, readCorrections, readEvolveState, writeOutcome,
} from '../src/evolve.ts';

const empty = { version: 1, choices: [] };
const choice = (id, actionId = 'organize', photoIds = ['a']) => ({
  id, at: 1000, actionId, title: 'Organize photos', photoIds, constraints: '',
});

test('appends a choice once and preserves a saved outcome on retry', () => {
  const initial = appendChoice(empty, choice('one', 'organize', ['a', 'a']));
  const recorded = writeOutcome(initial, 'one', { rating: 'helpful', note: ' Works ', at: 2000 });
  const restored = readEvolveState(JSON.stringify(appendChoice(recorded, choice('one'))));
  assert.deepEqual(restored.choices[0].photoIds, ['a']);
  assert.equal(restored.choices[0].outcome.note, 'Works');
  assert.equal(restored.choices.length, 1);
});

test('clearing one outcome leaves its saved choice and other outcomes intact', () => {
  let state = appendChoice(appendChoice(empty, choice('one')), choice('two'));
  state = writeOutcome(state, 'one', { rating: 'helpful', note: '', at: 2000 });
  state = writeOutcome(state, 'two', { rating: 'not_helpful', note: '', at: 2100 });
  const cleared = writeOutcome(state, 'one', null);
  assert.deepEqual(cleared.choices.find((entry) => entry.id === 'one'), choice('one'));
  assert.equal(cleared.choices[0].outcome.rating, 'not_helpful');
});

test('weights available outcome signals without amplifying repeated photo IDs', () => {
  let state = appendChoice(empty, choice('negative', 'print', ['a', 'b']));
  state = writeOutcome(state, 'negative', { rating: 'not_helpful', note: '', at: 2000 });
  state = appendChoice(state, choice('untried', 'share', ['c']));
  state = writeOutcome(state, 'untried', { rating: 'not_tried', note: '', at: 2000 });
  for (let i = 0; i < 5; i++) {
    state = appendChoice(state, choice(`positive-${i}`, 'organize', ['a', 'a']));
    state = writeOutcome(state, `positive-${i}`, { rating: 'helpful', note: '', at: 2000 });
  }
  assert.deepEqual(preferredActions(state), ['organize']);
  assert.deepEqual([...photoFeedbackScores(state)].sort(), [['a', 3], ['b', -1]]);
});

test('ignores malformed saved rows and reads both correction formats', () => {
  assert.deepEqual(readEvolveState('broken'), empty);
  assert.deepEqual(readEvolveState(JSON.stringify({
    version: 1, choices: [null, { ...choice('x'), at: 9e15 }],
  })), empty);
  assert.deepEqual(readCorrections('patterns', JSON.stringify({
    version: 1, records: [{ id: 'p', label: 'Gardens', at: 100, action: 'corrected' }],
  })), [{ id: 'p', title: 'Gardens', detail: 'Corrected', at: 100 }]);
  assert.deepEqual(readCorrections('connect', JSON.stringify({
    version: 1, nextId: 2, groups: [{ id: 'user:1', title: '', members: ['a', 'a', 'b'] }],
  })), [{ id: 'user:1', title: 'Untitled event', detail: '2 photos' }]);
});
