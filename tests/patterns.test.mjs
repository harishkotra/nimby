import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPhotoPatterns, readPatternFeedback, writePatternFeedback } from '../src/patterns.ts';

const day = (date) => new Date(2026, 10, date, 12).getTime();
const item = (id, date, options = {}) => ({
  photo: {
    id, uri: `content://${id}`, name: id, album: null, kind: 'photo', confidence: null,
    category: null, tags: [{ label: 'forest', confidence: 0.81 }], decision: 'new', collection: null,
    ...options.photo,
  },
  captured: day(date), place: null, lat: null, lon: null, related: options.related ?? [],
});

test('uses present thumbnails and distinct dated Eye evidence', () => {
  const input = [item('a', 2), item('b', 4), item('c', 6), item('burst', 6)];
  const [pattern] = buildPhotoPatterns(input, [], [{ title: 'Weekend walks', photoIds: ['b'] }]);
  assert.equal(pattern.title, 'Outdoors');
  assert.equal(pattern.dates, 3);
  assert.equal(pattern.members.length, 3);
  assert.deepEqual(pattern.groupNames, ['Weekend walks']);
  assert.ok(pattern.members.every(({ photo }) => photo.uri));
});

test('similar families and exact copies never create additional evidence days', () => {
  const input = [
    item('a', 2, { related: ['b'] }), item('a', 3), item('b', 5, { related: ['c'] }), item('c', 7),
    item('unique', 9),
  ];
  assert.deepEqual(buildPhotoPatterns(input, []), []);
});

test('excludes unavailable, dismissed, sensitive and weakly identified photos', () => {
  const input = [
    item('a', 1), item('b', 3), item('no_access', 4, { photo: { uri: null } }),
    item('dismissed', 5, { photo: { decision: 'dismissed' } }),
    item('private', 6, { photo: { kind: 'medical_reference' } }),
    item('receipt', 7, { photo: { category: 'Receipts' } }),
    item('weak', 8, { photo: { tags: [{ label: 'forest', confidence: 0.65 }] } }),
  ];
  assert.deepEqual(buildPhotoPatterns(input, []), []);
});

test('persists corrections and hides recurring suggestions by stable theme', () => {
  const candidates = [item('a', 2), item('b', 4), item('c', 6)];
  const correction = { id: 'theme:outdoors', label: 'Trail walks', action: 'corrected', at: day(9) };
  const feedback = readPatternFeedback(writePatternFeedback([correction]));
  assert.deepEqual(feedback, [correction]);
  assert.equal(buildPhotoPatterns(candidates, feedback)[0].title, 'Trail walks');
  assert.deepEqual(buildPhotoPatterns(candidates, [{ ...correction, action: 'hidden' }]), []);
  assert.deepEqual(readPatternFeedback('invalid'), []);
});
