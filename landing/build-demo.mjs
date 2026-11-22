import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = process.argv[2];
const endpoint = process.env.NIMBY_HOSTED_PRODUCT_SEARCH_URL?.trim() || null;
if (endpoint && !/^https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com\/product-search$/.test(endpoint)) {
  throw new Error('Use the HTTPS ProductSearchUrl output from the retailer search stack.');
}
const { productId, priceUsd } = JSON.parse(await readFile(new URL('./lifetime-demo.json', import.meta.url), 'utf8'));
if (!output || !/^pdt_[a-zA-Z0-9]+$/.test(productId) || !Number.isSafeInteger(priceUsd) || priceUsd <= 0) {
  throw new Error('Pass a new output directory and check the Dodo product settings in lifetime-demo.json.');
}

const source = fileURLToPath(new URL('./dist', import.meta.url));
const destination = resolve(output);
const marker = '<!-- Nimby Lifetime demo checkout -->';
const html = await readFile(join(source, 'index.html'), 'utf8');
if (html.split(marker).length !== 2) throw new Error('Expected exactly one demo checkout insertion point.');

const checkout = new URL('/buy/' + productId, 'https://test.checkout.dodopayments.com');
checkout.searchParams.set('quantity', '1');

const pricing = `<section class="license-section" id="pricing" aria-labelledby="pricing-title">
      <div class="wrap license-card">
        <div class="license-copy">
          <h2 id="pricing-title">Nimby Lifetime</h2>
          <p>Plan from saved photos with Parallel and revisit past choices with Evolve.</p>
          <p>Redeem the key from your email in <strong>Settings → License</strong>.</p>
        </div>
        <div class="license-purchase">
          <p class="license-price"><strong>$${priceUsd}</strong> USD</p>
          <p class="license-terms">One-time purchase · One active device</p>
          <a class="button" href="${checkout.href}">Get a License</a>
        </div>
      </div>
    </section>`;
await mkdir(destination);
for (const name of ['assets', 'main.js', 'style.css', 'waitlist.js']) {
  await cp(join(source, name), join(destination, name), { recursive: true });
}
await writeFile(join(destination, 'index.html'), html.replace(marker, pricing));
await writeFile(join(destination, 'product-search.json'), JSON.stringify({ version: 1, endpoint }) + '\n');
