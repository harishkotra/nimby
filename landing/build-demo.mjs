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

const pricing = `<section class="privacy" id="pricing" aria-labelledby="pricing-title">
      <div class="wrap privacy-inner demo-plan">
        <div>
          <h2 id="pricing-title">Nimby Lifetime</h2>
          <p>$${priceUsd} USD once <span aria-hidden="true">·</span> one active device</p>
        </div>
        <div>
          <p>Plan from saved photos with Parallel and remember what worked with Evolve.</p>
          <p>After checkout, look for your license key in your email. In the Nimby demo app, open Settings → License to redeem it.</p>
          <a class="button" href="${checkout.href}">Try test checkout</a>
          <p class="demo-note">No real payment.</p>
        </div>
      </div>
    </section>`;
await mkdir(destination);
for (const name of ['assets', 'main.js', 'style.css', 'waitlist.js']) {
  await cp(join(source, name), join(destination, name), { recursive: true });
}
await writeFile(join(destination, 'index.html'), html.replace(marker, pricing));
await writeFile(join(destination, 'product-search.json'), JSON.stringify({ version: 1, endpoint }) + '\n');
