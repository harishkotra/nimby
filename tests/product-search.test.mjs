import assert from 'node:assert/strict';
import test from 'node:test';
import { googleShoppingUrl, productQuery, productQueryCandidates, receiptSuggestion, visionProductQuery } from '../src/nextStepFacts.ts';
import { matchingListings, searchListings } from '../server/product-search.mjs';
import { createHandler } from '../server/hosted-product-search.mjs';

test('product search prioritizes literal OCR model codes and excludes account text', () => {
  const ocr = 'Premium Noise Cancelling Headphones\nYour orders\nShop by brand\nSony WH-1000XM5\nname@example.com\n$399.00';
  assert.equal(productQueryCandidates(ocr)[0], 'Sony WH-1000XM5');
  assert.deepEqual(productQueryCandidates('WH-1000XM5\nAdd to cart'), ['WH-1000XM5']);
  assert.equal(productQuery('  Sony   WH-1000XM5 '), 'Sony WH-1000XM5');
  assert.equal(new URL(googleShoppingUrl('Sony WH-1000XM5 & case')).searchParams.get('q'), 'Sony WH-1000XM5 & case');
});

test('shopping screenshot OCR can place the price and store controls on the title line', () => {
  assert.equal(productQueryCandidates('Your orders\nSony WH-1000XM5 $399.99 · Free delivery\nAdd to cart')[0], 'Sony WH-1000XM5');
  assert.equal(productQueryCandidates('PS5 $499.00')[0], 'PS5');
  assert.deepEqual(productQueryCandidates('Your account\n$399.99\nFree delivery\nAdd to cart'), []);
});

test('vision autofill preserves exact model text and rejects missing or unrelated replies', () => {
  assert.equal(visionProductQuery('{"name":"Sony WH-1000XM5"}'), 'Sony WH-1000XM5');
  assert.equal(visionProductQuery('```json\n{"name":"Fujifilm X100VI"}\n```'), 'Fujifilm X100VI');
  for (const reply of ['{"name":null}', '{"name":["PS5"]}', 'Probably a Sony camera',
    '{"name":"Buy now"}', '{"name":"https://example.com/camera"}']) {
    assert.equal(visionProductQuery(reply), '');
  }
});

test('retailer matches require the searched model and reject accessories, reviews, duplicates and unsafe links', () => {
  const found = matchingListings('Sony WH-1000XM5', [
    { title: 'Sony WH1000XM5 Noise Canceling Headphones', url: 'https://www.retailer.test/product/sony?utm_source=example' },
    { title: 'Sony WH 1000XM5 Headphones', url: 'https://www.retailer.test/product/sony' },
    { title: 'Sony WH-1000XM4 Headphones', url: 'https://shop.test/product/previous-model', content: 'See also Sony WH-1000XM5' },
    { title: 'Replacement case for Sony WH-1000XM5', url: 'https://shop.test/product/case' },
    { title: 'Sony WH-1000XM5 review', url: 'https://shop.test/blog/sony-review' },
    { title: 'Sony WH-1000XM5 headphones', url: 'javascript:alert(1)' },
    { title: 'Sony WH-1000XM5 headphones', url: 'https://retailer.test@unknown.test/product/sony' },
  ]);
  assert.deepEqual(found, [{ title: 'Sony WH1000XM5 Noise Canceling Headphones', url: 'https://www.retailer.test/product/sony', store: 'retailer.test' }]);
});

test('Tavily integration requests search results without asking for generated responses', async () => {
  const query = 'Fujifilm X100VI';
  const listings = await searchListings(query, 'test-only-key', async (url, init) => {
    assert.equal(url, 'https://api.tavily.com/search');
    assert.equal(init.headers.Authorization, 'Bearer test-only-key');
    const body = JSON.parse(init.body);
    assert.equal(body.query, `${query} buy online retailer`);
    assert.equal(body.search_depth, 'basic');
    assert.equal(body.include_answer, false);
    return new Response(JSON.stringify({ results: [
      { title: 'Fujifilm X100VI Digital Camera', content: 'Add to cart', url: 'https://camera.test/cameras/x100vi' },
    ] }), { status: 200 });
  });
  assert.equal(listings[0].store, 'camera.test');
  await assert.rejects(searchListings(query, 'test-only-key', async () => new Response(null, { status: 429 })), /quota/);
});

test('receipt vision cannot supply a reminder date or return unsupported actions', () => {
  const request = '{"action":"return_reminder","date":"2099-01-01"}';
  assert.equal(receiptSuggestion(request, false), null);
  assert.equal(receiptSuggestion('{"action":"return_reminder"}', true), 'return_reminder');
  assert.equal(receiptSuggestion('{"action":"review_receipt"}', false), 'review_receipt');
  assert.equal(receiptSuggestion('{"action":"schedule"}', true), null);
});

test('hosted product search validates input before using the daily budget and passes only the typed query', async () => {
  let available = true;
  let quotaChecks = 0;
  let calls = 0;
  const handler = createHandler({
    reserve: async () => { quotaChecks++; return available; },
    getKey: async () => 'server-only-test-key',
    search: async (query, key) => {
      calls++;
      assert.equal(query, 'Fujifilm X100VI');
      assert.equal(key, 'server-only-test-key');
      return [{ title: query }];
    },
  });
  const event = { rawPath: '/product-search', requestContext: { http: { method: 'POST' } },
    headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"query":"  Fujifilm  X100VI "}' };
  assert.equal((await handler({ ...event, body: '{"query":"Fujifilm X100VI","image":"photo.jpg"}' })).statusCode, 400);
  assert.equal((await handler({ ...event, body: '{"query":"' + 'x'.repeat(1024) + '"}' })).statusCode, 400);
  assert.equal((await handler({ ...event, headers: { ...event.headers, origin: 'https://example.test' } })).statusCode, 415);
  assert.equal(quotaChecks, 0);
  const result = await handler(event);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { listings: [{ title: 'Fujifilm X100VI' }] });
  available = false;
  assert.equal((await handler(event)).statusCode, 429);
  assert.equal(calls, 1);
});
