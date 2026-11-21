import assert from 'node:assert/strict';
import test from 'node:test';
import { dateInput, localDate, receiptFacts, relatedShopping, reminderDate, shoppingFacts } from '../src/nextStepFacts.ts';

test('shopping facts come from the saved screenshot without treating a previous price as the price', () => {
  const text = 'Bose QuietComfort Ultra headphones\nWas $399.00\n$299.00\nAdd to cart\nhttps://example.com/listing/123';
  assert.deepEqual(shoppingFacts(text), { label: 'Bose QuietComfort Ultra headphones', price: '$299.00',
    url: { host: 'example.com', url: 'https://example.com/listing/123' } });
  assert.equal(shoppingFacts('$299.00\n$199.00').price, null);
  assert.equal(shoppingFacts('Bose headphones\nhttps://example.com@evil.test/listing').url, undefined);
});

test('shopping comparison suggests real similarly named products and excludes receipts', () => {
  const saved = { kind: 'shopping', photo: { id: '1' }, text: 'Bose QuietComfort headphones' };
  const other = { kind: 'shopping', photo: { id: '2' }, text: 'Bose QuietComfort Wireless in black' };
  const unrelated = { kind: 'shopping', photo: { id: '3' }, text: 'Headphones carrying case' };
  const receipt = { ...other, kind: 'receipt', photo: { id: '4' } };
  assert.deepEqual(relatedShopping(saved, [saved, other, unrelated, receipt]), [other]);
});

test('receipt follow-up extracts only an explicit total and unambiguous return deadline', () => {
  assert.deepEqual(receiptFacts('Sub total $38.00\nTax $2.00\nTOTAL $40.00\nReturn by Dec 2, 2026'),
    { total: '$40.00', returnBy: '2026-12-02' });
  assert.deepEqual(receiptFacts('Sub total $38.00\nReturn by 01/02/26\nPurchase date 2026-11-20'),
    { total: null, returnBy: null });
  assert.equal(localDate('2026-02-30'), null);
  const reminder = localDate('2026-12-02');
  assert.equal(reminder.getHours(), 9);
  assert.equal(dateInput(reminder), '2026-12-02');
  assert.equal(reminderDate('2026-12-02', '18:25').getMinutes(), 25);
  assert.equal(reminderDate('2026-12-02', '25:00'), null);
});
