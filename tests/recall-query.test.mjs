import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRecallQuery, recallDateRange } from '../src/recallQuery.ts';

const now = new Date(2025, 10, 8, 13);

test('filters a natural receipt query while preserving the OCR terms', () => {
  const request = parseRecallQuery('Find my Northstar electricity bill from last month', now);
  assert.equal(request.terms, 'Northstar electricity bill');
  assert.equal(request.category, null);
  assert.deepEqual(request.date, {
    label: 'Last month', start: new Date(2025, 9, 1).getTime(), end: new Date(2025, 10, 1).getTime(),
  });
});

test('recognizes a screenshot collection and an explicitly named place', () => {
  const request = parseRecallQuery('Show me screenshots with text place:"New Delhi"', now);
  assert.equal(request.terms, '');
  assert.equal(request.category, 'Screenshots');
  assert.equal(request.place, 'New Delhi');
  assert.equal(request.textOnly, true);
});

test('does not treat a bare year or invalid date as a filter', () => {
  assert.equal(parseRecallQuery('Document serial 2025', now).date, null);
  assert.equal(parseRecallQuery('Document on 2025-02-31', now).date, null);
});

test('handles named month and exact date ranges', () => {
  const month = parseRecallQuery('Receipts during Feb 2024', now);
  assert.equal(month.terms, '');
  assert.equal(month.date?.start, new Date(2024, 1, 1).getTime());
  assert.equal(month.date?.end, new Date(2024, 2, 1).getTime());
  const date = parseRecallQuery('Receipt on 2024-02-29', now);
  assert.equal(date.date?.start, new Date(2024, 1, 29).getTime());
  assert.equal(date.date?.end, new Date(2024, 2, 1).getTime());
});

test('calendar months and weeks cross year boundaries', () => {
  const january = new Date(2025, 0, 1);
  assert.equal(recallDateRange('Last month', january)?.start, new Date(2024, 11, 1).getTime());
  assert.equal(recallDateRange('This week', january)?.start, new Date(2024, 11, 30).getTime());
});
