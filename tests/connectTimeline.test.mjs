import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildEvents, emptyCorrections, mergeEvents, parseCorrections, renameEvent, splitEvent,
} from '../src/connectTimeline.ts';
import { pickEventHighlights } from '../src/eventHighlights.ts';

const origin = Date.parse('2026-08-03T10:00:00Z');
const hour = 3600000;

function candidate(id, hours, overrides = {}, result = {}) {
  return {
    photo: { id, uri: `content://${id}`, name: id, album: null, kind: null, confidence: null,
      category: null, tags: [], decision: 'new', collection: null, ...result },
    captured: origin + (hours * hour), place: null, lat: null, lon: null, related: [], ...overrides,
  };
}

test('uses capture time, camera location and Eye links as independent evidence', () => {
  const photos = [
    candidate('clock-one', 0), candidate('clock-two', .5),
    candidate('map-one', 100, { lat: 10, lon: 179.99 }), candidate('map-two', 103, { lat: 10, lon: -179.99 }),
    candidate('visual-one', 200), candidate('visual-two', 208, { related: ['visual-one'] }),
  ];
  const events = buildEvents(photos);
  assert.deepEqual(events.map((event) => event.items.map(({ photo }) => photo.id)), [
    ['visual-one', 'visual-two'], ['map-one', 'map-two'], ['clock-one', 'clock-two'],
  ]);
  assert.deepEqual(events.map((event) => event.reasons[0]), [
    'Eye found similar photos', 'Taken at nearby locations', 'Taken close together',
  ]);
});

test('distant GPS and different known places separate adjacent photos', () => {
  const photos = [
    candidate('one', 0, { lat: 20, lon: 20, place: 'Depot' }),
    candidate('two', .1, { lat: 20, lon: 30, place: 'Depot', related: ['one'] }),
    candidate('three', .2, { place: 'Office' }),
    candidate('four', 8, { place: 'office' }),
  ];
  const events = buildEvents(photos);
  assert.deepEqual(events.map((event) => event.items.map(({ photo }) => photo.id)), [
    ['three', 'four'], ['two'], ['one'],
  ]);
});

test('similar scenes can suggest a moment and stay distinct from burst links', () => {
  const photos = [
    candidate('table', 0, { sceneRelated: ['shelves'], aesthetic: .8 }, { kind: 'photo' }),
    candidate('shelves', 1.5, { aesthetic: .7 }, { kind: 'photo' }),
  ];
  const [suggested] = buildEvents(photos);
  assert.deepEqual(suggested.items.map(({ photo }) => photo.id), ['table', 'shelves']);
  assert.deepEqual(suggested.reasons, ['Eye found similar scenes']);
  assert.equal(pickEventHighlights(suggested.items).length, 2);
  const stored = parseCorrections(JSON.stringify(renameEvent(emptyCorrections, suggested, 'Bookshop')));
  assert.equal(buildEvents(photos, stored)[0].confirmed, true);
  assert.equal(buildEvents(photos, stored)[0].title, 'Bookshop');
});

test('scene links require supporting time or location and respect conflicting places', () => {
  const first = candidate('one', 0, { place: 'Office', sceneRelated: ['two'] });
  assert.equal(buildEvents([first, candidate('two', 1.5, { place: 'Station' })]).length, 2);
  assert.equal(buildEvents([first, candidate('two', 5)]).length, 2);
  const [related] = buildEvents([first, candidate('two', 5, { place: 'Office' })]);
  assert.ok(related.reasons.includes('Share a saved place') && related.reasons.includes('Eye found similar scenes'));
});

test('ignores invalid, duplicate, dismissed and inaccessible results', () => {
  const photos = [
    candidate('duplicate', 0), candidate('duplicate', .5),
    candidate('missing date', 0, { captured: 0 }), candidate('missing file', 0, {}, { uri: null }),
    candidate('dismissed', 0, {}, { decision: 'dismissed' }),
  ];
  assert.deepEqual(buildEvents(photos).flatMap((event) => event.items.map(({ photo }) => photo.id)), ['duplicate']);
});

test('renaming, splitting and merging preserve confirmed members across date filters', () => {
  const photos = [candidate('one', 0), candidate('two', .1), candidate('three', .2), candidate('later', 48)];
  const inferred = buildEvents(photos).find((event) => event.items.length === 3);
  const renamed = renameEvent(emptyCorrections, inferred, 'Project photos');
  const visible = buildEvents(photos.slice(0, 2), renamed)[0];
  const split = splitEvent(renamed, visible, new Set(['two']));
  const roundTrip = parseCorrections(JSON.stringify(split));
  const events = buildEvents(photos, roundTrip);
  const named = events.find((event) => event.title === 'Project photos');
  assert.equal(named.confirmed, true);
  assert.deepEqual(named.items.map(({ photo }) => photo.id), ['one', 'three']);
  const separated = events.find((event) => event.items[0].photo.id === 'two');
  const later = events.find((event) => event.items[0].photo.id === 'later');
  const merged = mergeEvents(roundTrip, separated, later);
  const final = buildEvents(photos, merged);
  assert.deepEqual(final.map((event) => event.items.map(({ photo }) => photo.id)), [['two', 'later'], ['one', 'three']]);
  assert.equal(final.every((event) => event.confirmed), true);
});

test('normalizes corrupted or duplicate saved entries', () => {
  assert.deepEqual(parseCorrections('{'), emptyCorrections);
  const input = {
    version: 1,
    nextId: 1,
    groups: [
      { id: 'not-manual', title: 'Bad group', members: ['hidden'] },
      { id: 'user:8', title: ' Good ', members: ['one', 'one', 3] },
      { id: 'user:10', title: 'Other', members: ['one', 'two'] },
    ],
  };
  assert.deepEqual(parseCorrections(JSON.stringify(input)), {
    version: 1,
    nextId: 11,
    groups: [{ id: 'user:8', title: 'Good', members: ['one'] }, { id: 'user:10', title: 'Other', members: ['two'] }],
  });
});

test('highlights keep one scored photo per detected burst and skip references', () => {
  const photos = [
    candidate('first', 0, { aesthetic: .6, related: ['bridge'] }, { kind: 'photo' }),
    candidate('bridge', .001, { related: ['winner'] }, { kind: 'photo' }),
    candidate('winner', .002, { aesthetic: .9 }, { kind: 'selfie' }),
    candidate('different scene', .003, { aesthetic: .7 }, { kind: 'photo' }),
    candidate('same scene later', .5, { aesthetic: .8, related: ['winner'] }, { kind: 'photo' }),
    candidate('exact copy in the index', .6, { aesthetic: .95 }, { kind: 'photo', id: 'winner' }),
    candidate('screenshot', .62, { aesthetic: 1 }, { kind: 'screenshot' }),
    candidate('document', .63, { aesthetic: 1 }, { kind: 'photo', category: 'Documents' }),
    candidate('dismissed', .65, { aesthetic: 1 }, { kind: 'photo', decision: 'dismissed' }),
    candidate('inaccessible', .66, { aesthetic: 1 }, { kind: 'photo', uri: null }),
  ];
  const [moment] = buildEvents(photos);
  assert.deepEqual(pickEventHighlights(moment.items).map(({ photo }) => photo.id), [
    'winner', 'different scene', 'same scene later',
  ]);
  assert.deepEqual(pickEventHighlights(photos).map(({ photo }) => photo.id), [
    'winner', 'different scene', 'same scene later',
  ]);
});

test('highlights use keeper score to break aesthetic ties and show at most ten in capture order', () => {
  const photos = Array.from({ length: 12 }, (_, i) => candidate(String(i), i, {
    aesthetic: .8, keeper: i / 12,
  }, { kind: 'photo' }));
  assert.deepEqual(pickEventHighlights(photos).map(({ photo }) => photo.id), photos.slice(2).map(({ photo }) => photo.id));
  assert.deepEqual(pickEventHighlights([candidate('unscored', 0, { aesthetic: Number.NaN }, { kind: 'photo' })]), []);
});
