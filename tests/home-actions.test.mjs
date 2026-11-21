import assert from 'node:assert/strict';
import test from 'node:test';
import { homeLeadAction } from '../src/homeActions.ts';

test('a fully scanned small gallery leads with search', () => {
  assert.equal(homeLeadAction({ localAnalyzed: 106, analyzed: 106, accessible: 106, awaiting: 0 }), 'search');
});

test('analyzed photos remain searchable with an incomplete gallery scan or picker-only access', () => {
  assert.equal(homeLeadAction({ localAnalyzed: 10, analyzed: 10, accessible: 4000, awaiting: 3990 }), 'search');
  assert.equal(homeLeadAction({ localAnalyzed: 1, analyzed: null, accessible: null, awaiting: null }), 'search');
});

test('a known empty gallery leads with photo selection, and an unscanned one leads with scan', () => {
  assert.equal(homeLeadAction({ localAnalyzed: 0, analyzed: 0, accessible: 0, awaiting: 0 }), 'pick');
  assert.equal(homeLeadAction({ localAnalyzed: 0, analyzed: 0, accessible: 106, awaiting: 106 }), 'scan');
  assert.equal(homeLeadAction(null), 'scan');
});
