import assert from 'node:assert/strict';
import test from 'node:test';

import { availableParallelPhotos, buildParallelPlans, parallelChoice } from '../src/parallelPlans.ts';

function item(id, category = 'Photos', extra = {}) {
  return {
    photo: { id, name: `Photo ${id}`, uri: `content://test/${id}`, category, decision: 'new', ...extra },
    captured: 1700000000000, place: null, lat: null, lon: null, related: [],
  };
}
const flexible = { minutes: 15, preference: 'Any approach' };

test('uses only accessible and distinct photos as evidence', () => {
  const items = [item('1'), item('1'), item('2', 'Photos', { uri: null }), item('3', 'Photos', { decision: 'dismissed' })];
  assert.deepEqual(availableParallelPhotos(items).map(({ photo }) => photo.id), ['1']);
  assert.equal(buildParallelPlans(items, flexible).length, 3);
  for (const plan of buildParallelPlans(items, flexible)) {
    assert.deepEqual(plan.evidence.map(({ id }) => id), ['1']);
  }
  assert.deepEqual(buildParallelPlans(items.slice(2), flexible), []);
});

test('adds a focused option with the specific supporting photos and records only those IDs', () => {
  const plans = buildParallelPlans([item('1', 'Receipts'), item('2', 'Receipts'), item('3', 'Shopping references')], flexible);
  const receipt = plans.find(({ id }) => id === 'receipt-checklist');
  assert.ok(receipt);
  const choice = parallelChoice(receipt, flexible, 1234);
  assert.equal(choice.actionId, 'receipt-checklist');
  assert.deepEqual(choice.photoIds, ['1', '2']);
  assert.equal(choice.at, 1234);
  assert.match(choice.constraints, /15 minutes/);
  assert.notEqual(parallelChoice(receipt, flexible, 1234).id, choice.id);
});

test('keeps choices within the time budget even when feedback favors a longer action', () => {
  const plans = buildParallelPlans([item('1', 'Documents')], { minutes: 5, preference: 'Any approach' }, ['document-outline']);
  assert.deepEqual(plans.map(({ id }) => id), ['quick-review', 'keep-collection']);
  assert.ok(plans.every(({ minutes }) => minutes <= 5));
});

test('gives explicit preferences priority over past outcomes among viable options', () => {
  const items = [item('1', 'Notes and whiteboards')];
  const preferredActions = ['notes-checklist'];
  const recommended = buildParallelPlans(items, flexible, preferredActions);
  assert.equal(recommended[0].id, 'notes-checklist');
  const organize = buildParallelPlans(items, { ...flexible, preference: 'Get organized' }, preferredActions);
  assert.equal(organize[0].id, 'keep-collection');
});

test('bounds evidence to the maximum selected photo count', () => {
  const items = Array.from({ length: 6 }, (_, index) => item(String(index)));
  assert.deepEqual(buildParallelPlans(items, flexible)[0].evidence.map(({ id }) => id), ['0', '1', '2', '3']);
});
